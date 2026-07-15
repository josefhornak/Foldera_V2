/**
 * The `documents` table denormalizes a handful of extraction fields into their
 * own columns so the list view can filter and search without touching the
 * `extracted` JSON. Anything that writes `extracted` must write these columns
 * from the same object — the pipeline and the manual edit both go through here,
 * so the two can't drift apart.
 */
import type { ExtractedInvoice } from '../types/contracts.js';

export function documentColumnsFromExtracted(invoice: ExtractedInvoice) {
  return {
    supplierName: invoice.supplierName,
    supplierIco: invoice.supplierIco,
    invoiceNumber: invoice.invoiceNumber,
    variableSymbol: invoice.variableSymbol,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totalAmount: invoice.totalAmount != null ? String(invoice.totalAmount) : null,
    currency: invoice.currency,
    extracted: invoice,
  };
}
