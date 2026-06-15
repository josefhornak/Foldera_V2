import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfidenceBadge, DocumentStatusBadge } from '~/components/ui/Badge';
import { Button } from '~/components/ui/Button';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { deleteDocument, retryDocument, useDocumentDetail } from '~/hooks/useDocuments';
import { ApiError } from '~/lib/api';
import { formatCurrency, formatDate, formatDateTime } from '~/lib/format';
import { cn } from '~/lib/utils';

interface DocumentDetailPanelProps {
  companyId: string;
  docId: string;
  onClose: () => void;
  onRetried: () => void;
  onDeleted?: () => void;
}

export function DocumentDetailPanel({ companyId, docId, onClose, onRetried, onDeleted }: DocumentDetailPanelProps) {
  const { t } = useTranslation();
  const { document: doc, error, isLoading, mutate } = useDocumentDetail(companyId, docId);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteDone, setDeleteDone] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryDocument(companyId, docId);
      await mutate();
      onRetried();
    } finally {
      setRetrying(false);
    }
  }

  async function handleDelete(fromAbra: boolean) {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteDocument(companyId, docId, fromAbra);
      onDeleted?.();
      if (fromAbra && res.abra) {
        // Keep the panel briefly to report the ABRA outcome, then close.
        setDeleteDone(
          res.abra.alreadyGone
            ? 'Smazáno z Foldery. V ABRA Flexi už doklad nebyl.'
            : 'Smazáno z Foldery i z ABRA Flexi.'
        );
        setTimeout(onClose, 1800);
      } else {
        onClose();
      }
    } catch (e) {
      setDeleting(false);
      setDeleteError(e instanceof ApiError ? e.message : 'Smazání se nezdařilo.');
    }
  }

  const extractedEntries = Object.entries(doc?.extractedFields ?? {});
  const docKind = doc?.extracted?.documentType ?? 'invoice';
  const isReceipt = docKind === 'receipt';
  // The document is in ABRA when it carries an ABRA reference (exported or matched).
  const inAbra = Boolean(doc?.abraCode || doc?.abraUrl);

  return (
    <>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-[var(--surface-overlay)] cursor-default"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('documents.detailTitle')}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col',
          'border-l border-[var(--border-default)] bg-[var(--surface-default)] shadow-[var(--shadow-lg)]'
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('documents.detailTitle')}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <StateWrapper loading={isLoading} error={error} onRetry={() => mutate()}>
            {doc && (
              <div className="space-y-6">
                <div>
                  <p className="break-all text-[13px] font-medium text-[var(--text-primary)]">
                    {doc.fileName}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <DocumentStatusBadge status={doc.status} />
                    <ConfidenceBadge confidence={doc.confidence} />
                  </div>
                </div>

                {doc.errorMessage &&
                  (() => {
                    // On a successful export the message is a non-blocking note
                    // (e.g. an unrecognized bank code was dropped) — show it as a
                    // warning, not an error. Genuine failures stay red.
                    // Full static class strings (no interpolation) so Tailwind
                    // JIT keeps both variants.
                    const isNote = doc.status === 'exported';
                    return (
                      <div
                        className={cn(
                          'rounded-[var(--radius-token-md)] border px-3 py-2',
                          isNote
                            ? 'border-[var(--status-warning)]/20 bg-[var(--status-warning-subtle)]'
                            : 'border-[var(--status-error)]/20 bg-[var(--status-error-subtle)]'
                        )}
                      >
                        <p
                          className={cn(
                            'text-xs font-medium',
                            isNote
                              ? 'text-[var(--status-warning-text)]'
                              : 'text-[var(--status-error-text)]'
                          )}
                        >
                          {t(isNote ? 'documents.warningMessage' : 'documents.errorMessage')}
                        </p>
                        <p
                          className={cn(
                            'mt-1 break-words text-xs',
                            isNote
                              ? 'text-[var(--status-warning-text)]'
                              : 'text-[var(--status-error-text)]'
                          )}
                        >
                          {doc.errorMessage}
                        </p>
                      </div>
                    );
                  })()}

                <dl className="space-y-2">
                  <DetailRow label={t('documents.docKind')} value={t(`documents.kind.${docKind}`)} />
                  <DetailRow label={t('documents.supplier')} value={doc.supplierName} />
                  <DetailRow label={t('documents.supplierIco')} value={doc.supplierIco} />
                  <DetailRow
                    label={isReceipt ? t('documents.documentNumber') : t('documents.invoiceNumber')}
                    value={doc.invoiceNumber}
                  />
                  {!isReceipt && (
                    <DetailRow label={t('documents.variableSymbol')} value={doc.variableSymbol} />
                  )}
                  <DetailRow label={t('documents.issueDate')} value={formatDate(doc.issueDate)} />
                  {!isReceipt && (
                    <DetailRow label={t('documents.dueDate')} value={formatDate(doc.dueDate)} />
                  )}
                  <DetailRow
                    label={t('documents.amount')}
                    value={formatCurrency(doc.totalAmount, doc.currency)}
                  />
                  <DetailRow
                    label={isReceipt ? t('documents.pokladnaCode') : t('documents.abraCode')}
                    value={doc.abraCode}
                  />
                  <DetailRow label={t('documents.processedAt')} value={formatDateTime(doc.processedAt)} />
                  <DetailRow label={t('documents.createdAt')} value={formatDateTime(doc.createdAt)} />
                  <DetailRow label={t('documents.rawStatus')} value={t(`status.${doc.status}`)} />
                </dl>

                {extractedEntries.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
                      {t('documents.extractedFields')}
                    </h3>
                    <dl className="space-y-2 rounded-[var(--radius-token-md)] bg-[var(--surface-sunken)] p-3">
                      {extractedEntries.map(([key, value]) => (
                        <DetailRow key={key} label={key} value={value === null ? null : String(value)} mono />
                      ))}
                    </dl>
                  </section>
                )}

                <div className="flex flex-wrap gap-2">
                  {doc.abraUrl && (
                    <a
                      href={doc.abraUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        'inline-flex h-9 items-center gap-2 rounded-[var(--radius-token-md)] px-4',
                        'bg-[var(--brand-primary)] text-[13px] font-medium text-[var(--text-inverse)]',
                        'transition-colors duration-150 hover:bg-[var(--brand-primary-hover)]'
                      )}
                    >
                      {t('documents.openInAbra')}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                  {doc.status === 'export_failed' && (
                    <Button
                      variant="secondary"
                      loading={retrying}
                      onClick={handleRetry}
                      icon={<RefreshCw />}
                    >
                      {t('documents.retry')}
                    </Button>
                  )}
                  {deleteDone ? (
                    <p className="w-full text-sm text-[var(--status-success-text)]">{deleteDone}</p>
                  ) : confirmingDelete ? (
                    inAbra ? (
                      <div className="w-full space-y-3 rounded-[var(--radius-token-md)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-3">
                        <p className="text-sm font-medium text-[var(--text-primary)]">Smazat doklad</p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          Tento doklad je založený v ABRA Flexi. Smazat ho i odtud? Pokud už v ABRA neexistuje,
                          nevadí - jen ho odstraníme z Foldery.
                        </p>
                        {deleteError && <p className="text-xs text-[var(--status-error-text)]">{deleteError}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button variant="danger" loading={deleting} onClick={() => handleDelete(true)} icon={<Trash2 />}>
                            Smazat z Foldery i ABRA
                          </Button>
                          <Button variant="secondary" loading={deleting} onClick={() => handleDelete(false)}>
                            Jen z Foldery
                          </Button>
                          <Button variant="ghost" onClick={() => { setConfirmingDelete(false); setDeleteError(null); }}>
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Button variant="danger" loading={deleting} onClick={() => handleDelete(false)} icon={<Trash2 />}>
                          {t('common.confirmDelete')}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                          {t('common.cancel')}
                        </Button>
                        {deleteError && <p className="w-full text-xs text-[var(--status-error-text)]">{deleteError}</p>}
                      </>
                    )
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmingDelete(true)} icon={<Trash2 />}>
                      {t('documents.delete')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </StateWrapper>
        </div>
      </aside>
    </>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs text-[var(--text-tertiary)]">{label}</dt>
      <dd
        className={cn(
          'min-w-0 break-words text-right text-xs text-[var(--text-primary)]',
          mono && 'font-mono'
        )}
      >
        {value || '-'}
      </dd>
    </div>
  );
}
