import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fetchDocumentFileUrl, useDocumentText } from '~/hooks/useDocuments';
import { cn } from '~/lib/utils';

interface DocumentPreviewProps {
  companyId: string;
  docId: string;
  fileName: string;
  mimeType?: string;
  hasFile: boolean;
  hasText: boolean;
  className?: string;
}

/**
 * Shows the document being corrected. Prefers the original file; falls back to
 * the OCR transcript once retention has swept the file, so there is always
 * something to check the extracted fields against.
 *
 * The file is fetched as a blob rather than pointed at with an <iframe src>:
 * auth rides in a header, so the browser cannot load the URL by itself.
 */
export function DocumentPreview({
  companyId,
  docId,
  fileName,
  mimeType,
  hasFile,
  hasText,
  className,
}: DocumentPreviewProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState(false);
  const [loading, setLoading] = useState(hasFile);
  // Only pay for the transcript when it is what we'll actually show.
  const showText = !hasFile || fileError;
  const { text, isLoading: textLoading } = useDocumentText(companyId, docId, showText && hasText);

  useEffect(() => {
    if (!hasFile) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    setLoading(true);
    fetchDocumentFileUrl(companyId, docId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFileError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [companyId, docId, hasFile]);

  const frame = cn(
    'flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[var(--radius-token-md)]',
    'border border-[var(--border-subtle)] bg-[var(--surface-sunken)]',
    className
  );

  if (loading || (showText && hasText && textLoading)) {
    return (
      <div className={cn(frame, 'items-center justify-center')}>
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" aria-hidden="true" />
      </div>
    );
  }

  if (url && !fileError) {
    const isImage = mimeType?.startsWith('image/');
    return (
      <div className={frame}>
        {isImage ? (
          <div className="flex-1 overflow-auto p-2">
            <img src={url} alt={fileName} className="mx-auto max-w-full" />
          </div>
        ) : (
          <iframe src={url} title={fileName} className="h-full w-full flex-1 border-0 bg-white" />
        )}
      </div>
    );
  }

  if (showText && text) {
    return (
      <div className={frame}>
        <p className="border-b border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
          {t('documents.preview.textOnly')}
        </p>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
          {text}
        </pre>
      </div>
    );
  }

  return (
    <div className={cn(frame, 'items-center justify-center gap-2 px-6 text-center')}>
      <FileText className="h-6 w-6 text-[var(--text-tertiary)]" aria-hidden="true" />
      <p className="text-xs text-[var(--text-tertiary)]">{t('documents.preview.unavailable')}</p>
    </div>
  );
}
