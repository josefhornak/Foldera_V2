import type { DocumentStatus, SourceStatus } from '~/types';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

const DOCUMENT_STATUS_VARIANT: Record<DocumentStatus, BadgeVariant> = {
  processing: 'info',
  exported: 'success',
  export_failed: 'error',
  extraction_failed: 'error',
  needs_review: 'warning',
  skipped_duplicate: 'default',
  skipped_not_invoice: 'default',
  skipped_limit: 'warning',
};

export function documentStatusVariant(status: DocumentStatus): BadgeVariant {
  return DOCUMENT_STATUS_VARIANT[status] ?? 'default';
}

const SOURCE_STATUS_VARIANT: Record<SourceStatus, BadgeVariant> = {
  ok: 'success',
  error: 'error',
  pending_auth: 'warning',
};

export function sourceStatusVariant(status: SourceStatus): BadgeVariant {
  return SOURCE_STATUS_VARIANT[status] ?? 'default';
}
