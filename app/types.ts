/** Shared API types for Foldera V2. */

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type AccountingFillMode = 'history' | 'ai';

export interface Company {
  id: string;
  name: string;
  ico: string | null;
  /** Where this company's Foldera invoices are sent (defaults to account e-mail). */
  billingEmail: string | null;
  abraApiUrl: string | null;
  abraApiUser: string | null;
  abraConfigured: boolean;
  accountingFillMode: AccountingFillMode;
  /** Attach the original e-mail (.eml) to the ABRA document for e-mail sources. */
  attachOriginalEmail: boolean;
  /** 'detail' = keep every line item, 'summary' = collapse per VAT rate. */
  lineItemMode: 'detail' | 'summary';
  trialEndsAt: string | null;
  createdAt: string;
  /** The signed-in user's role in this company: 'admin' = správce, 'member' = jen nahlíží. */
  role: 'admin' | 'member';
}

export const DOCUMENT_STATUSES = [
  'processing',
  'exported',
  'export_failed',
  'extraction_failed',
  'skipped_duplicate',
  'skipped_not_invoice',
  'skipped_limit',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface DocumentRow {
  id: string;
  fileName: string;
  status: DocumentStatus;
  errorMessage: string | null;
  supplierName: string | null;
  supplierIco: string | null;
  invoiceNumber: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  currency: string | null;
  confidence: number | null;
  abraCode: string | null;
  abraUrl: string | null;
  processedAt: string | null;
  createdAt: string;
}

export type DocumentKind = 'invoice' | 'receipt' | 'credit_note' | 'other';

/** Detail endpoint additionally returns the full extracted object. */
export interface DocumentDetail extends DocumentRow {
  extractedFields?: Record<string, string | number | null> | null;
  extracted?: ({ documentType?: DocumentKind } & Record<string, unknown>) | null;
}

export interface DocumentsResponse {
  documents: DocumentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatsBucket {
  total: number;
  exported: number;
  failed: number;
  skipped: number;
  processing: number;
  avgConfidence: number;
  successRate: number;
}

export interface StatsResponse {
  allTime: StatsBucket;
  last30Days: StatsBucket;
}

export interface Billing {
  status: 'trial' | 'active' | 'cancelled';
  trialEndsAt: string | null;
  trialDocsUsed: number;
  trialDocLimit: number;
  blocked: boolean;
  blockReason: string | null;
  period: string;
  used: number;
  included: number;
  overage: number;
  overageCostCzk: number;
  estimatedTotalCzk: number;
  planPriceCzk: number;
  nextInvoiceDate: string | null;
}

export type SourceStatus = 'ok' | 'error' | 'pending_auth';

export interface ImapDetail {
  host: string;
  port: number;
  user: string;
  folder?: string | null;
}

export interface DriveDetail {
  accountEmail?: string | null;
  folderPath?: string | null;
}

export interface CollectionEmailDetail {
  address: string;
}

interface SourceBase {
  id: string;
  name: string;
  enabled: boolean;
  status: SourceStatus;
  lastError: string | null;
  lastSyncAt: string | null;
}

export type Source = SourceBase &
  (
    | { type: 'collection_email'; detail: CollectionEmailDetail }
    | { type: 'imap'; detail: ImapDetail }
    | { type: 'onedrive' | 'google_drive'; detail: DriveDetail }
  );

export interface SourceCapabilities {
  /** Whether app-provisioned collection mailboxes are available in this env */
  collectionEmail: boolean;
}

export interface SourcesResponse {
  sources: Source[];
  capabilities: SourceCapabilities;
}

export interface Folder {
  id: string;
  name: string;
}
