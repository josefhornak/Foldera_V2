/**
 * Shared value-coercion helpers and the snake_case model-output →
 * `ExtractedInvoice` mapper used by the OCR path.
 */

import type {
  ExtractedInvoice,
  ExtractedLineItem,
  VatBucket,
} from '../../types/contracts.js';
import { round2 } from './confidence.js';
import { splitBankAccount } from './bankCodeUtils.js';

/** All-null invoice skeleton — guarantees every contract field is present. */
export function emptyInvoice(): ExtractedInvoice {
  return {
    isInvoice: false,
    documentType: 'other',
    supplierName: null,
    supplierIco: null,
    supplierDic: null,
    supplierAddress: null,
    invoiceNumber: null,
    variableSymbol: null,
    constantSymbol: null,
    specificSymbol: null,
    orderNumber: null,
    issueDate: null,
    taxDate: null,
    dueDate: null,
    totalAmount: null,
    totalWithoutVat: null,
    currency: null,
    vatBreakdown: [],
    reverseCharge: false,
    bankAccount: null,
    bankCode: null,
    iban: null,
    swift: null,
    paymentMethod: null,
    lineItems: [],
    description: null,
    rawText: null,
  };
}

/** Coerce unknown to a trimmed non-empty string or null. */
export function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Coerce unknown to a finite number (handles Czech "1 234,56" strings) or null. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/\s/g, '').replace(',', '.');
    if (cleaned === '') return null;
    const num = Number.parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/** Extract YYYY-MM-DD from a value; converts DD.MM.YYYY as a safety net. */
export function asIsoDate(value: unknown): string | null {
  const text = asString(value);
  if (text == null) return null;

  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch?.[1]) return isoMatch[1];

  const czMatch = text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (czMatch?.[1] && czMatch[2] && czMatch[3]) {
    return `${czMatch[3]}-${czMatch[2].padStart(2, '0')}-${czMatch[1].padStart(2, '0')}`;
  }

  return null;
}

/** Digits-only variable/constant/specific symbol; null when empty. */
export function asNumericSymbol(value: unknown): string | null {
  const text = asString(value);
  if (text == null) return null;
  const digits = text.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DOCUMENT_TYPES = ['invoice', 'receipt', 'credit_note', 'other'] as const;

function asDocumentType(value: unknown): ExtractedInvoice['documentType'] {
  const text = asString(value)?.toLowerCase() ?? '';
  const match = DOCUMENT_TYPES.find(type => type === text);
  return match ?? 'other';
}

function mapVatBreakdown(value: unknown): VatBucket[] {
  if (!Array.isArray(value)) return [];
  const buckets: VatBucket[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const rate = asNumber(entry.rate);
    const base = asNumber(entry.base);
    let vat = asNumber(entry.vat);
    if (vat == null && rate === 0) vat = 0;
    if (rate == null || base == null || vat == null) continue;
    buckets.push({ rate, base: round2(base), vat: round2(vat) });
  }
  return buckets;
}

function mapLineItems(value: unknown): ExtractedLineItem[] {
  if (!Array.isArray(value)) return [];
  const items: ExtractedLineItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const description = asString(entry.description);
    if (description == null) continue;
    const unitPrice = asNumber(entry.unit_price);
    const total = asNumber(entry.total_amount);
    items.push({
      description,
      quantity: asNumber(entry.quantity),
      unit: asString(entry.unit),
      unitPrice: unitPrice == null ? null : round2(unitPrice),
      total: total == null ? null : round2(total),
      vatRate: asNumber(entry.vat_rate),
    });
  }
  return items;
}

/**
 * Map the snake_case JSON returned by the extraction prompt onto the
 * `ExtractedInvoice` contract. Tolerant of missing keys and string numbers.
 */
export function mapModelOutputToInvoice(
  raw: Record<string, unknown>,
  rawText: string | null,
): ExtractedInvoice {
  const documentType = asDocumentType(raw.document_type);
  const isInvoice = raw.is_invoice === true || documentType === 'invoice';

  const { account, code } = splitBankAccount(
    asString(raw.vendor_bank_account),
    asString(raw.vendor_bank_code),
  );

  const totalAmount = asNumber(raw.total_amount);
  const totalWithoutVat = asNumber(raw.subtotal);
  const currency = asString(raw.currency)?.toUpperCase() ?? null;

  const invoice: ExtractedInvoice = {
    ...emptyInvoice(),
    isInvoice,
    documentType: isInvoice && documentType === 'other' ? 'invoice' : documentType,
    supplierName: asString(raw.vendor_name),
    supplierIco: asString(raw.vendor_ic)?.replace(/\s/g, '') ?? null,
    supplierDic: asString(raw.vendor_dic)?.replace(/\s/g, '') ?? null,
    supplierAddress: asString(raw.vendor_address),
    invoiceNumber: asString(raw.invoice_number),
    variableSymbol: asNumericSymbol(raw.variable_symbol),
    constantSymbol: asNumericSymbol(raw.constant_symbol),
    specificSymbol: asNumericSymbol(raw.specific_symbol),
    orderNumber: asString(raw.order_number),
    issueDate: asIsoDate(raw.invoice_date),
    taxDate: asIsoDate(raw.tax_date),
    dueDate: asIsoDate(raw.due_date),
    totalAmount: totalAmount == null ? null : round2(totalAmount),
    totalWithoutVat: totalWithoutVat == null ? null : round2(totalWithoutVat),
    currency: currency != null && /^[A-Z]{3}$/.test(currency) ? currency : null,
    vatBreakdown: mapVatBreakdown(raw.vat_breakdown),
    reverseCharge: raw.is_reverse_charge === true,
    bankAccount: account,
    bankCode: code,
    iban: asString(raw.vendor_iban)?.replace(/\s/g, '') ?? null,
    swift: asString(raw.vendor_swift),
    paymentMethod: asString(raw.payment_method),
    lineItems: mapLineItems(raw.line_items),
    description: asString(raw.description),
    rawText,
  };

  // Derive variable symbol from invoice number when missing (digits only).
  if (invoice.variableSymbol == null && invoice.invoiceNumber != null) {
    invoice.variableSymbol = asNumericSymbol(invoice.invoiceNumber);
  }

  return invoice;
}

/** Model-reported classification confidence (0–1) if present. */
export function modelConfidenceOf(raw: Record<string, unknown>): number | null {
  const value = asNumber(raw.classification_confidence);
  if (value == null) return null;
  return Math.max(0, Math.min(1, value));
}
