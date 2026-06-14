/**
 * Structured e-invoice XML extraction (ISDOC + Peppol/UBL).
 *
 * Ported from Foldera v1 (queue/extraction/extractors/isdocExtractor.ts),
 * reimplemented on fast-xml-parser instead of regex scanning.
 *
 * XML values are GROUND TRUTH: when the input is a structured e-invoice we
 * build the `ExtractedInvoice` directly from the XML (confidence 95+) and
 * skip OCR entirely.
 *
 * Supported formats:
 * - ISDOC (Czech standard, ČSN EN 16931) — versions 5.x and 6.x
 * - Peppol/UBL (European standard, EN 16931) — UBL 2.1 Invoice/CreditNote
 */

import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { logger } from '../../utils/logger.js';
import type {
  ExtractedInvoice,
  ExtractedLineItem,
  ExtractionInput,
  ExtractionResult,
  VatBucket,
} from '../../types/contracts.js';
import { emptyInvoice, asNumber, asNumericSymbol } from './mapping.js';
import { splitBankAccount } from './bankCodeUtils.js';
import { round2, scoreIsdocConfidence } from './confidence.js';

// ============================================================================
// Detection
// ============================================================================

export type StructuredFormat = 'isdoc' | 'ubl';

const ISDOC_NAMESPACE_PATTERNS = ['isdoc.cz', 'xmlns:isdoc'] as const;

const UBL_NAMESPACE_PATTERNS = [
  'urn:oasis:names:specification:ubl:schema:xsd:Invoice',
  'urn:oasis:names:specification:ubl:schema:xsd:CreditNote',
  'urn:cen.eu:en16931',
  'urn:fdc:peppol.eu',
  '<cbc:',
  '<cac:',
] as const;

/** Cheap pre-check: could this file be a structured e-invoice XML at all? */
export function mightBeStructuredXml(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    mimeType === 'application/x-isdoc' ||
    mimeType === 'application/xml' ||
    mimeType === 'text/xml' ||
    lower.endsWith('.isdoc') ||
    lower.endsWith('.xml')
  );
}

/**
 * Detect the structured e-invoice format from file name, MIME type and
 * content. ISDOC wins by extension `.isdoc`, mime `application/x-isdoc`,
 * or `isdoc.cz` namespace in the XML header.
 */
export function detectStructuredFormat(
  fileName: string,
  mimeType: string,
  content: string,
): StructuredFormat | null {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/x-isdoc' || lower.endsWith('.isdoc')) return 'isdoc';
  if (!mightBeStructuredXml(fileName, mimeType)) return null;

  const header = content.slice(0, 4000);
  if (ISDOC_NAMESPACE_PATTERNS.some(pattern => header.includes(pattern))) return 'isdoc';
  if (UBL_NAMESPACE_PATTERNS.some(pattern => header.includes(pattern))) return 'ubl';
  return null;
}

// ============================================================================
// XML tree helpers (fast-xml-parser output navigation, strictly typed)
// ============================================================================

interface XmlObject {
  [key: string]: XmlValue;
}
type XmlValue = string | number | boolean | XmlValue[] | XmlObject;

const MAX_DEPTH = 24;

function isObj(value: XmlValue | undefined): value is XmlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Direct child by name; unwraps single-element arrays. */
function child(node: XmlValue | undefined, name: string): XmlValue | undefined {
  if (!isObj(node)) return undefined;
  const value = node[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Depth-first search for the first element matching any of the names. */
function findFirst(
  node: XmlValue | undefined,
  names: readonly string[],
  depth = 0,
): XmlValue | undefined {
  if (node === undefined || depth > MAX_DEPTH) return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirst(item, names, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObj(node)) return undefined;
  for (const name of names) {
    const direct = node[name];
    if (direct !== undefined) {
      return Array.isArray(direct) ? direct[0] : direct;
    }
  }
  for (const value of Object.values(node)) {
    const found = findFirst(value, names, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Collect all elements matching any of the names (does not descend into matches). */
function findAll(node: XmlValue | undefined, names: readonly string[], depth = 0): XmlValue[] {
  const results: XmlValue[] = [];
  if (node === undefined || depth > MAX_DEPTH) return results;
  if (Array.isArray(node)) {
    for (const item of node) results.push(...findAll(item, names, depth + 1));
    return results;
  }
  if (!isObj(node)) return results;
  for (const [key, value] of Object.entries(node)) {
    if (names.includes(key)) {
      results.push(...(Array.isArray(value) ? value : [value]));
    } else {
      results.push(...findAll(value, names, depth + 1));
    }
  }
  return results;
}

/** Text content of a node (handles `#text` when attributes are present). */
function textOf(node: XmlValue | undefined): string | null {
  if (node === undefined) return null;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  return textOf(node['#text']);
}

function textIn(node: XmlValue | undefined, names: readonly string[]): string | null {
  return textOf(findFirst(node, names));
}

function numIn(node: XmlValue | undefined, names: readonly string[]): number | null {
  return asNumber(textIn(node, names));
}

function attrOf(node: XmlValue | undefined, attrName: string): string | null {
  if (!isObj(node)) return null;
  const value = node[`@_${attrName}`];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Extract YYYY-MM-DD from an XML date value. */
function dateIn(node: XmlValue | undefined, names: readonly string[]): string | null {
  const text = textIn(node, names);
  if (text == null) return null;
  const match = text.match(/(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

// ============================================================================
// Parsing
// ============================================================================

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** ISDOC PaymentMeansCode → human-readable payment method. */
const PAYMENT_MEANS_CODES: Record<string, string> = {
  '10': 'hotově',
  '20': 'šekem',
  '42': 'převodem',
  '48': 'kartou',
  '49': 'inkasem',
  '50': 'dobírkou',
  '97': 'zápočtem',
};

/** ISDOC DocumentType codes that represent credit notes (dobropisy). */
const ISDOC_CREDIT_NOTE_CODES = new Set(['2', '6']);

const REVERSE_CHARGE_INDICATORS = [
  'přenesená daňová povinnost',
  'prenesená daňová povinnosť',
  'reverse charge',
  'ReverseCharge',
  '§ 92a',
] as const;

function parseVatBuckets(scope: XmlValue | undefined, foreign: boolean): VatBucket[] {
  const buckets: VatBucket[] = [];
  for (const sub of findAll(scope, ['TaxSubTotal', 'TaxSubtotal'])) {
    const rate = numIn(sub, ['Percent', 'TaxRate']);
    // In a foreign-currency ISDOC each subtotal carries both the local (CZK)
    // amount and the foreign `*Curr` amount. The payload books the foreign
    // figures via the *Men fields and lets ABRA derive CZK from the kurz, so the
    // bucket base/VAT must be in the FOREIGN currency. Fall back to the local
    // amount only when the *Curr value is missing (malformed document).
    const base = foreign
      ? (numIn(sub, ['TaxableAmountCurr']) ?? numIn(sub, ['TaxableAmount']))
      : numIn(sub, ['TaxableAmount']);
    let vat = foreign
      ? (numIn(sub, ['TaxAmountCurr']) ?? numIn(sub, ['TaxAmount']))
      : numIn(sub, ['TaxAmount']);
    if (vat == null && rate === 0) vat = 0;
    if (rate == null || base == null || vat == null) continue;
    buckets.push({ rate, base: round2(base), vat: round2(vat) });
  }
  return buckets;
}

function parseLineItems(scope: XmlValue | undefined, foreign: boolean): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  for (const line of findAll(scope, ['InvoiceLine', 'CreditNoteLine'])) {
    const item = findFirst(line, ['Item']);
    const description =
      textIn(item ?? line, ['Description', 'Name']) ?? textIn(line, ['Note']);
    if (description == null) continue;

    const quantityNode = findFirst(line, ['InvoicedQuantity', 'CreditedQuantity', 'Quantity']);
    // For a foreign-currency invoice the payload books items in the foreign
    // currency (cenaMj × kurz → CZK), so prefer the `*Curr` amounts; fall back
    // to the local (CZK) figure only when a foreign amount is missing.
    const unitPrice = foreign
      ? (numIn(line, ['UnitPriceCurr']) ??
          numIn(findFirst(line, ['Price']), ['PriceAmountCurr']) ??
          numIn(line, ['UnitPrice']) ??
          numIn(findFirst(line, ['Price']), ['PriceAmount']))
      : (numIn(line, ['UnitPrice']) ?? numIn(findFirst(line, ['Price']), ['PriceAmount']));
    const total = foreign
      ? (numIn(line, ['LineExtensionAmountTaxInclusiveCurr']) ??
          numIn(line, ['LineExtensionAmountCurr']) ??
          numIn(line, ['LineExtensionAmountTaxInclusive']) ??
          numIn(line, ['LineExtensionAmount']))
      : (numIn(line, ['LineExtensionAmountTaxInclusive']) ?? numIn(line, ['LineExtensionAmount']));

    items.push({
      description,
      quantity: asNumber(textOf(quantityNode)),
      unit: attrOf(quantityNode, 'unitCode'),
      unitPrice: unitPrice == null ? null : round2(unitPrice),
      total: total == null ? null : round2(total),
      vatRate: numIn(line, ['Percent', 'TaxRate']),
    });
  }
  return items;
}

function composeAddress(postal: XmlValue | undefined): string | null {
  if (postal === undefined) return null;
  const street = [textIn(postal, ['StreetName']), textIn(postal, ['BuildingNumber'])]
    .filter((part): part is string => part != null)
    .join(' ');
  const city = [textIn(postal, ['PostalZone']), textIn(postal, ['CityName'])]
    .filter((part): part is string => part != null)
    .join(' ');
  const parts = [street, city].filter(part => part !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Parse ISDOC or Peppol/UBL XML content into an `ExtractedInvoice`.
 * Exported for tests — pure, no I/O.
 */
export function parseStructuredInvoiceXml(
  content: string,
  format: StructuredFormat,
): ExtractedInvoice {
  const root = parser.parse(content) as XmlObject;

  const isUblCreditNote = format === 'ubl' && root.CreditNote !== undefined;
  const inv =
    findFirst(root, ['Invoice', 'CreditNote']) ??
    (root as XmlValue);

  // --- Classification ---------------------------------------------------
  let documentType: ExtractedInvoice['documentType'] = 'invoice';
  if (format === 'isdoc') {
    const typeCode = textOf(child(inv, 'DocumentType'));
    if (typeCode != null && ISDOC_CREDIT_NOTE_CODES.has(typeCode)) documentType = 'credit_note';
  } else if (isUblCreditNote) {
    documentType = 'credit_note';
  }

  // --- Supplier ----------------------------------------------------------
  const supplier = findFirst(inv, ['AccountingSupplierParty', 'SellerParty']);
  const supplierParty = findFirst(supplier, ['Party']) ?? supplier;
  const supplierName =
    textIn(findFirst(supplierParty, ['PartyName']), ['Name']) ??
    textIn(supplierParty, ['RegistrationName', 'Name']);
  const supplierIco =
    textIn(findFirst(supplierParty, ['PartyIdentification']), ['ID']) ??
    textIn(findFirst(supplierParty, ['PartyLegalEntity']), ['CompanyID']) ??
    textIn(supplierParty, ['EndpointID', 'IC']);
  const supplierDic =
    textIn(findFirst(supplierParty, ['PartyTaxScheme']), ['CompanyID']) ??
    textIn(supplierParty, ['TaxRegistrationID', 'DIC', 'VATRegistrationID']);
  const supplierAddress = composeAddress(findFirst(supplierParty, ['PostalAddress']));

  // --- Payment -----------------------------------------------------------
  const paymentMeans = findFirst(inv, ['PaymentMeans']);
  const payment = findFirst(paymentMeans ?? inv, ['Payment']) ?? paymentMeans;
  const details = findFirst(payment, ['Details']) ?? payment;
  const payeeAccount = findFirst(paymentMeans ?? inv, ['PayeeFinancialAccount']);

  let rawAccount = textOf(child(details, 'ID')) ?? textIn(details, ['BankAccountNumber']);
  let iban = textIn(details, ['IBAN']);
  const ublAccountId = textOf(child(payeeAccount, 'ID'));
  if (rawAccount == null && ublAccountId != null) {
    // UBL stores the IBAN (or domestic account) in PayeeFinancialAccount/ID.
    if (/^[A-Z]{2}\d{2}/i.test(ublAccountId)) iban = iban ?? ublAccountId;
    else rawAccount = ublAccountId;
  }
  const rawBankCode = textIn(details, ['BankCode']);
  const { account: bankAccount, code: bankCode } = splitBankAccount(rawAccount, rawBankCode);
  const swift =
    textIn(details, ['BIC', 'SWIFT']) ??
    textIn(findFirst(payeeAccount, ['FinancialInstitutionBranch']), ['ID']);

  const paymentMeansCode = textIn(paymentMeans ?? inv, ['PaymentMeansCode']);
  const paymentMethod =
    paymentMeansCode != null ? (PAYMENT_MEANS_CODES[paymentMeansCode] ?? null) : null;

  // --- Currency ----------------------------------------------------------
  // Czech ISDOC always books in CZK locally; a genuine foreign-currency invoice
  // declares ForeignCurrencyCode + CurrRate/RefCurrRate alongside the CZK total.
  const currencyRaw =
    textIn(inv, ['ForeignCurrencyCode']) ??
    textIn(inv, ['DocumentCurrencyCode', 'LocalCurrencyCode', 'CurrencyCode']);
  const currency =
    currencyRaw != null && /^[A-Za-z]{3}$/.test(currencyRaw) ? currencyRaw.toUpperCase() : null;
  const isForeign = currency != null && currency !== 'CZK';

  // CurrRate is the CZK value of RefCurrRate units of the foreign currency
  // (RefCurrRate is usually 1, but 100 for low-value currencies like JPY/HUF).
  // Normalize to CZK per 1 unit so it matches the OCR contract / payload.
  const currRate = numIn(inv, ['CurrRate']);
  const refCurrRate = numIn(inv, ['RefCurrRate']);
  const exchangeRate =
    isForeign && currRate != null && currRate > 0
      ? currRate / (refCurrRate != null && refCurrRate > 0 ? refCurrRate : 1)
      : null;

  // --- Amounts -----------------------------------------------------------
  // For a foreign invoice the payload books the foreign (*Men) amounts and lets
  // ABRA derive CZK via the kurz, so totalAmount/vatBreakdown must be FOREIGN;
  // the CZK total is kept only to derive the rate when CurrRate is absent.
  const monetary = findFirst(inv, ['LegalMonetaryTotal', 'MonetaryTotal']);
  const totalAmount = isForeign
    ? (numIn(monetary, ['TaxInclusiveAmountCurr', 'PayableAmountCurr']) ??
        numIn(inv, ['TaxInclusiveAmountCurr', 'PayableAmountCurr']) ??
        numIn(monetary, ['TaxInclusiveAmount', 'PayableAmount']))
    : (numIn(monetary, ['TaxInclusiveAmount', 'PayableAmount']) ??
        numIn(inv, ['TaxInclusiveAmount', 'PayableAmount']));
  const totalWithoutVat = isForeign
    ? (numIn(monetary, ['TaxExclusiveAmountCurr']) ?? numIn(monetary, ['TaxExclusiveAmount']))
    : (numIn(monetary, ['TaxExclusiveAmount']) ?? numIn(inv, ['TaxExclusiveAmount']));
  const totalAmountCzk = isForeign
    ? (numIn(monetary, ['TaxInclusiveAmount', 'PayableAmount']) ??
        numIn(inv, ['TaxInclusiveAmount', 'PayableAmount']))
    : null;

  const taxTotal = findFirst(inv, ['TaxTotal']);
  const vatBreakdown = parseVatBuckets(taxTotal ?? inv, isForeign);

  // --- Reverse charge ----------------------------------------------------
  const vatApplicable = textIn(inv, ['VATApplicable']);
  const taxExemptionCode = textIn(taxTotal ?? inv, ['TaxExemptionReasonCode']);
  const reverseCharge =
    vatApplicable === 'false' ||
    taxExemptionCode === 'AE' ||
    taxExemptionCode === 'K' ||
    REVERSE_CHARGE_INDICATORS.some(indicator => content.includes(indicator));

  // --- Invoice number & symbols -------------------------------------------
  const invoiceNumber =
    textOf(child(inv, 'ID')) ?? textIn(inv, ['InvoiceID', 'DocumentID']);
  let variableSymbol = asNumericSymbol(textIn(inv, ['VariableSymbol', 'VS']));
  if (variableSymbol == null && invoiceNumber != null) {
    variableSymbol = asNumericSymbol(invoiceNumber);
  }

  const invoice: ExtractedInvoice = {
    ...emptyInvoice(),
    isInvoice: documentType === 'invoice',
    documentType,
    supplierName,
    supplierIco: supplierIco?.replace(/\s/g, '') ?? null,
    supplierDic: supplierDic?.replace(/\s/g, '') ?? null,
    supplierAddress,
    invoiceNumber,
    variableSymbol,
    constantSymbol: asNumericSymbol(textIn(inv, ['ConstantSymbol'])),
    specificSymbol: asNumericSymbol(textIn(inv, ['SpecificSymbol'])),
    orderNumber: textIn(findFirst(inv, ['OrderReference']), ['ID', 'SalesOrderID']),
    issueDate: dateIn(inv, ['IssueDate', 'IssuingDate']),
    taxDate: dateIn(inv, ['TaxPointDate', 'DUZP', 'TaxableSupplyDate']),
    dueDate: dateIn(inv, ['PaymentDueDate', 'DueDate']),
    totalAmount: totalAmount == null ? null : round2(totalAmount),
    totalWithoutVat: totalWithoutVat == null ? null : round2(totalWithoutVat),
    currency,
    exchangeRate,
    totalAmountCzk: totalAmountCzk == null ? null : round2(totalAmountCzk),
    vatBreakdown,
    reverseCharge,
    bankAccount,
    bankCode,
    iban: iban?.replace(/\s/g, '') ?? null,
    swift,
    paymentMethod,
    lineItems: parseLineItems(findFirst(inv, ['InvoiceLines']) ?? inv, isForeign),
    description: textOf(child(inv, 'Note')) ?? textIn(inv, ['Note']),
    rawText: null,
  };

  return invoice;
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Try to extract a structured e-invoice from the input file.
 * Returns null when the file is not a recognized ISDOC/UBL XML
 * (the caller falls through to the OCR path / unsupported handling).
 */
export async function extractStructuredInvoice(
  input: ExtractionInput,
): Promise<ExtractionResult | null> {
  if (!mightBeStructuredXml(input.fileName, input.mimeType)) return null;

  let content: string;
  try {
    content = await readFile(input.filePath, 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ filePath: input.filePath, error: message }, '[Extraction] Failed to read XML file');
    return {
      success: false,
      source: 'isdoc',
      fields: null,
      confidence: 0,
      error: `Failed to read file: ${message}`,
    };
  }

  const format = detectStructuredFormat(input.fileName, input.mimeType, content);
  if (format == null) return null;

  try {
    const fields = parseStructuredInvoiceXml(content, format);
    const confidence = scoreIsdocConfidence(fields);

    logger.info(
      {
        fileName: input.fileName,
        format,
        confidence,
        invoiceNumber: fields.invoiceNumber,
        lineItemCount: fields.lineItems.length,
      },
      '[Extraction] Structured e-invoice extracted (ground truth)',
    );

    return { success: true, source: 'isdoc', fields, confidence };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { fileName: input.fileName, format, error: message },
      '[Extraction] Failed to parse structured e-invoice XML',
    );
    return {
      success: false,
      source: 'isdoc',
      fields: null,
      confidence: 0,
      error: `Failed to parse ${format} XML: ${message}`,
    };
  }
}
