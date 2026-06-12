import { useRef, useState, type DragEvent } from 'react';
import { CheckCircle2, CopyX, FileWarning, Loader2, UploadCloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!uploading && e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={t('documents.upload.dropHint')}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-token-lg)]',
          'border-2 border-dashed px-4 py-6 text-center transition-colors duration-150',
          dragging
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-subtle)]'
            : 'border-[var(--border-default)] bg-[var(--surface-default)] hover:border-[var(--brand-primary)]',
          uploading && 'pointer-events-none opacity-70'
        )}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-primary)]" aria-hidden="true" />
        ) : (
          <UploadCloud className="h-6 w-6 text-[var(--brand-primary)]" aria-hidden="true" />
        )}
        <p className="text-[13px] font-medium text-[var(--text-primary)]">
          {uploading ? t('documents.upload.uploading') : t('documents.upload.dropHint')}
        </p>
        <p className="text-xs text-[var(--text-tertiary)]">{t('documents.upload.formats')}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--status-error-text)]">
          {error}
        </p>
      )}

      {results && (
        <ul className="mt-2 space-y-1" aria-label={t('documents.upload.resultsTitle')}>
          {results.map((r, i) => (
            <li
              key={`${r.fileName}-${i}`}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
            >
              {r.status === 'queued' && (
                <CheckCircle2
                  className="h-3.5 w-3.5 shrink-0 text-[var(--status-success-text)]"
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
              <span className="shrink-0 text-[var(--text-tertiary)]">
                — {t(`documents.upload.${r.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
