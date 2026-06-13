import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AbraSection } from '~/components/settings/AbraSection';
import { SourcesSection } from '~/components/settings/SourcesSection';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/Card';
import { Field, Input, Select } from '~/components/ui/Input';
import { LogOut } from 'lucide-react';
import { useBilling, subscribeCompany, cancelSubscription } from '~/hooks/useBilling';
import { deleteCompany, updateCompany, useCompanies } from '~/hooks/useCompanies';
import { ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useAuthStore } from '~/stores/auth';
import { useCompanyStore } from '~/stores/company';
import type { Company } from '~/types';

const SECTIONS = ['abraflexi', 'sources', 'company'] as const;
type Section = (typeof SECTIONS)[number];

export default function SettingsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const { companies, mutate } = useCompanies();
  const companyId = useCompanyStore((s) => s.companyId);
  const company = companies?.find((c) => c.id === companyId);

  const section: Section = SECTIONS.includes(params.section as Section)
    ? (params.section as Section)
    : 'abraflexi';

  if (!company) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-heading text-[27px] font-bold tracking-tight text-[var(--text-primary)]">
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('settings.subtitle')}</p>
      </header>

      <nav
        aria-label={t('settings.title')}
        className="flex gap-1 border-b border-[var(--border-default)]"
      >
        {SECTIONS.map((s) => (
          <NavLink
            key={s}
            to={s === 'abraflexi' ? '/settings' : `/settings/${s}`}
            end
            className={cn(
              'rounded-t-[var(--radius-token-sm)] px-3 py-2 text-[13px] font-medium transition-colors duration-150',
              section === s
                ? 'border-b-2 border-[var(--brand-primary)] text-[var(--brand-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {t(`settings.tabs.${s}`)}
          </NavLink>
        ))}
      </nav>

      {section === 'abraflexi' && <AbraSection company={company} onSaved={() => mutate()} />}
      {section === 'sources' && <SourcesSection companyId={company.id} />}
      {section === 'company' && <CompanySection company={company} onChanged={() => mutate()} />}
    </div>
  );
}

/** Two uppercase initials from a name (falls back to "?"). */
function accountInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Account card: signed-in user + logout (matches the "Účet" section). */
function AccountCard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.account.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold text-white [background:var(--accent-gradient)]"
              style={{ boxShadow: 'var(--accent-glow)' }}
              aria-hidden="true"
            >
              {accountInitials(user?.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{user?.name}</p>
              <p className="truncate text-xs text-[var(--text-secondary)]">{user?.email}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={logout} icon={<LogOut />}>
            {t('nav.logout')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** How accounting fields are filled when the supplier has no ABRA history. */
function AccountingCard({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(company.accountingFillMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => setMode(company.accountingFillMode), [company.accountingFillMode]);

  async function change(next: Company['accountingFillMode']) {
    setMode(next);
    setSaving(true);
    try {
      await updateCompany(company.id, { accountingFillMode: next });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.accounting.title')}</CardTitle>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t('settings.accounting.hint')}</p>
      </CardHeader>
      <CardContent>
        <Field label={t('settings.accounting.mode')} htmlFor="acc-mode" className="max-w-md">
          <Select
            id="acc-mode"
            value={mode}
            disabled={saving}
            onChange={(e) => change(e.target.value as Company['accountingFillMode'])}
          >
            <option value="history">{t('settings.accounting.history')}</option>
            <option value="ai">{t('settings.accounting.ai')}</option>
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}

/** Trial / subscription status + usage, with activate / cancel. */
function BillingCard({ companyId }: { companyId: string }) {
  const { billing, mutate } = useBilling(companyId);
  const [busy, setBusy] = useState(false);

  if (!billing) return null;

  const daysLeft = billing.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(billing.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  const Pill = ({ tone, label }: { tone: 'success' | 'warning' | 'info'; label: string }) => (
    <span
      className={cn(
        'rounded-[var(--radius-token-full)] px-2.5 py-0.5 text-xs font-medium',
        tone === 'success' && 'bg-[var(--status-success-subtle)] text-[var(--status-success-text)]',
        tone === 'warning' && 'bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)]',
        tone === 'info' && 'bg-[var(--brand-primary-subtle)] text-[var(--brand-primary-light)]'
      )}
    >
      {label}
    </span>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Předplatné</CardTitle>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          99 Kč/měsíc · 50 dokladů v ceně · každý další 2 Kč · fakturováno měsíčně.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {billing.status === 'trial' && (
          <>
            <div className="flex items-center gap-2">
              <Pill tone={billing.blocked ? 'warning' : 'info'} label="Zkušební období" />
              <span className="text-sm text-[var(--text-secondary)]">
                {billing.blocked
                  ? 'Vyčerpáno — aktivujte předplatné'
                  : `zbývá ${daysLeft} ${daysLeft === 1 ? 'den' : daysLeft < 5 ? 'dny' : 'dní'}`}
              </span>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-[var(--text-secondary)]">
                <span>Doklady zdarma</span>
                <span className="tabular-nums">
                  {billing.trialDocsUsed} / {billing.trialDocLimit}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-interactive)]">
                <span
                  className="block h-full rounded-full bg-[var(--brand-primary)]"
                  style={{ width: `${Math.min(100, (billing.trialDocsUsed / billing.trialDocLimit) * 100)}%` }}
                />
              </div>
            </div>
            <Button loading={busy} onClick={() => act(() => subscribeCompany(companyId))}>
              Aktivovat předplatné (99 Kč/měsíc)
            </Button>
          </>
        )}

        {billing.status === 'active' && (
          <>
            <div className="flex items-center gap-2">
              <Pill tone="success" label="Aktivní" />
              <span className="text-sm text-[var(--text-secondary)]">99 Kč/měsíc</span>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-[var(--text-secondary)]">
                <span>Doklady tento měsíc</span>
                <span className="tabular-nums">
                  {billing.used} / {billing.included}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-interactive)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (billing.used / billing.included) * 100)}%`,
                    background: billing.overage > 0 ? 'var(--status-warning)' : 'var(--status-success)',
                  }}
                />
              </div>
            </div>
            {billing.overage > 0 && (
              <p className="text-sm text-[var(--text-secondary)]">
                Nad limit: <span className="font-medium text-[var(--text-primary)]">{billing.overage} dokladů</span>{' '}
                (+{billing.overageCostCzk} Kč). Odhad faktury:{' '}
                <span className="font-semibold text-[var(--text-primary)]">{billing.estimatedTotalCzk} Kč</span>.
              </p>
            )}
            <Button variant="ghost" loading={busy} onClick={() => act(() => cancelSubscription(companyId))}>
              Zrušit předplatné
            </Button>
          </>
        )}

        {billing.status === 'cancelled' && (
          <>
            <Pill tone="warning" label="Zrušeno" />
            <p className="text-sm text-[var(--text-secondary)]">
              Předplatné je zrušené, nové doklady se nezpracovávají.
            </p>
            <Button loading={busy} onClick={() => act(() => subscribeCompany(companyId))}>
              Obnovit předplatné
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CompanySection({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setCompanyId = useCompanyStore((s) => s.setCompanyId);
  const [name, setName] = useState(company.name);
  const [ico, setIco] = useState(company.ico ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(company.name);
    setIco(company.ico ?? '');
    setSaved(false);
    setError(null);
    setConfirmingDelete(false);
  }, [company.id, company.name, company.ico]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateCompany(company.id, { name, ico: ico || null });
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteCompany(company.id);
      setCompanyId(null);
      onChanged();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <AccountCard />

      <BillingCard companyId={company.id} />

      <AccountingCard company={company} onChanged={onChanged} />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.company.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="max-w-md space-y-4">
            <Field label={t('company.name')} htmlFor="cmp-name">
              <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label={t('company.ico')} htmlFor="cmp-ico">
              <Input
                id="cmp-ico"
                value={ico}
                onChange={(e) => setIco(e.target.value)}
                placeholder="12345678"
              />
            </Field>
            {error && (
              <p role="alert" className="text-xs text-[var(--status-error-text)]">
                {error}
              </p>
            )}
            {saved && <p className="text-xs text-[var(--status-success-text)]">{t('settings.saved')}</p>}
            <Button type="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.company.dangerTitle')}</CardTitle>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t('settings.company.dangerHint')}</p>
        </CardHeader>
        <CardContent>
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" loading={deleting} onClick={handleDelete}>
                {t('common.confirmDelete')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              {t('settings.company.delete')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
