import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, NavLink, Outlet } from 'react-router';
import { FileText, LayoutDashboard, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Field, Input } from '~/components/ui/Input';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { createCompany, useCompanies } from '~/hooks/useCompanies';
import { ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useAuthStore } from '~/stores/auth';
import { useCompanyStore } from '~/stores/company';

export default function AppLayout() {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <AuthedShell />;
}

function AuthedShell() {
  const { companies, error, isLoading, mutate } = useCompanies();
  const companyId = useCompanyStore((s) => s.companyId);
  const setCompanyId = useCompanyStore((s) => s.setCompanyId);

  // Keep selection valid: pick the first company when none / a stale one is selected.
  useEffect(() => {
    if (!companies || companies.length === 0) return;
    if (!companyId || !companies.some((c) => c.id === companyId)) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId, setCompanyId]);

  if (isLoading || error) {
    return (
      <div className="min-h-screen bg-[var(--surface-ground)]">
        <StateWrapper loading={isLoading} error={error} onRetry={() => mutate()}>
          {null}
        </StateWrapper>
      </div>
    );
  }

  if (companies && companies.length === 0) {
    return <Onboarding onCreated={(id) => setCompanyId(id)} />;
  }

  return (
    <div className="flex min-h-screen bg-[var(--surface-ground)]">
      <Sidebar />
      <main className="min-w-0 flex-1 px-5 py-7 md:px-10 md:py-9">
        <Outlet />
      </main>
    </div>
  );
}

const NAV_ITEMS = [
  { to: '/', end: true, icon: LayoutDashboard, key: 'nav.dashboard' },
  { to: '/documents', end: false, icon: FileText, key: 'nav.documents' },
  { to: '/settings', end: false, icon: Settings, key: 'nav.settings' },
] as const;

/** Up to two uppercase initials from a name (falls back to "?"). */
function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Sidebar() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen w-[72px] shrink-0 flex-col items-center gap-1 py-5',
        'border-r border-[var(--sidebar-border)] text-[var(--sidebar-text)]',
        '[background:var(--sidebar-bg-gradient)]'
      )}
    >
      {/* Brand mark */}
      <div
        className="flex h-[38px] w-[38px] items-center justify-center rounded-[12px] text-[19px] font-bold text-white [background:var(--accent-gradient)]"
        style={{ boxShadow: 'var(--accent-glow)' }}
        aria-label="Foldera"
      >
        F
      </div>

      <nav className="mt-4 flex flex-1 flex-col items-center gap-1.5" aria-label={t('nav.main')}>
        {NAV_ITEMS.map(({ to, end, icon: Icon, key }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={t(key)}
            aria-label={t(key)}
            className={({ isActive }) =>
              cn(
                'flex h-10 w-10 items-center justify-center rounded-[var(--radius-token-md)]',
                'transition-colors duration-150',
                isActive
                  ? 'bg-[var(--sidebar-active)] text-[var(--brand-primary-light)] shadow-[0_0_18px_rgba(var(--brand-primary-rgb),0.18)]'
                  : 'text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]'
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </NavLink>
        ))}
      </nav>

      {/* User avatar → settings */}
      <NavLink
        to="/settings"
        title={user?.name ?? t('nav.settings')}
        aria-label={user?.name ?? t('nav.settings')}
        className={cn(
          'flex h-[34px] w-[34px] items-center justify-center rounded-[10px]',
          'bg-[var(--surface-interactive)] text-[12px] font-bold text-[var(--text-primary)]',
          'ring-1 ring-[var(--border-default)] transition-colors duration-150 hover:ring-[var(--border-brand)]'
        )}
      >
        {initials(user?.name)}
      </NavLink>
    </aside>
  );
}

function Onboarding({ onCreated }: { onCreated: (companyId: string) => void }) {
  const { t } = useTranslation();
  const { mutate } = useCompanies();
  const [name, setName] = useState('');
  const [ico, setIco] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { company } = await createCompany({ name, ico: ico || undefined });
      await mutate();
      onCreated(company.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-ground)] px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="text-base font-semibold text-[var(--text-primary)]">
          {t('company.onboardingTitle')}
        </h1>
        <p className="mt-1 mb-6 text-xs text-[var(--text-secondary)]">
          {t('company.onboardingHint')}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label={t('company.name')} htmlFor="onb-name">
            <Input id="onb-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label={t('company.ico')} htmlFor="onb-ico">
            <Input id="onb-ico" value={ico} onChange={(e) => setIco(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-xs text-[var(--status-error-text)]">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} className="w-full">
            {t('company.createNew')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
