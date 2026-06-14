import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Outlet } from 'react-router';
import { AlertTriangle, Building2, Check, ChevronsUpDown, Clock, FileText, LayoutDashboard, Plus, Receipt, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Field, Input } from '~/components/ui/Input';
import { LogoMark } from '~/components/ui/Logo';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { useMe } from '~/hooks/useAdmin';
import { useBilling } from '~/hooks/useBilling';
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
    <div className="flex min-h-screen overflow-x-hidden bg-[var(--surface-ground)]">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-5 md:px-10 md:py-9 md:pb-9">
        <div className="mx-auto mb-5 flex max-w-[1280px] items-center justify-between gap-3">
          <CompanySwitcher />
        </div>
        <BillingBanner />
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}

interface NavItem {
  to: string;
  end: boolean;
  icon: ComponentType<{ className?: string }>;
  key: string;
  label?: string;
}

const BASE_NAV: NavItem[] = [
  { to: '/dashboard', end: true, icon: LayoutDashboard, key: 'nav.dashboard' },
  { to: '/documents', end: false, icon: FileText, key: 'nav.documents' },
  { to: '/settings', end: false, icon: Settings, key: 'nav.settings' },
];

const ADMIN_NAV: NavItem = { to: '/faktury', end: false, icon: Receipt, key: 'nav.invoices', label: 'Fakturace' };

function useNavItems(): NavItem[] {
  const { isAdmin } = useMe();
  return isAdmin ? [...BASE_NAV, ADMIN_NAV] : BASE_NAV;
}

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
  const navItems = useNavItems();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-center gap-1 py-5 md:flex',
        'border-r border-[var(--sidebar-border)] text-[var(--sidebar-text)]',
        '[background:var(--sidebar-bg-gradient)]'
      )}
    >
      {/* Brand mark */}
      <LogoMark className="h-[38px] w-[38px]" />

      <nav className="mt-4 flex flex-1 flex-col items-center gap-1.5" aria-label={t('nav.main')}>
        {navItems.map(({ to, end, icon: Icon, key, label }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={t(key, label ?? '')}
            aria-label={t(key, label ?? '')}
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

/** Bottom navigation bar shown on phones (the side rail is hidden below md). */
function MobileNav() {
  const { t } = useTranslation();
  const navItems = useNavItems();
  return (
    <nav
      aria-label={t('nav.main')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around md:hidden',
        'border-t border-[var(--sidebar-border)] bg-[var(--surface-raised)]/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]'
      )}
    >
      {navItems.map(({ to, end, icon: Icon, key, label }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={t(key, label ?? '')}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium',
              'transition-colors duration-150',
              isActive
                ? 'text-[var(--brand-primary-light)]'
                : 'text-[var(--sidebar-text-muted)]'
            )
          }
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          {t(key, label ?? '')}
        </NavLink>
      ))}
    </nav>
  );
}

/** Shows the active company and lets the user switch / add another. Visible on
 *  mobile too (the side rail is icon-only) — fixes "which company am I in?". */
function CompanySwitcher() {
  const { companies, mutate } = useCompanies();
  const companyId = useCompanyStore((s) => s.companyId);
  const setCompanyId = useCompanyStore((s) => s.setCompanyId);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  if (!companies || companies.length === 0) return null;
  const current = companies.find((c) => c.id === companyId) ?? companies[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-[var(--radius-token-md)] border border-[var(--border-default)] bg-[var(--surface-default)] px-3 py-2 text-left transition-colors hover:border-[var(--border-strong)]"
      >
        <Building2 className="h-4 w-4 shrink-0 text-[var(--brand-primary-light)]" />
        <span className="max-w-[42vw] truncate text-sm font-semibold sm:max-w-[220px]">{current?.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-2 w-[280px] max-w-[88vw] rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-1.5 shadow-[var(--shadow-lg)]">
            <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Vaše firmy</p>
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCompanyId(c.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-token-md)] px-2.5 py-2 text-sm transition-colors hover:bg-[var(--surface-interactive)]"
              >
                <span className="truncate">{c.name}</span>
                {c.id === current?.id && <Check className="h-4 w-4 shrink-0 text-[var(--brand-primary-light)]" />}
              </button>
            ))}
            <div className="my-1 border-t border-[var(--border-subtle)]" />
            <button
              onClick={() => {
                setOpen(false);
                setAdding(true);
              }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-token-md)] px-2.5 py-2 text-sm font-medium text-[var(--brand-primary-light)] transition-colors hover:bg-[var(--surface-interactive)]"
            >
              <Plus className="h-4 w-4" /> Přidat firmu
            </button>
          </div>
        </>
      )}

      {adding && (
        <AddCompanyModal
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            void mutate();
            setCompanyId(id);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [ico, setIco] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { company } = await createCompany({ name, ico: ico || undefined, billingEmail: billingEmail || undefined });
      onCreated(company.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
        <Card className="p-6">
          <h2 className="text-base font-semibold">Přidat firmu</h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Každá firma má vlastní předplatné i fakturaci.</p>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Název firmy" htmlFor="ac-name">
              <Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </Field>
            <Field label="IČO (nepovinné)" htmlFor="ac-ico">
              <Input id="ac-ico" value={ico} onChange={(e) => setIco(e.target.value)} />
            </Field>
            <Field label="E-mail pro fakturaci" htmlFor="ac-billing">
              <Input
                id="ac-billing"
                type="email"
                placeholder="kam posílat faktury za Folderu"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="text-xs text-[var(--status-error-text)]">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" loading={submitting} className="flex-1">
                Vytvořit
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Zrušit
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

const BLOCK_MESSAGES: Record<string, string> = {
  trial_expired: 'Zkušební období skončilo. Aktivujte předplatné, aby se doklady zase zpracovávaly.',
  trial_docs: 'Vyčerpali jste 10 dokladů zdarma ze zkušebního období. Aktivujte předplatné.',
  cancelled: 'Předplatné je zrušené. Obnovte ho, aby se doklady zase zpracovávaly.',
};

function pluralDays(n: number): string {
  if (n === 1) return 'den';
  if (n >= 2 && n <= 4) return 'dny';
  return 'dní';
}

/**
 * Top banner. While processing is paused (trial/plan limit) it warns in amber;
 * during a running trial it shows a calm countdown to when the trial ends so
 * the user always sees it coming. Hidden for healthy active subscriptions.
 */
function BillingBanner() {
  const companyId = useCompanyStore((s) => s.companyId);
  const { billing } = useBilling(companyId);
  if (!billing) return null;

  // Paused — processing stopped. Amber, urgent.
  if (billing.blocked) {
    const msg = (billing.blockReason && BLOCK_MESSAGES[billing.blockReason]) ?? 'Zpracování dokladů je pozastaveno.';
    return (
      <div className="mx-auto mb-5 flex max-w-[1280px] flex-col items-start gap-3 rounded-[var(--radius-token-lg)] border border-[var(--status-warning)]/30 bg-[var(--status-warning-subtle)] px-4 py-3 sm:flex-row sm:items-center">
        <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--status-warning-text)]" aria-hidden="true" />
        <p className="flex-1 text-sm text-[var(--status-warning-text)]">{msg}</p>
        <Link to="/settings/company" className="shrink-0">
          <Button size="sm">Aktivovat předplatné</Button>
        </Link>
      </div>
    );
  }

  // Running trial — show a countdown to the end date. Turns amber in the last 3 days.
  if (billing.status === 'trial' && billing.trialEndsAt) {
    const end = new Date(billing.trialEndsAt);
    const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
    const endLabel = end.toLocaleDateString('cs-CZ');
    const when = days === 0 ? 'dnes' : days === 1 ? 'zítra' : `za ${days} ${pluralDays(days)}`;
    const docsLeft = Math.max(0, billing.trialDocLimit - billing.trialDocsUsed);
    const urgent = days <= 3;
    const tone = urgent
      ? { border: 'border-[var(--status-warning)]/30', bg: 'bg-[var(--status-warning-subtle)]', text: 'text-[var(--status-warning-text)]' }
      : { border: 'border-[var(--status-info)]/30', bg: 'bg-[var(--status-info-subtle)]', text: 'text-[var(--status-info-text)]' };
    return (
      <div className={`mx-auto mb-5 flex max-w-[1280px] flex-col items-start gap-3 rounded-[var(--radius-token-lg)] border ${tone.border} ${tone.bg} px-4 py-3 sm:flex-row sm:items-center`}>
        <Clock className={`h-5 w-5 shrink-0 ${tone.text}`} aria-hidden="true" />
        <p className={`flex-1 text-sm ${tone.text}`}>
          Zkušební období končí <strong>{when}</strong> ({endLabel}) · zbývá {docsLeft} z {billing.trialDocLimit} dokladů.
          Pak je potřeba aktivovat předplatné.
        </p>
        <Link to="/settings/company" className="shrink-0">
          <Button size="sm" variant={urgent ? 'primary' : 'secondary'}>Přejít na ostrý provoz</Button>
        </Link>
      </div>
    );
  }

  return null;
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
