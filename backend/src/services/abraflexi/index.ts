/**
 * ABRA Flexi REST client — public API for the V2 pipeline.
 *
 * Self-contained module: config is passed per call (`AbraFlexiConfig` from
 * `types/contracts.ts`, decrypted by the caller), no DB access in here.
 *
 * Typical pipeline usage:
 *   const dup = await findDuplicateInvoice(cfg, { supplierIco, variableSymbol, invoiceNumber });
 *   if (dup) return skip(dup);
 *   const supplier = invoice.supplierIco ? await findSupplierByIco(cfg, invoice.supplierIco) : null;
 *   const defaults = supplier ? await getSupplierDefaults(cfg, supplier.code) : EMPTY;
 *   const result = await exportPurchaseInvoice(cfg, invoice, defaults);
 *   await uploadInvoiceAttachment(cfg, result.id, filePath, fileName, mimeType);
 */

export { testAbraConnection } from './connection.js';
export { findSupplierByIco, getSupplierDefaults } from './suppliers.js';
export { findDuplicateInvoice } from './duplicates.js';
export { exportPurchaseInvoice } from './export.js';
export { uploadInvoiceAttachment } from './attachments.js';
export { buildAbraWebUrl } from './helpers.js';

// Lower-level building blocks exported for unit tests / advanced callers
export { buildInvoicePayload } from './payload.js';
