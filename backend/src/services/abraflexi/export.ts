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
import env from '../../config/env.js';
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
async function fetchInvoiceCode(
  cfg: AbraFlexiConfig,
  invoiceId: string,
  entity: string = ENTITY_FAKTURA_PRIJATA,
): Promise<string | null> {
  try {
    const rows = await abraGetList(
      cfg,
      `/${entity}/${encodeURIComponent(invoiceId)}.json?detail=custom:id,kod`,
      entity,
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
  options: { entity?: string; typDokl?: string } = {},
): Promise<AbraExportResult> {
  const entity = options.entity ?? ENTITY_FAKTURA_PRIJATA;
  const isCreditNote = invoice.documentType === 'credit_note';
  const isAdvanceLike =
    invoice.documentType === 'advance_invoice' || invoice.documentType === 'tax_payment';
  if (!invoice.isInvoice && !isCreditNote && !isAdvanceLike) {
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
  // Without a typDokl ABRA cannot assign an internal number. When the supplier
  // has no history to harvest a type from, fall back to the configured default
  // received-invoice type so the export still gets a number series.
  // Credit notes always go to the dobropis document type; regular invoices use
  // the supplier-history type, falling back to the configured default.
  // An explicit typDokl from the caller (advance invoice / DDPP) wins; otherwise
  // credit notes use the dobropis type and regular invoices the supplier-history
  // type, falling back to the configured default.
  const documentType =
    options.typDokl ??
    (isCreditNote
      ? env.ABRA_DEFAULT_TYP_DOBROPIS
      : (defaults.documentType ?? env.ABRA_DEFAULT_TYP_FAKTURY_PRIJATE));
  const effectiveDefaults: AbraSupplierDefaults = { ...defaults, documentType };
  logger.info(
    { companyId: cfg.companyId, entity, defaultTyp: documentType, documentClass: invoice.documentType },
    '[AbraFlexi] Resolved document type (typDokl)',
  );
  const payload = buildInvoicePayload(invoice, effectiveDefaults, supplierCode, entity);

  // --- 4. POST to ABRA Flexi ---
  const res = await abraRequest(cfg, {
    path: `/${entity}.json`,
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw abraRejectionError(res, 'export dokladu');
  }

  const { id, kod } = parseWriteResponse(res.text, 'dokladu');
  const code = kod ?? (await fetchInvoiceCode(cfg, id, entity)) ?? id;
  const webUrl = buildAbraWebUrl(cfg, id, entity);

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
