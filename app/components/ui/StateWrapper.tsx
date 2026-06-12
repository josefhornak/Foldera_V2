import type { ReactNode } from 'react';
import { Loader2, AlertCircle, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';

interface StateWrapperProps {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  className?: string;
  children: ReactNode;
}

/** Simple loading / error / empty / populated wrapper for page sections. */
export function StateWrapper({
  loading,
  error,
  empty,
  emptyMessage,
  onRetry,
  className,
  children,
}: StateWrapperProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-16', className)} role="status">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" aria-hidden="true" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }

  if (error) {
    const message = error instanceof ApiError ? error.message : t('common.error');
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
        <AlertCircle className="h-6 w-6 text-[var(--status-error)]" aria-hidden="true" />
        <p className="text-sm text-[var(--text-secondary)]">{message}</p>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
        <Inbox className="h-6 w-6 text-[var(--text-tertiary)]" aria-hidden="true" />
        <p className="text-sm text-[var(--text-secondary)]">{emptyMessage ?? t('common.empty')}</p>
      </div>
    );
  }

  return <>{children}</>;
}
