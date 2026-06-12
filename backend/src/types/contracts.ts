/**
 * Shared contracts between the pipeline and its modules:
 * - extraction (services/extraction) — Mistral OCR + ISDOC
 * - abraflexi (services/abraflexi) — ABRA Flexi REST client
 * - sources (services/sources) — IMAP / OneDrive / Google Drive pollers
 *
 * These interfaces are the single source of truth. Modules implement them;
 * the pipeline (queue/pipeline.ts) consumes them.
 */

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface ExtractedLineItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
  vatRate: number | null;
}

export interface VatBucket {
  /** VAT rate in percent, e.g. 21 */
  rate: number;
  base: number;
  vat: number;
}

export interface ExtractedInvoice {
  /** Document classification — only purchase invoices are exported */
  isInvoice: boolean;
  documentType: 'invoice' | 'receipt' | 'credit_note' | 'other';

  supplierName: string | null;
  supplierIco: string | null;
  supplierDic: string | null;
  supplierAddress: string | null;

  invoiceNumber: string | null;
  variableSymbol: string | null;
  constantSymbol: string | null;
  specificSymbol: string | null;
  orderNumber: string | null;

  /** ISO dates (YYYY-MM-DD) */
  issueDate: string | null;
  taxDate: string | null;
  dueDate: string | null;

  totalAmount: number | null;
  totalWithoutVat: number | null;
  currency: string | null;
  vatBreakdown: VatBucket[];
  /** True when the document is reverse-charge (přenesená daňová povinnost) */
  reverseCharge: boolean;

  bankAccount: string | null;
  bankCode: string | null;
  iban: string | null;
  swift: string | null;
  paymentMethod: string | null;

  lineItems: ExtractedLineItem[];
  /** Free-text note / description of the supply */
  description: string | null;

  /** Full OCR text (markdown) — not persisted to DB list endpoints */
  rawText: string | null;
}

export interface ExtractionResult {
  success: boolean;
  /** Which path produced the fields */
  source: 'isdoc' | 'ocr' | 'ocr+isdoc' | 'none';
  fields: ExtractedInvoice | null;
  /** 0–100 */
  confidence: number;
  error?: string;
}

export interface ExtractionInput {
  filePath: string;
  mimeType: string;
  fileName: string;
}

/** Implemented by services/extraction/index.ts */
export type ExtractInvoiceFn = (input: ExtractionInput) => Promise<ExtractionResult>;

// ---------------------------------------------------------------------------
// ABRA Flexi
// ---------------------------------------------------------------------------

export interface AbraFlexiConfig {
  /** Full base URL including company, e.g. https://demo.flexibee.eu/c/demo */
  apiUrl: string;
  apiUser: string;
  apiPassword: string;
  /** Foldera company id — used for logging / circuit breaker scoping */
  companyId: string;
}

export interface AbraConnectionTestResult {
  ok: boolean;
  companyName?: string;
  error?: string;
}

export interface AbraSupplierMatch {
  /** adresar `kod` */
  code: string;
  name: string;
  ico: string | null;
}

/**
 * Defaults harvested from the supplier's previous purchase invoices in ABRA
 * Flexi ("koukání na předchozí doklady") — applied to the new document.
 */
export interface AbraSupplierDefaults {
  /** typ dokladu (typ-faktury-prijate kod) */
  documentType: string | null;
  /** predpis-zauctovani kod */
  predpisZauctovani: string | null;
  /** cleneni-dph kod (řádek DPH) */
  cleneniDph: string | null;
  /** cleneni-kontrolni-hlaseni kod (řádek kontrolního hlášení) */
  cleneniKonVykDph: string | null;
  /** stredisko kod */
  stredisko: string | null;
  /** forma-uhrady kod */
  formaUhrady: string | null;
}

export interface AbraExportResult {
  /** Internal ABRA Flexi id */
  id: string;
  /** Document code, e.g. FAP-2026/0123 */
  code: string;
  /** Deep link into the ABRA Flexi web UI for this document */
  webUrl: string;
  /** True when the supplier was auto-created in adresar during export */
  supplierCreated: boolean;
}

export interface AbraDuplicateQuery {
  supplierIco: string | null;
  variableSymbol: string | null;
  invoiceNumber: string | null;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

import type { Source, SourceCursor } from '../db/schema/sources.schema.js';

/** A new file discovered in a source, downloaded to a temp path */
export interface IncomingFile {
  /** Stable provider-side identity for dedup (msg-id+part / drive file id) */
  externalRef: string;
  fileName: string;
  mimeType: string;
  /** Temp file on local disk — the pipeline deletes it when done */
  filePath: string;
  receivedAt: Date;
}

export interface PollResult {
  files: IncomingFile[];
  /** Updated cursor to persist on the source row */
  cursor: SourceCursor;
}

/** Implemented per provider in services/sources/ */
export type PollSourceFn = (source: Source, tmpDir: string) => Promise<PollResult>;
