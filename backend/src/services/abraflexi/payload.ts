/**
 * faktura-prijata payload builder (pure, unit-testable).
 *
 * Ported from V1 `services/erp/abraFlexiExport.service.ts` (buildInvoicePayload)
 * and adapted to the V2 `ExtractedInvoice` contract. Key gotchas preserved:
 *
 * - Reference fields use the `code:XYZ` form (typDokl, firma, mena, smerKod, ...)
 * - When real line items are present, header/item VAT amounts (sumDph*) are
 *   NOT sent — ABRA recalculates them and any OCR mismatch causes a 400.
 * - When no line items exist, one recap item per VAT bucket is generated with
 *   VAT computed as base × rate (matching ABRA's own arithmetic) — this also
 *   carries non-standard VAT rates that have no header field, so they are
 *   never silently dropped.
 * - Reverse charge (přenesená daňová povinnost): typObchodu = TUZEMSKO and
 *   zero VAT sums (the recipient self-assesses the VAT).
 * - Foreign currency uses the *Men amount fields + `mena`; exchange rate is
 *   left to ABRA's daily rate (extraction does not provide one).
 * - Amount rounding: Math.round(v * 100) / 100, formatted with 2 decimals.
 */

import type { ExtractedInvoice, AbraSupplierDefaults, VatBucket } from '../../types/contracts.js';
import type { AbraFlexiFakturaPrijata, AbraFlexiLineItem, FakturaPrijataEnvelope } from './types.js';
import {
  ENTITY_FAKTURA_PRIJATA,
  formatNumber,
  isKnownCzBankCode,
  isoDateOrNull,
  roundCurrency,
} from './helpers.js';

/** Current Czech VAT rates (2024+): standard 21 %, reduced 12 %. */
export const STANDARD_VAT_RATE = 21;
export const REDUCED_VAT_RATE = 12;

interface VatTotals {
  baseStandard: number;
  vatStandard: number;
  baseReduced: number;
  vatReduced: number;
  baseZero: number;
  /** Buckets with rates that have no dedicated header field (e.g. historical 10/15 %) */
  otherBuckets: VatBucket[];
}

/** Classify VAT buckets into the standard/reduced/zero header slots. */
export function classifyVatBreakdown(buckets: VatBucket[]): VatTotals {
  const totals: VatTotals = {
    baseStandard: 0,
    vatStandard: 0,
    baseReduced: 0,
    vatReduced: 0,
    baseZero: 0,
    otherBuckets: [],
  };

  for (const bucket of buckets) {
    if (bucket.rate === STANDARD_VAT_RATE) {
      totals.baseStandard += bucket.base;
      totals.vatStandard += bucket.vat;
    } else if (bucket.rate === REDUCED_VAT_RATE) {
      totals.baseReduced += bucket.base;
      totals.vatReduced += bucket.vat;
    } else if (bucket.rate === 0) {
      totals.baseZero += bucket.base;
    } else {
      // Non-standard rate — must not be dropped; carried via recap line items.
      totals.otherBuckets.push(bucket);
    }
  }

  totals.baseStandard = roundCurrency(totals.baseStandard);
  totals.vatStandard = roundCurrency(totals.vatStandard);
  totals.baseReduced = roundCurrency(totals.baseReduced);
  totals.vatReduced = roundCurrency(totals.vatReduced);
  totals.baseZero = roundCurrency(totals.baseZero);
  return totals;
}

/** Conditionally set a `code:` reference field (omit-if-absent semantics). */
function setCodeField(
  target: AbraFlexiFakturaPrijata,
  field: keyof AbraFlexiFakturaPrijata,
  value: string | null,
): void {
  if (value) {
    (target as Record<string, unknown>)[field] = `code:${value}`;
  }
}

/**
 * Build line items from extracted invoice items. VAT amounts omitted — ABRA
 * computes them. Credit notes (dobropisy) carry the sign on the quantity
 * (mnozMj < 0) with a positive unit price — ABRA requires "záporné množství".
 */
function buildLineItemsFromExtraction(
  invoice: ExtractedInvoice,
  isCreditNote: boolean,
): AbraFlexiLineItem[] {
  return invoice.lineItems.map((item) => {
    if (isCreditNote) {
      const rawQty = item.quantity && item.quantity !== 0 ? item.quantity : 1;
      let unitPrice = item.unitPrice;
      if (unitPrice === null && item.total !== null) unitPrice = item.total / rawQty;
      return {
        nazev: item.description || 'Položka',
        mnozMj: -Math.abs(rawQty),
        cenaMj: formatNumber(unitPrice === null ? 0 : Math.abs(roundCurrency(unitPrice))),
        szbDph: item.vatRate ?? 0,
      };
    }
    const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
    let unitPrice = item.unitPrice;
    if (unitPrice === null && item.total !== null) {
      unitPrice = roundCurrency(item.total / quantity);
    }
    return {
      nazev: item.description || 'Položka',
      mnozMj: quantity,
      cenaMj: formatNumber(unitPrice ?? 0),
      szbDph: invoice.reverseCharge ? 0 : (item.vatRate ?? 0),
      // sumDph intentionally omitted — ABRA calculates it from cenaMj × mnozMj × szbDph
    };
  });
}

/**
 * Build fallback recap items — one summary line per VAT bucket.
 * VAT is recomputed as base × rate so it matches ABRA's own arithmetic
 * (the OCR-extracted vat value risks a "differs from calculated" 400).
 */
function buildRecapLineItems(invoice: ExtractedInvoice, isCreditNote: boolean): AbraFlexiLineItem[] {
  const items: AbraFlexiLineItem[] = [];

  for (const bucket of invoice.vatBreakdown) {
    if (bucket.base === 0 && bucket.vat === 0) continue;

    if (isCreditNote) {
      // Credit note: negative quantity, positive base, let ABRA compute the VAT.
      items.push({
        nazev: `Dobropis - sazba DPH ${bucket.rate} %`,
        mnozMj: -1,
        cenaMj: formatNumber(Math.abs(bucket.base)),
        szbDph: bucket.rate,
      });
      continue;
    }

    if (invoice.reverseCharge) {
      // PDP: the document carries no VAT — recipient self-assesses
      items.push({
        nazev: `Položka - přenesená daňová povinnost (${bucket.rate} %)`,
        mnozMj: 1,
        cenaMj: formatNumber(bucket.base),
        szbDph: 0,
        sumDph: '0',
      });
      continue;
    }

    const calculatedVat = bucket.rate > 0 ? roundCurrency((bucket.base * bucket.rate) / 100) : 0;
    items.push({
      nazev:
        bucket.rate === 0
          ? 'Položka - bez DPH (osvobozeno)'
          : `Položka - sazba DPH ${bucket.rate} %`,
      mnozMj: 1,
      cenaMj: formatNumber(bucket.base),
      szbDph: bucket.rate,
      sumDph: formatNumber(calculatedVat),
    });
  }

  return items;
}

/** Set domestic (CZK) amount fields. `includeVatSums` only for the no-real-items path. */
function setDomesticAmounts(
  faktura: AbraFlexiFakturaPrijata,
  vat: VatTotals,
  includeVatSums: boolean,
): void {
  if (vat.baseZero !== 0) faktura.sumOsv = formatNumber(vat.baseZero);
  if (vat.baseStandard !== 0) faktura.sumZklZakl = formatNumber(vat.baseStandard);
  if (vat.baseReduced !== 0) faktura.sumZklSniz = formatNumber(vat.baseReduced);

  if (includeVatSums) {
    // Recalculated from base × rate to match ABRA's arithmetic (never the OCR value)
    const recalcStandard = roundCurrency((vat.baseStandard * STANDARD_VAT_RATE) / 100);
    const recalcReduced = roundCurrency((vat.baseReduced * REDUCED_VAT_RATE) / 100);
    if (recalcStandard !== 0) faktura.sumDphZakl = formatNumber(recalcStandard);
    if (recalcReduced !== 0) faktura.sumDphSniz = formatNumber(recalcReduced);
  }
}

/** Set foreign currency (*Men) amount fields. */
function setForeignAmounts(
  faktura: AbraFlexiFakturaPrijata,
  invoice: ExtractedInvoice,
  vat: VatTotals,
  currency: string,
): void {
  if (vat.baseZero !== 0) faktura.sumOsvMen = formatNumber(vat.baseZero);
  if (vat.baseStandard !== 0) faktura.sumZklZaklMen = formatNumber(vat.baseStandard);
  if (vat.baseReduced !== 0) faktura.sumZklSnizMen = formatNumber(vat.baseReduced);

  const totalMen =
    invoice.totalAmount ??
    roundCurrency(
      vat.baseZero +
        vat.baseStandard +
        vat.vatStandard +
        vat.baseReduced +
        vat.vatReduced +
        invoice.vatBreakdown
          .filter((b) => b.rate !== 0 && b.rate !== STANDARD_VAT_RATE && b.rate !== REDUCED_VAT_RATE)
          .reduce((sum, b) => sum + b.base + b.vat, 0),
    );
  if (totalMen !== 0) faktura.sumCelkemMen = formatNumber(totalMen);
  faktura.mena = `code:${currency}`;
}

/**
 * Build the complete winstrom envelope for POST /faktura-prijata.json.
 *
 * @param invoice  - OCR/ISDOC extraction result
 * @param defaults - Defaults harvested from the supplier's previous invoices
 *                   (typ dokladu, předpis zaúčtování, členění DPH, středisko, forma úhrady)
 * @param supplierCode - adresar `kod` to reference as `firma` (null → omitted,
 *                       the invoice is created without a supplier link)
 */
export function buildInvoicePayload(
  invoice: ExtractedInvoice,
  defaults: AbraSupplierDefaults,
  supplierCode: string | null,
): FakturaPrijataEnvelope {
  const faktura: AbraFlexiFakturaPrijata = {};

  // --- Document identification ---
  setCodeField(faktura, 'typDokl', defaults.documentType);
  // firma must be a real ERP code — never a display name
  setCodeField(faktura, 'firma', supplierCode);
  if (invoice.invoiceNumber) faktura.cisDosle = invoice.invoiceNumber;
  if (invoice.variableSymbol) faktura.varSym = invoice.variableSymbol;
  if (invoice.specificSymbol) faktura.specSym = invoice.specificSymbol;

  // --- Dates (ISO YYYY-MM-DD pass-through; DUZP falls back to issue date) ---
  const issueDate = isoDateOrNull(invoice.issueDate);
  const dueDate = isoDateOrNull(invoice.dueDate);
  const taxDate = isoDateOrNull(invoice.taxDate) ?? issueDate;
  if (issueDate) faktura.datVyst = issueDate;
  if (dueDate) faktura.datSplat = dueDate;
  if (taxDate) faktura.duzpPuv = taxDate;

  // --- Amounts (currency regime: PDP / foreign / standard domestic) ---
  const currency = invoice.currency?.trim().toUpperCase() || 'CZK';
  const isForeign = currency !== 'CZK';
  const vat = classifyVatBreakdown(invoice.vatBreakdown);
  const hasRealItems = invoice.lineItems.length > 0;
  // Credit notes (dobropisy) carry the sign on the line-item quantity, so the
  // header sums (which can't be negated cleanly) are never sent — ABRA derives
  // them from the negative-quantity items.
  const isCreditNote = invoice.documentType === 'credit_note';

  if (invoice.reverseCharge && isForeign) {
    faktura.mena = `code:${currency}`;
    if (!hasRealItems && !isCreditNote) setForeignAmounts(faktura, invoice, vat, currency);
    faktura.typObchodu = 'TUZEMSKO';
  } else if (invoice.reverseCharge) {
    setDomesticAmounts(faktura, vat, false);
    faktura.sumDphZakl = '0';
    faktura.sumDphSniz = '0';
    const totalBase = roundCurrency(vat.baseZero + vat.baseStandard + vat.baseReduced);
    if (totalBase !== 0) faktura.sumCelkem = formatNumber(totalBase);
    faktura.typObchodu = 'TUZEMSKO';
  } else if (isForeign) {
    // Same rule as the domestic path: with real line items ABRA derives the
    // foreign-currency (*Men) sums from them, so only send header sums in the
    // no-items recap path. `mena` must always be set.
    faktura.mena = `code:${currency}`;
    if (!hasRealItems && !isCreditNote) setForeignAmounts(faktura, invoice, vat, currency);
  } else {
    // With real line items ABRA derives every base/VAT sum from them. Sending
    // header sums computed from the OCR vatBreakdown — which can disagree with
    // the items (e.g. items at 21 % but the breakdown says 12 %) — triggers
    // "Zadaná hodnota … se liší od vypočtené". Only send header sums in the
    // no-items recap path, where they match the generated recap lines.
    if (!hasRealItems && !isCreditNote) setDomesticAmounts(faktura, vat, true);
    faktura.typObchodu = 'TUZEMSKO';
  }

  // --- Common fields ---
  faktura.stat = 'code:CZ';
  faktura.statDph = 'code:CZ';
  if (invoice.description) faktura.popis = invoice.description;

  // --- Line items (real items, or one recap item per VAT bucket) ---
  const items = hasRealItems
    ? buildLineItemsFromExtraction(invoice, isCreditNote)
    : buildRecapLineItems(invoice, isCreditNote);
  if (items.length > 0) {
    faktura.polozkyFaktury = items;
    faktura.bezPolozek = 'false';
  } else {
    faktura.bezPolozek = 'true';
  }

  // --- Accounting defaults from supplier history (header level) ---
  setCodeField(faktura, 'typUcOp', defaults.predpisZauctovani);
  setCodeField(faktura, 'clenDph', defaults.cleneniDph);
  setCodeField(faktura, 'stredisko', defaults.stredisko);
  setCodeField(faktura, 'formaUhradyCis', defaults.formaUhrady);

  // --- Bank details ---
  // buc (account number) and iban are free-text and always safe to send.
  // smerKod is a reference into ABRA's bank číselník — only send it for a real
  // bank code, else an OCR misread (e.g. 3830) makes ABRA reject the invoice.
  if (invoice.iban) faktura.iban = invoice.iban;
  if (invoice.bankAccount) faktura.buc = invoice.bankAccount;
  if (isKnownCzBankCode(invoice.bankCode)) {
    faktura.smerKod = `code:${invoice.bankCode}`;
  }

  // --- Currency ---
  if (!isForeign) faktura.mena = 'code:CZK';

  return {
    winstrom: {
      [ENTITY_FAKTURA_PRIJATA]: faktura,
    },
  };
}
