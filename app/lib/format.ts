import { formatDistanceToNow } from 'date-fns';
import { cs, enUS } from 'date-fns/locale';
import i18n from '~/i18n';
import { normalizeConfidence } from '~/lib/confidence';

const NUMBER_LOCALE = 'cs-CZ';

export function formatCurrency(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined) return '-';
  try {
    return new Intl.NumberFormat(NUMBER_LOCALE, {
      style: 'currency',
      currency: currency || 'CZK',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to plain number + raw code
    return `${new Intl.NumberFormat(NUMBER_LOCALE).format(amount)} ${currency ?? ''}`.trim();
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat(NUMBER_LOCALE).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${normalizeConfidence(value)} %`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(NUMBER_LOCALE, { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(NUMBER_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: i18n.language?.startsWith('cs') ? cs : enUS,
  });
}
