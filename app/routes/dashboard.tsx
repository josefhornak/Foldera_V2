import { Link } from 'react-router';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DocumentStatusBadge } from '~/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/Card';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { useDocuments } from '~/hooks/useDocuments';
import { useStats } from '~/hooks/useStats';
import { formatNumber, formatPercent, formatRelative } from '~/lib/format';
import { cn } from '~/lib/utils';
import { useCompanyStore } from '~/stores/company';

const POLL_INTERVAL = 15000;

export default function DashboardPage() {
  const { t } = useTranslation();
  const companyId = useCompanyStore((s) => s.companyId);
  const { stats, error, isLoading, mutate } = useStats(companyId, POLL_INTERVAL);
  const recent = useDocuments(companyId, {
    page: 1,
    pageSize: 5,
    refreshInterval: POLL_INTERVAL,
  });

  const failedCount = stats?.allTime.failed ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h1 className="font-heading text-[27px] font-bold tracking-tight text-[var(--text-primary)]">
          {t('dashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('dashboard.subtitle')}</p>
      </header>

      <StateWrapper loading={isLoading && !stats} error={!stats ? error : undefined} onRetry={() => mutate()}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard
            label={t('dashboard.totalProcessed')}
            value={formatNumber(stats?.allTime.total)}
          />
          <StatCard
            label={t('dashboard.last30Days')}
            value={formatNumber(stats?.last30Days.total)}
          />
          <StatCard
            label={t('dashboard.successRate')}
            value={formatPercent(stats?.allTime.successRate)}
          />
          <StatCard
            label={t('dashboard.avgConfidence')}
            value={formatPercent(stats?.allTime.avgConfidence)}
          />
          <StatCard
            label={t('dashboard.errorsToResolve')}
            value={formatNumber(failedCount)}
            tone={failedCount > 0 ? 'error' : 'default'}
            icon={failedCount > 0 ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : undefined}
          />
        </div>
      </StateWrapper>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t('dashboard.recentDocuments')}</CardTitle>
          <Link
            to="/documents"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-link)] hover:underline underline-offset-4"
          >
            {t('dashboard.viewAll')}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardContent>
          <StateWrapper
            loading={recent.isLoading && !recent.documents}
            error={!recent.documents ? recent.error : undefined}
            empty={recent.documents?.length === 0}
            emptyMessage={t('dashboard.noDocuments')}
            onRetry={() => recent.mutate()}
          >
            <ul className="divide-y divide-[var(--border-subtle)]">
              {(recent.documents ?? []).map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {doc.supplierName || doc.fileName}
                    </p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">
                      {doc.supplierName ? doc.fileName : doc.invoiceNumber ?? ''}
                    </p>
                  </div>
                  <DocumentStatusBadge status={doc.status} />
                  <span className="hidden whitespace-nowrap text-xs text-[var(--text-tertiary)] sm:block">
                    {formatRelative(doc.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </StateWrapper>
        </CardContent>
      </Card>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'error';
  icon?: React.ReactNode;
}

function StatCard({ label, value, tone = 'default', icon }: StatCardProps) {
  return (
    <Card className="p-4">
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p
        className={cn(
          'mt-2 flex items-center gap-1.5 text-xl font-semibold tabular-nums',
          tone === 'error' ? 'text-[var(--status-error)]' : 'text-[var(--text-primary)]'
        )}
      >
        {icon}
        {value}
      </p>
    </Card>
  );
}
