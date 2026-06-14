/**
 * Receipt (účtenka) export — creates a cash-register movement (pokladni-pohyb)
 * in ABRA Flexi instead of a received invoice. Ported from Foldera V1
 * (services/erp/abraFlexiReceiptExport.service.ts).
 *
 * A purchase receipt is money leaving the cash register, i.e. an expense
 * (výdej). The movement type is resolved from `typ-pokladni-pohyb` (preferring a
 * výdej type); deployments without one fall back to ABRA_DEFAULT_TYP_POKLADNA.
 * The target cash register is ABRA_DEFAULT_POKLADNA.
 *
 * Receipts carry no real line items — the VAT recap is sent in the header
 * (bezPolozek = true), so there is nothing for ABRA to recompute against.
 */

import env from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { toError } from '../../utils/errors.js';
import type {
  AbraExportResult,
  AbraFlexiConfig,
  AbraSupplierDefaults,
  ExtractedInvoice,
} from '../../types/contracts.js';
import { abraRequest, abraRejectionError, parseWriteResponse, abraGetList } from './client.js';
import { normalizeBaseUrl, formatNumber, isoDateOrNull, roundCurrency } from './helpers.js';
import { classifyVatBreakdown, STANDARD_VAT_RATE, REDUCED_VAT_RATE } from './payload.js';

const ENTITY_POKLADNI_POHYB = 'pokladni-pohyb' as const;

/** Cache the resolved cash-movement type per connection (rarely changes). */
const expenseTypeCache = new Map<string, string>();

/** Strip diacritics + lowercase for tolerant text matching of číselník codes. */
function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Resolve the cash-register movement type (typDokl) for a purchase receipt.
 *
 * A purchase receipt is money LEAVING the cash register, so it must be booked
 * as an expense (výdej). We pick a type whose `typPohybuK` is explicitly výdej;
 * if a deployment leaves `typPohybuK` blank (as the FlexiBee demo does for
 * "VÝDAJE HOTOVĚ"), we fall back to matching the `kód` name. An explicit příjem
 * type is never chosen. Only if nothing expense-like exists do we use the
 * configured default — and we log loudly, because booking a receipt as příjem
 * is wrong-direction.
 */
async function resolveCashMovementType(cfg: AbraFlexiConfig): Promise<string> {
  const cacheKey = `${cfg.apiUrl}|${cfg.companyId}`;
  const cached = expenseTypeCache.get(cacheKey);
  if (cached) return cached;

  let resolved = env.ABRA_DEFAULT_TYP_POKLADNA;
  try {
    const rows = await abraGetList(
      cfg,
      '/typ-pokladni-pohyb.json?detail=custom:kod,typPohybuK&limit=100',
      'typ-pokladni-pohyb',
    );
    const isExpense = (r: unknown): boolean => {
      const row = r as { typPohybuK?: unknown; kod?: unknown };
      const t = String(row.typPohybuK ?? '').toLowerCase();
      if (t.includes('vyd')) return true; // typPohybu.vydej — authoritative
      if (t.includes('prijem')) return false; // explicit příjem — never an expense
      // typPohybuK blank/unknown → infer from the kód naming (e.g. "VÝDAJE HOTOVĚ").
      return /vyd/.test(normalizeText(String(row.kod ?? '')));
    };
    const expense = rows.find(isExpense);
    const kod = (expense as { kod?: string } | undefined)?.kod;
    if (kod) {
      resolved = kod;
    } else {
      logger.warn(
        { companyId: cfg.companyId, fallback: resolved },
        '[AbraFlexi] No výdej cash-movement type found — receipt may be booked in the wrong direction',
      );
    }
  } catch (error) {
    logger.warn(
      { companyId: cfg.companyId, error: toError(error).message },
      '[AbraFlexi] Failed to resolve cash movement type — using default',
    );
  }

  expenseTypeCache.set(cacheKey, resolved);
  return resolved;
}

/** Build the ABRA Flexi web UI deep link for a cash movement. */
function buildPokladnaWebUrl(cfg: AbraFlexiConfig, id: string): string {
  const base = normalizeBaseUrl(cfg.apiUrl);
  return `${base.replace('/c/', '/flexi/')}/${ENTITY_POKLADNI_POHYB}/${encodeURIComponent(id)}/edit`;
}

/**
 * Export a receipt as a cash-register movement (pokladni-pohyb).
 *
 * @param supplierCode adresar `kod` to reference as `firma` (optional)
 * @param defaults     accounting classification (history- or AI-derived); the
 *                     řádek DPH / předkontace / řádek KH / středisko are applied
 *                     the same way as on invoices.
 */
export async function exportReceiptToPokladna(
  cfg: AbraFlexiConfig,
  invoice: ExtractedInvoice,
  supplierCode: string | null,
  defaults: AbraSupplierDefaults,
): Promise<AbraExportResult> {
  const typDokl = await resolveCashMovementType(cfg);
  const currency = invoice.currency?.trim().toUpperCase() || 'CZK';
  const isForeign = currency !== 'CZK';
  // A purchase receipt is booked as a cash výdej with POSITIVE amounts (the
  // movement type carries the direction). Force positive in case an older/stored
  // extraction still holds the negative the model occasionally returns.
  const raw = classifyVatBreakdown(invoice.vatBreakdown);
  const vat = {
    baseStandard: Math.abs(raw.baseStandard),
    baseReduced: Math.abs(raw.baseReduced),
    baseZero: Math.abs(raw.baseZero),
  };

  const pohyb: Record<string, unknown> = {
    typDokl: `code:${typDokl}`,
    // Force the movement DIRECTION to expense. In ABRA Flexi the direction is a
    // field ON the cash movement (typPohybuK) that otherwise defaults to příjem
    // — so even with a neutrally-configured typDokl, a purchase receipt is booked
    // as a cash výdej, never an income.
    typPohybuK: 'typPohybu.vydej',
    pokladna: `code:${env.ABRA_DEFAULT_POKLADNA}`,
    stat: 'code:CZ',
    statDph: 'code:CZ',
    bezPolozek: 'true',
  };
  if (supplierCode) pohyb.firma = `code:${supplierCode}`;
  if (invoice.invoiceNumber) pohyb.cisDosle = invoice.invoiceNumber;
  const issueDate = isoDateOrNull(invoice.issueDate);
  if (issueDate) pohyb.datVyst = issueDate;
  if (invoice.description) pohyb.popis = invoice.description;

  // Accounting classification (history precedence; AI fills gaps upstream).
  if (defaults.cleneniDph) pohyb.clenDph = `code:${defaults.cleneniDph}`;
  if (defaults.predpisZauctovani) pohyb.typUcOp = `code:${defaults.predpisZauctovani}`;
  if (defaults.cleneniKonVykDph) pohyb.clenKonVykDph = `code:${defaults.cleneniKonVykDph}`;
  if (defaults.stredisko) pohyb.stredisko = `code:${defaults.stredisko}`;

  // VAT recap in the header (recomputed base × rate to match ABRA's arithmetic).
  const hasBuckets = vat.baseStandard !== 0 || vat.baseReduced !== 0 || vat.baseZero !== 0;
  const totalFallback = Math.abs(invoice.totalAmount ?? 0);

  if (!isForeign) {
    if (vat.baseZero !== 0) pohyb.sumOsv = formatNumber(vat.baseZero);
    if (vat.baseStandard !== 0) {
      pohyb.sumZklZakl = formatNumber(vat.baseStandard);
      pohyb.sumDphZakl = formatNumber(roundCurrency((vat.baseStandard * STANDARD_VAT_RATE) / 100));
    }
    if (vat.baseReduced !== 0) {
      pohyb.sumZklSniz = formatNumber(vat.baseReduced);
      pohyb.sumDphSniz = formatNumber(roundCurrency((vat.baseReduced * REDUCED_VAT_RATE) / 100));
    }
    // No VAT breakdown extracted — record the whole total as a VAT-exempt base.
    if (!hasBuckets && totalFallback !== 0) pohyb.sumOsv = formatNumber(totalFallback);
    pohyb.mena = 'code:CZK';
  } else {
    if (vat.baseStandard !== 0) pohyb.sumZklZaklMen = formatNumber(vat.baseStandard);
    if (vat.baseReduced !== 0) pohyb.sumZklSnizMen = formatNumber(vat.baseReduced);
    if (totalFallback !== 0) pohyb.sumCelkemMen = formatNumber(totalFallback);
    pohyb.mena = `code:${currency}`;
  }

  logger.info(
    { companyId: cfg.companyId, typDokl, pokladna: env.ABRA_DEFAULT_POKLADNA, receiptNumber: invoice.invoiceNumber },
    '[AbraFlexi] Exporting receipt to cash register',
  );

  const res = await abraRequest(cfg, {
    path: `/${ENTITY_POKLADNI_POHYB}.json`,
    method: 'POST',
    body: JSON.stringify({ winstrom: { [ENTITY_POKLADNI_POHYB]: pohyb } }),
  });
  if (!res.ok) {
    throw abraRejectionError(res, 'export účtenky do pokladny');
  }

  const { id, kod } = parseWriteResponse(res.text, 'účtenky');
  let code = kod;
  if (!code) {
    try {
      const rows = await abraGetList(
        cfg,
        `/${ENTITY_POKLADNI_POHYB}/${encodeURIComponent(id)}.json?detail=custom:kod`,
        ENTITY_POKLADNI_POHYB,
      );
      code = (rows[0] as { kod?: string } | undefined)?.kod ?? null;
    } catch {
      /* non-critical — fall back to id */
    }
  }

  const webUrl = buildPokladnaWebUrl(cfg, id);
  logger.info({ companyId: cfg.companyId, pokladnaDocId: id, code: code ?? id }, '[AbraFlexi] Receipt exported');

  return { id, code: code ?? id, webUrl, supplierCreated: false };
}

export { ENTITY_POKLADNI_POHYB };
