import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CopyX, FileWarning, UploadCloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { apiUpload, ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.isdoc,.xml';

interface UploadResult {
  fileName: string;
  status: 'queued' | 'duplicate' | 'unsupported';
  documentId?: string;
}

interface UploadDropzoneProps {
  companyId: string;
  /** Called after a successful upload so the documents list can refresh */
  onUploaded: () => void;
}

/**
 * Header upload control: a primary "Nahrát doklady" button plus a page-wide
 * drag-and-drop target. Dragging files anywhere over the window reveals a
 * full-screen drop overlay; results show as a dismissable toast.
 */
export function UploadDropzone({ companyId, onUploaded }: UploadDropzoneProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    setError(null);
    setResults(null);
    try {
      const formData = new FormData();
      for (const file of list) formData.append('files', file);
      const response = await apiUpload<{ results: UploadResult[] }>(
        `/api/companies/${companyId}/documents/upload`,
        formData
      );
      setResults(response.results);
      if (response.results.some((r) => r.status === 'queued')) {
        onUploaded();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  // Page-wide drag-and-drop. A depth counter avoids flicker from child enter/leave.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    function onEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    }
    function onOver(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault();
    }
    function onLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function onDrop(e: DragEvent) {
      depth = 0;
      setDragging(false);
      if (!e.dataTransfer || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      if (!uploading) void uploadFiles(e.dataTransfer.files);
    }

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading, companyId]);

  return (
    <div className="flex items-center gap-4">
      <span className="hidden text-[13px] text-[var(--text-tertiary)] sm:inline">
        {t('documents.upload.dragHint')}
      </span>
      <Button
        type="button"
        loading={uploading}
        onClick={() => !uploading && inputRef.current?.click()}
        icon={<UploadCloud />}
      >
        {uploading ? t('documents.upload.uploading') : t('documents.upload.button')}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
      />

      {/* Full-window drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface-overlay)] backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-token-xl)] border-2 border-dashed border-[var(--brand-primary)] bg-[var(--surface-default)] px-12 py-10 shadow-[var(--shadow-lg)]">
            <UploadCloud className="h-8 w-8 text-[var(--brand-primary)]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {t('documents.upload.dropHint')}
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">{t('documents.upload.formats')}</p>
          </div>
        </div>
      )}

      {/* Results / error toast */}
      {(results || error) && (
        <div className="fixed right-6 bottom-6 z-50 w-80 max-w-[calc(100vw-3rem)] rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4 shadow-[var(--shadow-lg)]">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              {t('documents.upload.resultsTitle')}
            </p>
            <button
              type="button"
              onClick={() => {
                setResults(null);
                setError(null);
              }}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              {t('common.dismiss')}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-[var(--status-error-text)]">
              {error}
            </p>
          )}
          {results && (
            <ul className="space-y-1">
              {results.map((r, i) => (
                <li
                  key={`${r.fileName}-${i}`}
                  className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
                >
                  {r.status === 'queued' && (
                    <CheckCircle2
                      className={cn('h-3.5 w-3.5 shrink-0 text-[var(--status-success-text)]')}
                      aria-hidden="true"
                    />
                  )}
                  {r.status === 'duplicate' && (
                    <CopyX className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                  )}
                  {r.status === 'unsupported' && (
                    <FileWarning
                      className="h-3.5 w-3.5 shrink-0 text-[var(--status-error-text)]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{r.fileName}</span>
                  <span className="ml-auto shrink-0 text-[var(--text-tertiary)]">
                    {t(`documents.upload.${r.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
