/**
 * Purchase invoice export orchestrator.
 *
 * V2 flow is fully automatic (no user review):
 *   1. Resolve the supplier in adresar by IČO
 *   2. Not found → auto-create the supplier (name/IČO/DIČ/address)
 *   3. Build the faktura-prijata payload (supplier-history defaults fill the
 *      fields extraction does not provide)
 *   4. POST to /faktura-prijata.json, parse id + code from winstrom results
 *   5. Best-effort: attach the supplier's bank account to a newly created
 *      adresar entry (never fails the export)
 */

import { logger } from '../../utils/logger.js';
import { AppError, ErrorCodes, toError } from '../../utils/errors.js';
import type {
  AbraExportResult,
  AbraFlexiConfig,
  AbraSupplierDefaults,
  ExtractedInvoice,
} from '../../types/contracts.js';
import { abraRequest, abraRejectionError, parseWriteResponse, abraGetList } from './client.js';
import { buildAbraWebUrl, ENTITY_FAKTURA_PRIJATA } from './helpers.js';
import { buildInvoicePayload } from './payload.js';
import { findSupplierByIco, createSupplierInAbra, addBankAccountToSupplier } from './suppliers.js';
import { abraInvoiceRowSchema } from './types.js';

/**
 * Read back the document `kod` (e.g. "FAP-2026/0123") after creation.
 * The POST result reliably contains only the id — the human-readable code
 * needs one extra GET. Non-critical: falls back to the id.
 */
async function fetchInvoiceCode(cfg: AbraFlexiConfig, invoiceId: string): Promise<string | null> {
  try {
    const rows = await abraGetList(
      cfg,
      `/${ENTITY_FAKTURA_PRIJATA}/${encodeURIComponent(invoiceId)}.json?detail=custom:id,kod`,
      ENTITY_FAKTURA_PRIJATA,
    );
    const first = rows[0];
    if (first === undefined) return null;
    const parsed = abraInvoiceRowSchema.safeParse(first);
    return parsed.success ? (parsed.data.kod ?? null) : null;
  } catch (error: unknown) {
    logger.warn(
      { companyId: cfg.companyId, invoiceId, error: toError(error).message },
      '[AbraFlexi] Failed to read back invoice code (non-critical)',
    );
    return null;
  }
}

/**
 * Export an extracted purchase invoice to ABRA Flexi as faktura-prijata.
 * Auto-creates the supplier in adresar when it is missing.
 *
 * @param invoice  - OCR/ISDOC extraction result (must be a purchase invoice)
 * @param defaults - Supplier defaults from {@link getSupplierDefaults} (pass
 *                   all-null defaults for a brand-new supplier)
 * @throws {AppError} BAD_REQUEST when the document is not an exportable
 *   invoice or ABRA rejects the payload; SERVICE_UNAVAILABLE on transport
 *   failures (after retries)
 */
export async function exportPurchaseInvoice(
  cfg: AbraFlexiConfig,
  invoice: ExtractedInvoice,
  defaults: AbraSupplierDefaults,
): Promise<AbraExportResult> {
  if (!invoice.isInvoice) {
    throw new AppError(ErrorCodes.BAD_REQUEST, 'Dokument není faktura — export do ABRA Flexi přeskočen', 400);
  }

  logger.info(
    {
      companyId: cfg.companyId,
      supplierIco: invoice.supplierIco,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
    },
    '[AbraFlexi] Starting purchase invoice export',
  );

  // --- 1+2. Resolve or auto-create the supplier ---
  let supplierCode: string | null = null;
  let supplierCreated = false;

  if (invoice.supplierIco) {
    const existing = await findSupplierByIco(cfg, invoice.supplierIco);
    if (existing) supplierCode = existing.code;
  }

  if (!supplierCode && (invoice.supplierName || invoice.supplierIco)) {
    const created = await createSupplierInAbra(cfg, invoice);
    supplierCode = created.code;
    supplierCreated = true;
  }

  if (!supplierCode) {
    logger.warn(
      { companyId: cfg.companyId, invoiceNumber: invoice.invoiceNumber },
      '[AbraFlexi] No supplier name or IČO extracted — exporting without firma reference',
    );
  }

  // --- 3. Build payload ---
  const payload = buildInvoicePayload(invoice, defaults, supplierCode);

  // --- 4. POST to ABRA Flexi ---
  const res = await abraRequest(cfg, {
    path: `/${ENTITY_FAKTURA_PRIJATA}.json`,
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw abraRejectionError(res, 'export faktury');
  }

  const { id, kod } = parseWriteResponse(res.text, 'faktury');
  const code = kod ?? (await fetchInvoiceCode(cfg, id)) ?? id;
  const webUrl = buildAbraWebUrl(cfg, id);

  logger.info(
    { companyId: cfg.companyId, abraInvoiceId: id, code, supplierCreated },
    '[AbraFlexi] Purchase invoice exported',
  );

  // --- 5. Bank account for a newly created supplier (best-effort) ---
  if (supplierCreated && supplierCode) {
    await addBankAccountToSupplier(cfg, supplierCode, invoice);
  }

  return { id, code, webUrl, supplierCreated };
}
