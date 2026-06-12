import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { confidenceLevel, normalizeConfidence } from '~/lib/confidence';
import { documentStatusVariant, sourceStatusVariant, type BadgeVariant } from '~/lib/status';
import { cn } from '~/lib/utils';
import type { DocumentStatus, SourceStatus } from '~/types';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
  pulse?: boolean;
}

export function Badge({ className, variant = 'default', dot = false, pulse = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium',
        'rounded-[var(--radius-token-full)] whitespace-nowrap',
        variant === 'default' && 'bg-[var(--surface-sunken)] text-[var(--text-secondary)]',
        variant === 'success' && 'bg-[var(--status-success-subtle)] text-[var(--status-success-text)]',
        variant === 'warning' && 'bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)]',
        variant === 'error' && 'bg-[var(--status-error-subtle)] text-[var(--status-error-text)]',
        variant === 'info' && 'bg-[var(--status-info-subtle)] text-[var(--status-info-text)]',
        className
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            pulse && 'animate-pulse',
            variant === 'default' && 'bg-[var(--text-tertiary)]',
            variant === 'success' && 'bg-[var(--status-success)]',
            variant === 'warning' && 'bg-[var(--status-warning)]',
            variant === 'error' && 'bg-[var(--status-error)]',
            variant === 'info' && 'bg-[var(--status-info)]'
          )}
        />
      )}
      {children}
    </span>
  );
}

/** Document status badge with Czech-first localized label. */
export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant={documentStatusVariant(status)} dot pulse={status === 'processing'}>
      {t(`status.${status}`)}
    </Badge>
  );
}

/** Source status badge (ok / error / pending_auth). */
export function SourceStatusBadge({ status }: { status: SourceStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant={sourceStatusVariant(status)} dot>
      {t(`sourceStatus.${status}`)}
    </Badge>
  );
}

const CONFIDENCE_VARIANT = {
  high: 'success',
  medium: 'warning',
  low: 'error',
} as const satisfies Record<string, BadgeVariant>;

/** Extraction accuracy badge: ≥90 green, 70–89 amber, <70 red. */
export function ConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  if (confidence === null || confidence === undefined) {
    return <span className="text-[var(--text-tertiary)]">—</span>;
  }
  return (
    <Badge variant={CONFIDENCE_VARIANT[confidenceLevel(confidence)]} className="tabular-nums">
      {normalizeConfidence(confidence)} %
    </Badge>
  );
}
