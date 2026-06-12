import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AbraSection } from '~/components/settings/AbraSection';
import { SourcesSection } from '~/components/settings/SourcesSection';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/Card';
import { Field, Input } from '~/components/ui/Input';
import { LogOut } from 'lucide-react';
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
