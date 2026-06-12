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
import type { AbraExportResult, AbraFlexiConfig, ExtractedInvoice } from '../../types/contracts.js';
import { abraRequest, abraRejectionError, parseWriteResponse, abraGetList } from './client.js';
import { normalizeBaseUrl, formatNumber, isoDateOrNull, roundCurrency } from './helpers.js';
import { classifyVatBreakdown, STANDARD_VAT_RATE, REDUCED_VAT_RATE } from './payload.js';

const ENTITY_POKLADNI_POHYB = 'pokladni-pohyb' as const;

/** Cache the resolved cash-movement type per connection (rarely changes). */
const expenseTypeCache = new Map<string, string>();

/**
 * Resolve the cash-register movement type (typDokl). Prefers an expense (výdej)
 * type from `typ-pokladni-pohyb`; falls back to the configured default.
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
    const expense = rows.find((r) => {
      const t = String((r as { typPohybuK?: unknown }).typPohybuK ?? '').toLowerCase();
      return t.includes('vyd');
    });
    const kod = (expense as { kod?: string } | undefined)?.kod;
    if (kod) resolved = kod;
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
 */
export async function exportReceiptToPokladna(
  cfg: AbraFlexiConfig,
  invoice: ExtractedInvoice,
  supplierCode: string | null,
): Promise<AbraExportResult> {
  const typDokl = await resolveCashMovementType(cfg);
  const currency = invoice.currency?.trim().toUpperCase() || 'CZK';
  const isForeign = currency !== 'CZK';
  const vat = classifyVatBreakdown(invoice.vatBreakdown);

  const pohyb: Record<string, unknown> = {
    typDokl: `code:${typDokl}`,
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

  // VAT recap in the header (recomputed base × rate to match ABRA's arithmetic).
  const hasBuckets = vat.baseStandard !== 0 || vat.baseReduced !== 0 || vat.baseZero !== 0;
  const totalFallback = invoice.totalAmount ?? 0;

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
