import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, NavLink, Outlet } from 'react-router';
import { FileText, LayoutDashboard, LogOut, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CompanySwitcher } from '~/components/layout/CompanySwitcher';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Field, Input } from '~/components/ui/Input';
import { Logo } from '~/components/ui/Logo';
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
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
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

function Sidebar() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen w-16 shrink-0 flex-col md:w-60',
        'border-r border-[var(--sidebar-border)] text-[var(--sidebar-text)]',
        '[background:var(--sidebar-bg-gradient)]'
      )}
    >
      <div className="flex items-center justify-center px-3 py-5 md:justify-start md:px-4">
        <Logo tone="dark" markOnly className="md:hidden" />
        <Logo tone="dark" className="hidden md:inline-flex" />
      </div>

      <div className="hidden px-3 pb-4 md:block">
        <CompanySwitcher />
      </div>

      <nav className="flex-1 space-y-1 px-2 md:px-3" aria-label={t('nav.main')}>
        {NAV_ITEMS.map(({ to, end, icon: Icon, key }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative flex items-center gap-3 rounded-[var(--radius-token-md)] px-3 py-2 text-[13px] font-medium',
                'transition-colors duration-150',
                isActive
                  ? 'bg-[var(--sidebar-active)] text-white'
                  : 'text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-white'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--sidebar-indicator)] shadow-[0_0_8px_rgba(var(--brand-secondary-rgb),0.5)]"
                  />
                )}
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">{t(key)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--sidebar-border)] p-3">
        <div className="hidden px-1 pb-2 md:block">
          <p className="truncate text-xs font-medium text-white">{user?.name}</p>
          <p className="truncate text-xs text-[var(--sidebar-text-muted)]">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className={cn(
            'flex w-full items-center gap-3 rounded-[var(--radius-token-md)] px-3 py-2',
            'text-[13px] font-medium text-[var(--sidebar-text-muted)]',
            'transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-white'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden md:inline">{t('nav.logout')}</span>
        </button>
      </div>
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
