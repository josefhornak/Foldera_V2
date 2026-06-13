/**
 * Confidence scoring (0–100) for extracted invoices.
 *
 * The pipeline is fully automatic (no user review), so the score reflects
 * weighted presence + validity of the key fields needed for ERP export:
 * - supplier IČO (valid 8-digit with mod-11 checksum)
 * - invoice number
 * - parseable ISO dates
 * - total amount consistent with the VAT breakdown
 * - numeric variable symbol
 * plus the model-reported classification confidence when available.
 *
 * ISDOC/UBL XML values are ground truth → 95+.
 */

import type { ExtractedInvoice } from '../../types/contracts.js';

/** Financial rounding — Math.round(v*100)/100, never toFixed. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Validate a Czech IČO: exactly 8 digits with a mod-11 weighted checksum.
 */
export function isValidIco(ico: string | null): boolean {
  if (ico == null) return false;
  const cleaned = ico.replace(/\s/g, '');
  if (!/^\d{8}$/.test(cleaned)) return false;

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += Number(cleaned[i] ?? '0') * (8 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(cleaned[7] ?? '-1');
}

/** Strict YYYY-MM-DD validation including calendar plausibility. */
export function isIsoDate(value: string | null): boolean {
  if (value == null) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Tolerance for haléřové vyrovnání / per-rate rounding on Czech invoices. */
const TOTAL_TOLERANCE = 1.0;

/**
 * Check whether totalAmount is consistent with the VAT breakdown
 * (sum of base+vat over all buckets), or — for reverse-charge / VAT-free
 * documents without a breakdown — with totalWithoutVat.
 */
export function isTotalConsistent(invoice: ExtractedInvoice): boolean {
  if (invoice.totalAmount == null) return false;

  if (invoice.vatBreakdown.length > 0) {
    const sum = round2(
      invoice.vatBreakdown.reduce((acc, bucket) => acc + bucket.base + bucket.vat, 0),
    );
    return Math.abs(sum - invoice.totalAmount) <= TOTAL_TOLERANCE;
  }

  if (invoice.reverseCharge && invoice.totalWithoutVat != null) {
    return Math.abs(invoice.totalWithoutVat - invoice.totalAmount) <= TOTAL_TOLERANCE;
  }

  return false;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Score an OCR-sourced extraction 0–100.
 *
 * Weights (sum 100):
 * - supplier name present .......... 10
 * - supplier IČO valid ............. 15 (8 when present but checksum fails)
 * - invoice number present ......... 15
 * - issue date valid ISO ........... 10
 * - due date valid ISO .............  5
 * - total amount present ........... 15
 * - total consistent with VAT ...... 10
 * - variable symbol numeric ........ 10
 * - currency valid ISO 4217 ........  5
 * - bank coordinates present .......  5
 *
 * When the model reported a classification confidence (0–1), the final score
 * blends 80 % field score + 20 % model confidence.
 */
export function scoreOcrConfidence(
  invoice: ExtractedInvoice,
  modelConfidence?: number | null,
): number {
  // Receipts (účtenky) have no invoice number / variable symbol / due date /
  // bank details, so scoring them on the invoice weights caps them ~65 %. Score
  // them on the fields a receipt actually carries instead.
  let score =
    invoice.documentType === 'receipt'
      ? scoreReceiptFields(invoice)
      : scoreInvoiceFields(invoice);

  if (modelConfidence != null && modelConfidence >= 0 && modelConfidence <= 1) {
    score = 0.8 * score + 20 * modelConfidence;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Field score (0–100) for invoices and credit notes. */
function scoreInvoiceFields(invoice: ExtractedInvoice): number {
  let score = 0;

  if (invoice.supplierName != null && invoice.supplierName.trim().length > 1) score += 10;

  if (isValidIco(invoice.supplierIco)) {
    score += 15;
  } else if (invoice.supplierIco != null && /\d{6,}/.test(invoice.supplierIco)) {
    score += 8;
  }

  if (invoice.invoiceNumber != null && invoice.invoiceNumber.trim() !== '') score += 15;
  if (isIsoDate(invoice.issueDate)) score += 10;
  if (isIsoDate(invoice.dueDate)) score += 5;
  // Credit notes legitimately carry negative totals — score presence, not sign.
  if (invoice.totalAmount != null && Math.abs(invoice.totalAmount) > 0) score += 15;
  if (isTotalConsistent(invoice)) score += 10;
  if (invoice.variableSymbol != null && /^\d+$/.test(invoice.variableSymbol)) score += 10;
  if (invoice.currency != null && CURRENCY_PATTERN.test(invoice.currency)) score += 5;
  if ((invoice.bankAccount != null && invoice.bankCode != null) || invoice.iban != null) score += 5;

  return score;
}

/**
 * Field score (0–100) for receipts — weighted on what a POS receipt carries:
 * supplier (name + IČO), issue date, total amount + VAT consistency, currency.
 */
function scoreReceiptFields(invoice: ExtractedInvoice): number {
  let score = 0;

  if (invoice.supplierName != null && invoice.supplierName.trim().length > 1) score += 10;

  if (isValidIco(invoice.supplierIco)) {
    score += 20;
  } else if (invoice.supplierIco != null && /\d{6,}/.test(invoice.supplierIco)) {
    score += 10;
  }

  if (isIsoDate(invoice.issueDate)) score += 15;
  // A receipt total may be extracted negative (read as a return); score presence.
  if (invoice.totalAmount != null && Math.abs(invoice.totalAmount) > 0) score += 30;
  if (isTotalConsistent(invoice)) score += 15;
  if (invoice.currency != null && CURRENCY_PATTERN.test(invoice.currency)) score += 10;

  return score;
}

/**
 * Score an ISDOC/UBL-sourced extraction. XML values are ground truth →
 * base 95, with small bonuses for verifiable key fields, capped at 100.
 */
export function scoreIsdocConfidence(invoice: ExtractedInvoice): number {
  let score = 95;
  if (invoice.invoiceNumber != null) score += 2;
  if (isValidIco(invoice.supplierIco)) score += 1;
  if (isIsoDate(invoice.issueDate)) score += 1;
  if (isTotalConsistent(invoice)) score += 1;
  return Math.min(100, score);
}
