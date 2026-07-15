import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DocumentDetailPanel } from '~/components/documents/DocumentDetailPanel';
import { UploadDropzone } from '~/components/documents/UploadDropzone';
import { Button } from '~/components/ui/Button';
import { HelpHint } from '~/components/ui/HelpHint';
import { Card } from '~/components/ui/Card';
import { Input } from '~/components/ui/Input';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { Table, TBody, Td, Th, THead, Tr } from '~/components/ui/Table';
import { useDebouncedValue } from '~/hooks/useDebouncedValue';
import { useCompanies } from '~/hooks/useCompanies';
import { approveDocument, retryDocument, useDocuments } from '~/hooks/useDocuments';
import { useStats } from '~/hooks/useStats';
import { confidenceLevel, normalizeConfidence } from '~/lib/confidence';
import { formatCurrency, formatDate } from '~/lib/format';
import { documentStatusVariant, type BadgeVariant } from '~/lib/status';
import { cn } from '~/lib/utils';
import { useCompanyStore } from '~/stores/company';
import type { DocumentStatus } from '~/types';

const PAGE_SIZE = 20;

/** Maps a status variant to its themed colour variable (dot + accuracy bar). */
const VARIANT_COLOR: Record<BadgeVariant, string> = {
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-error)',
  info: 'var(--status-info)',
  default: 'var(--text-tertiary)',
};

const CONFIDENCE_COLOR = {
  high: 'var(--status-success)',
  medium: 'var(--status-warning)',
  low: 'var(--status-error)',
} as const;

/** Glowing status dot + localized label, matching the design. */
function StatusCell({ status }: { status: DocumentStatus }) {
  const { t } = useTranslation();
  const color = VARIANT_COLOR[documentStatusVariant(status)];
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)]">
      <span className="status-dot" style={{ color }} aria-hidden="true" />
      {t(`status.${status}`)}
    </span>
  );
}

/** Accuracy percentage + mini progress bar (or em-dash when unknown). */
function AccuracyCell({ confidence }: { confidence: number | null }) {
  if (confidence === null || confidence === undefined) {
    return <span className="text-[var(--text-tertiary)]">-</span>;
  }
  const pct = normalizeConfidence(confidence);
  const color = CONFIDENCE_COLOR[confidenceLevel(confidence)];
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="text-[13px] font-semibold text-[var(--text-primary)]">{pct} %</span>
      <span className="h-1 w-[38px] overflow-hidden rounded-full bg-[var(--surface-interactive)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
    </span>
  );
}

interface FilterTab {
  key: string;
  status: string;
  count: number;
}

export default function DocumentsPage() {
  const { t } = useTranslation();
  const companyId = useCompanyStore((s) => s.companyId);
  const { companies } = useCompanies();
  // Members add, fix and resend documents; approving a held payee and deleting
  // stay with admins — mirrors the route guards, so we don't offer a button the
  // API would answer with 403.
  const isAdmin = companies?.find((c) => c.id === companyId)?.role === 'admin';

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // Poll while the page is open so processing → exported transitions and the
  // tab counts stay live without a manual refresh.
  const LIVE_REFRESH_MS = 5000;
  const { stats, mutate: mutateStats } = useStats(companyId, LIVE_REFRESH_MS);
  const { documents, total, error, isLoading, mutate } = useDocuments(companyId, {
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    search: debouncedSearch || undefined,
    refreshInterval: LIVE_REFRESH_MS,
  });

  const refresh = () => {
    void mutate();
    void mutateStats();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const bucket = stats?.allTime;

  const tabs: FilterTab[] = [
    { key: 'documents.filter.all', status: '', count: bucket?.total ?? 0 },
    { key: 'documents.filter.exported', status: 'exported', count: bucket?.exported ?? 0 },
    { key: 'documents.filter.processing', status: 'processing', count: bucket?.processing ?? 0 },
    { key: 'documents.filter.failed', status: 'failed', count: bucket?.failed ?? 0 },
  ];

  async function handleRetry(docId: string) {
    setRetryingId(docId);
    try {
      await retryDocument(companyId as string, docId);
      refresh();
    } finally {
      setRetryingId(null);
    }
  }

  async function handleApprove(docId: string) {
    setApprovingId(docId);
    try {
      await approveDocument(companyId as string, docId);
      refresh();
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-[27px] font-bold tracking-tight text-[var(--text-primary)]">
            {t('documents.title')}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('documents.subtitle')}</p>
        </div>
        {/* Uploading is open to members too — see POST /documents/upload. */}
        {companyId && <UploadDropzone companyId={companyId} onUploaded={refresh} />}
      </header>

      {/* Toolbar: search + filter tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-placeholder)]"
            aria-hidden="true"
          />
          <Input
            className="border-transparent bg-[var(--surface-interactive)] pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('documents.searchPlaceholder')}
            aria-label={t('documents.searchPlaceholder')}
          />
        </div>
        <div
          className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label={t('documents.statusFilter')}
        >
          {tabs.map((tab) => {
            const active = status === tab.status;
            return (
              <button
                key={tab.status || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setStatus(tab.status);
                  setPage(1);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-token-md)] px-3 py-1.5 text-[13px] font-semibold',
                  'transition-colors duration-150',
                  active
                    ? 'bg-[var(--surface-interactive)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                {t(tab.key)}
                <span
                  className={cn(
                    'text-[11px] font-semibold tabular-nums',
                    active ? 'text-[var(--brand-primary)]' : 'text-[var(--text-tertiary)]'
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table card */}
      <Card className="overflow-hidden shadow-[var(--shadow-lg)]">
        <StateWrapper
          loading={isLoading && !documents}
          error={!documents ? error : undefined}
          empty={documents?.length === 0}
          emptyMessage={t('documents.noResults')}
          onRetry={() => mutate()}
        >
          {/* Mobile: card list */}
          <ul className="divide-y divide-[var(--border-subtle)] md:hidden">
            {(documents ?? []).map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => setSelectedDocId(doc.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-[var(--surface-interactive)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[var(--text-primary)]">
                      {doc.supplierName || doc.fileName}
                    </p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">
                      {doc.supplierName ? doc.fileName : doc.invoiceNumber || ''}
                    </p>
                    <div className="mt-2">
                      <StatusCell status={doc.status} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                      {formatCurrency(doc.totalAmount, doc.currency)}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)]">{formatDate(doc.createdAt)}</span>
                    <AccuracyCell confidence={doc.confidence} />
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <Table className="hidden md:table">
            <THead>
              <Tr>
                <Th className="hidden text-[11px] tracking-wide uppercase sm:table-cell">{t('documents.date')}</Th>
                <Th className="text-[11px] tracking-wide uppercase">{t('documents.fileSupplier')}</Th>
                <Th className="hidden text-[11px] tracking-wide uppercase md:table-cell">{t('documents.invoiceNumber')}</Th>
                <Th className="text-right text-[11px] tracking-wide uppercase">{t('documents.amount')}</Th>
                <Th className="hidden text-[11px] tracking-wide uppercase lg:table-cell">{t('documents.confidence')}</Th>
                <Th className="text-[11px] tracking-wide uppercase">{t('documents.status')}</Th>
                <Th className="w-12 text-right text-[11px] tracking-wide uppercase">
                  <span className="sr-only">{t('documents.actions')}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {(documents ?? []).map((doc) => (
                <Tr key={doc.id} onClick={() => setSelectedDocId(doc.id)}>
                  <Td className="hidden whitespace-nowrap text-[var(--text-secondary)] sm:table-cell">
                    {formatDate(doc.createdAt)}
                  </Td>
                  <Td className="max-w-[180px] sm:max-w-[300px]">
                    <p className="truncate font-semibold text-[var(--text-primary)]">
                      {doc.supplierName || doc.fileName}
                    </p>
                    {doc.supplierName && (
                      <p className="truncate text-xs text-[var(--text-tertiary)]">{doc.fileName}</p>
                    )}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-[var(--text-secondary)] md:table-cell">
                    {doc.invoiceNumber || '-'}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-semibold tabular-nums">
                    {formatCurrency(doc.totalAmount, doc.currency)}
                  </Td>
                  <Td className="hidden lg:table-cell">
                    <AccuracyCell confidence={doc.confidence} />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <StatusCell status={doc.status} />
                      {(doc.status === 'export_failed' || doc.status === 'extraction_failed') &&
                        doc.errorMessage && (
                          <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
                            <HelpHint label={t('documents.whyFailed')} title={t('documents.whyFailed')}>
                              <p className="text-[var(--text-secondary)]">{doc.errorMessage}</p>
                            </HelpHint>
                          </span>
                        )}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      {doc.abraUrl && (
                        <a
                          href={doc.abraUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t('documents.openInAbra')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-token-sm)] text-[var(--text-tertiary)] transition-colors duration-150 hover:bg-[var(--surface-interactive)] hover:text-[var(--brand-primary-light)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                      {doc.status === 'export_failed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={retryingId === doc.id}
                          onClick={() => handleRetry(doc.id)}
                          icon={<RefreshCw />}
                          title={t('documents.resend')}
                        >
                          {t('documents.resend')}
                        </Button>
                      )}
                      {doc.status === 'needs_review' && isAdmin && (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={approvingId === doc.id}
                          onClick={() => handleApprove(doc.id)}
                          icon={<Check />}
                          title="Schválit a založit do ABRA"
                        >
                          Schválit
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>

          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
            <p className="text-xs text-[var(--text-tertiary)]">
              {t('documents.totalCount', { count: total })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label={t('pagination.previous')}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                {t('pagination.pageOf', { page, totalPages })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label={t('pagination.next')}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </StateWrapper>
      </Card>

      {selectedDocId && companyId && (
        <DocumentDetailPanel
          companyId={companyId}
          docId={selectedDocId}
          canManage={isAdmin}
          onClose={() => setSelectedDocId(null)}
          onRetried={refresh}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}
