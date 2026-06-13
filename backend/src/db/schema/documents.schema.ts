import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { companies } from './companies.schema.js';
import { sources } from './sources.schema.js';
import type { ExtractedInvoice } from '../../types/contracts.js';

export const DOCUMENT_STATUS = {
  /** Picked up from a source, extraction/export in progress */
  PROCESSING: 'processing',
  /** Successfully created in ABRA Flexi */
  EXPORTED: 'exported',
  /** Extraction succeeded but ABRA Flexi rejected the document — retryable */
  EXPORT_FAILED: 'export_failed',
  /** Extraction itself failed — retry re-runs nothing (no file kept), shown as error */
  EXTRACTION_FAILED: 'extraction_failed',
  /** Same content already processed (hash) or already exists in ABRA Flexi */
  SKIPPED_DUPLICATE: 'skipped_duplicate',
  /** Document classified as something other than a purchase invoice */
  SKIPPED_NOT_INVOICE: 'skipped_not_invoice',
  /** Trial or plan limit reached — not processed (no OCR spent) */
  SKIPPED_LIMIT: 'skipped_limit',
} as const;

export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

/**
 * Metadata of a processed document. The file itself is NEVER stored — it only
 * exists on disk for the duration of processing and is uploaded to ABRA Flexi
 * as an attachment. `extracted` keeps the extraction output so a failed export
 * can be retried and the list view can show details.
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),

    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    contentHash: text('content_hash').notNull(),
    /** Provider-side identity (IMAP message-id + part, Drive file id) */
    externalRef: text('external_ref'),

    status: text('status').$type<DocumentStatus>().notNull().default('processing'),
    errorMessage: text('error_message'),

    supplierName: text('supplier_name'),
    supplierIco: text('supplier_ico'),
    invoiceNumber: text('invoice_number'),
    variableSymbol: text('variable_symbol'),
    issueDate: text('issue_date'),
    dueDate: text('due_date'),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }),
    currency: text('currency'),

    /** Extraction confidence 0–100 */
    confidence: integer('confidence'),
    extracted: jsonb('extracted').$type<ExtractedInvoice>(),

    abraId: text('abra_id'),
    abraCode: text('abra_code'),
    abraUrl: text('abra_url'),

    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('documents_company_hash_uq').on(table.companyId, table.contentHash),
    index('documents_company_created_idx').on(table.companyId, table.createdAt),
    index('documents_company_status_idx').on(table.companyId, table.status),
  ]
);

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
