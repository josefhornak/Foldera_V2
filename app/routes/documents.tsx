import { useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DocumentDetailPanel } from '~/components/documents/DocumentDetailPanel';
import { UploadDropzone } from '~/components/documents/UploadDropzone';
import { ConfidenceBadge, DocumentStatusBadge } from '~/components/ui/Badge';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Input, Select } from '~/components/ui/Input';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { Table, TBody, Td, Th, THead, Tr } from '~/components/ui/Table';
import { useDebouncedValue } from '~/hooks/useDebouncedValue';
import { retryDocument, useDocuments } from '~/hooks/useDocuments';
import { formatCurrency, formatDate } from '~/lib/format';
import { useCompanyStore } from '~/stores/company';
import { DOCUMENT_STATUSES } from '~/types';

const PAGE_SIZE = 20;

export default function DocumentsPage() {
  const { t } = useTranslation();
  const companyId = useCompanyStore((s) => s.companyId);

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const { documents, total, error, isLoading, mutate } = useDocuments(companyId, {
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    search: debouncedSearch || undefined,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleRetry(docId: string) {
    setRetryingId(docId);
    try {
      await retryDocument(companyId as string, docId);
      await mutate();
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('documents.title')}</h1>
        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{t('documents.subtitle')}</p>
      </header>

      {companyId && <UploadDropzone companyId={companyId} onUploaded={() => mutate()} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-placeholder)]"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('documents.searchPlaceholder')}
            aria-label={t('documents.searchPlaceholder')}
          />
        </div>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label={t('documents.statusFilter')}
        >
          <option value="">{t('documents.allStatuses')}</option>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <StateWrapper
          loading={isLoading && !documents}
          error={!documents ? error : undefined}
          empty={documents?.length === 0}
          emptyMessage={t('documents.noResults')}
          onRetry={() => mutate()}
        >
          <Table>
            <THead>
              <Tr>
                <Th>{t('documents.date')}</Th>
                <Th>{t('documents.fileSupplier')}</Th>
                <Th>{t('documents.invoiceNumber')}</Th>
                <Th className="text-right">{t('documents.amount')}</Th>
                <Th>{t('documents.confidence')}</Th>
                <Th>{t('documents.status')}</Th>
                <Th className="text-right">{t('documents.actions')}</Th>
              </Tr>
            </THead>
            <TBody>
              {(documents ?? []).map((doc) => (
                <Tr key={doc.id} onClick={() => setSelectedDocId(doc.id)}>
                  <Td className="whitespace-nowrap text-[var(--text-secondary)]">
                    {formatDate(doc.createdAt)}
                  </Td>
                  <Td className="max-w-[260px]">
                    <p className="truncate font-medium">{doc.supplierName || doc.fileName}</p>
                    {doc.supplierName && (
                      <p className="truncate text-xs text-[var(--text-tertiary)]">{doc.fileName}</p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{doc.invoiceNumber || '—'}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {formatCurrency(doc.totalAmount, doc.currency)}
                  </Td>
                  <Td>
                    <ConfidenceBadge confidence={doc.confidence} />
                  </Td>
                  <Td>
                    <DocumentStatusBadge status={doc.status} />
                  </Td>
                  <Td
                    className="whitespace-nowrap text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center gap-1">
                      {doc.abraUrl && (
                        <a
                          href={doc.abraUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t('documents.openInAbra')}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-token-sm)] px-2 py-1 text-xs font-medium text-[var(--text-link)] transition-colors duration-150 hover:bg-[var(--brand-primary-subtle)]"
                        >
                          {t('documents.openInAbraShort')}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                      {doc.status === 'export_failed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={retryingId === doc.id}
                          onClick={() => handleRetry(doc.id)}
                          icon={<RefreshCw />}
                          title={t('documents.retry')}
                        >
                          {t('documents.retry')}
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
          onClose={() => setSelectedDocId(null)}
          onRetried={() => mutate()}
        />
      )}
    </div>
  );
}
