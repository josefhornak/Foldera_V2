/** Shared API types for Foldera V2. */

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Company {
  id: string;
  name: string;
  ico: string | null;
  abraApiUrl: string | null;
  abraApiUser: string | null;
  abraConfigured: boolean;
  createdAt: string;
}

export const DOCUMENT_STATUSES = [
  'processing',
  'exported',
  'export_failed',
  'extraction_failed',
  'skipped_duplicate',
  'skipped_not_invoice',
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

/** Detail endpoint additionally returns the extracted fields object. */
export interface DocumentDetail extends DocumentRow {
  extractedFields?: Record<string, string | number | null> | null;
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
    | { type: 'imap'; detail: ImapDetail }
    | { type: 'onedrive' | 'google_drive'; detail: DriveDetail }
  );

export interface SourcesResponse {
  sources: Source[];
}

export interface Folder {
  id: string;
  name: string;
}
