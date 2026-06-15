import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AbraSection } from '~/components/settings/AbraSection';
import { SourcesSection } from '~/components/settings/SourcesSection';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/Card';
import { Field, Input, Select } from '~/components/ui/Input';
import { Switch } from '~/components/ui/Switch';
import { LogOut, Mail, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useBilling, subscribeCompany, cancelSubscription } from '~/hooks/useBilling';
import { deleteCompany, updateCompany, useCompanies } from '~/hooks/useCompanies';
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvite,
  useTeam,
  type Role,
} from '~/hooks/useTeam';
import { ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useAuthStore } from '~/stores/auth';
import { useCompanyStore } from '~/stores/company';
import type { Company } from '~/types';

const SECTIONS = ['abraflexi', 'sources', 'company', 'team'] as const;
type Section = (typeof SECTIONS)[number];
const TAB_LABEL: Record<Section, string> = {
  abraflexi: 'ABRA Flexi',
  sources: 'Zdroje',
  company: 'Firma',
  team: 'Tým',
};

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
    <div className="mx-auto max-w-[1280px] space-y-6">
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
            {TAB_LABEL[s]}
          </NavLink>
        ))}
      </nav>

      {section === 'abraflexi' && <AbraSection company={company} onSaved={() => mutate()} />}
      {section === 'sources' && <SourcesSection companyId={company.id} />}
      {section === 'company' && <CompanySection company={company} onChanged={() => mutate()} />}
      {section === 'team' && <TeamSection company={company} />}
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

/** Choose how invoice line items are extracted: full detail vs summary per VAT rate. */
function LineItemsCard({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [mode, setMode] = useState(company.lineItemMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => setMode(company.lineItemMode), [company.lineItemMode]);

  async function change(next: Company['lineItemMode']) {
    const prev = mode;
    setMode(next);
    setSaving(true);
    try {
      await updateCompany(company.id, { lineItemMode: next });
      onChanged();
    } catch {
      setMode(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vytěžování položek</CardTitle>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Jak se z dokladu přenášejí položky do ABRA Flexi.
        </p>
      </CardHeader>
      <CardContent>
        <Field label="Režim položek" htmlFor="li-mode" className="max-w-md">
          <Select
            id="li-mode"
            value={mode}
            disabled={saving}
            onChange={(e) => change(e.target.value as Company['lineItemMode'])}
          >
            <option value="detail">Kompletní řádkové položky z dokladu</option>
            <option value="summary">Souhrnně – jedna položka na sazbu DPH</option>
          </Select>
        </Field>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          {mode === 'summary'
            ? 'Položky se sloučí do jedné na každou sazbu DPH. Celková částka zůstává stejná.'
            : 'Do ABRA se přenese každá řádková položka tak, jak je na dokladu.'}
        </p>
      </CardContent>
    </Card>
  );
}

/** Anti-fraud pre-export review gates (checked against ABRA Flexi). */
function ReviewCard({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [supplier, setSupplier] = useState(company.newSupplierMode);
  const [bank, setBank] = useState(company.bankAccountMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSupplier(company.newSupplierMode);
    setBank(company.bankAccountMode);
  }, [company.newSupplierMode, company.bankAccountMode]);

  async function change(patch: { newSupplierMode?: Company['newSupplierMode']; bankAccountMode?: Company['bankAccountMode'] }) {
    if (patch.newSupplierMode) setSupplier(patch.newSupplierMode);
    if (patch.bankAccountMode) setBank(patch.bankAccountMode);
    setSaving(true);
    try {
      await updateCompany(company.id, patch);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kontrola před založením</CardTitle>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Ochrana proti přesměrování platby. Foldera ověřuje přímo v ABRA Flexi.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field label="Neznámý dodavatel (není v ABRA Flexi)" htmlFor="rev-supplier" className="max-w-md">
          <Select
            id="rev-supplier"
            value={supplier}
            disabled={saving}
            onChange={(e) => change({ newSupplierMode: e.target.value as Company['newSupplierMode'] })}
          >
            <option value="auto">Založit automaticky</option>
            <option value="review">Schválit správcem (založí se po schválení)</option>
          </Select>
        </Field>
        <Field label="Nový nebo změněný bankovní účet dodavatele" htmlFor="rev-bank" className="max-w-md">
          <Select
            id="rev-bank"
            value={bank}
            disabled={saving}
            onChange={(e) => change({ bankAccountMode: e.target.value as Company['bankAccountMode'] })}
          >
            <option value="auto">Založit automaticky</option>
            <option value="review">Schválit správcem (ochrana plateb)</option>
          </Select>
        </Field>
        <p className="text-xs text-[var(--text-tertiary)]">
          Když je nastaveno „Schválit správcem", pozdržený doklad počká v sekci Doklady a správci přijde e-mail.
          Po schválení se založí do ABRA Flexi.
        </p>
      </CardContent>
    </Card>
  );
}

/** Toggle: attach the original e-mail (.eml) to the ABRA document. */
function EmailOptionsCard({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [on, setOn] = useState(company.attachOriginalEmail);
  const [saving, setSaving] = useState(false);

  useEffect(() => setOn(company.attachOriginalEmail), [company.attachOriginalEmail]);

  async function toggle() {
    const next = !on;
    setOn(next);
    setSaving(true);
    try {
      await updateCompany(company.id, { attachOriginalEmail: next });
      onChanged();
    } catch {
      setOn(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zpracování e-mailů</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Ukládat originální e-mail (.eml) do ABRA Flexi
            </p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              U dokladů přijatých e-mailem se k dokladu v ABRA přiloží i původní zpráva (.eml). Faktura z cloudu
              (OneDrive / Google Drive) původní e-mail nemá.
            </p>
          </div>
          <div className="mt-0.5 shrink-0">
            <Switch
              checked={on}
              onChange={toggle}
              disabled={saving}
              label="Ukládat originální e-mail (.eml) do ABRA Flexi"
            />
          </div>
        </div>
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
          199 Kč/měsíc · 100 dokladů v ceně · každý další 2 Kč · fakturováno měsíčně.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {billing.status === 'trial' && (
          <>
            <div className="flex items-center gap-2">
              <Pill tone={billing.blocked ? 'warning' : 'info'} label="Zkušební období" />
              <span className="text-sm text-[var(--text-secondary)]">
                {billing.blocked
                  ? 'Vyčerpáno - aktivujte předplatné'
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
              Aktivovat předplatné (199 Kč/měsíc)
            </Button>
          </>
        )}

        {billing.status === 'active' && (
          <>
            <div className="flex items-center gap-2">
              <Pill tone="success" label="Aktivní" />
              <span className="text-sm text-[var(--text-secondary)]">199 Kč/měsíc</span>
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

      <LineItemsCard company={company} onChanged={onChanged} />

      <ReviewCard company={company} onChanged={onChanged} />

      <EmailOptionsCard company={company} onChanged={onChanged} />

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

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-token-full)] px-2 py-0.5 text-[11px] font-medium',
        role === 'admin'
          ? 'bg-[var(--brand-primary-subtle)] text-[var(--brand-primary-light)]'
          : 'bg-[var(--surface-interactive)] text-[var(--text-secondary)]'
      )}
    >
      {role === 'admin' ? <ShieldCheck className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
      {role === 'admin' ? 'Správce' : 'Jen nahlíží'}
    </span>
  );
}

/** Team management: invite people by e-mail and assign roles. Read-only for members. */
function TeamSection({ company }: { company: Company }) {
  const { members, invitations, role, mutate } = useTeam(company.id);
  const isAdmin = (role ?? company.role) === 'admin';
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Akce se nezdařila.');
    } finally {
      setBusy(null);
    }
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    setSent(false);
    await run('invite', async () => {
      await inviteMember(company.id, email, inviteRole);
      setEmail('');
      setSent(true);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Role v týmu</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary-light)]" />
              <span>
                <b className="text-[var(--text-primary)]">Správce</b> - plný přístup: připojení k ABRA Flexi, zdroje
                faktur, nahrávání a mazání dokladů, předplatné a správa týmu (zve a odebírá lidi).
              </span>
            </p>
            <p className="flex items-start gap-2">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
              <span>
                <b className="text-[var(--text-primary)]">Běžný uživatel</b> - jen nahlíží: vidí přehled a doklady, ale
                nemůže nic měnit, nahrávat ani spravovat nastavení.
              </span>
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Kdo firmu vytvoří, je automaticky správce. Firma musí mít vždy aspoň jednoho správce.
            </p>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Pozvat člena</CardTitle>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">Pošleme e-mailem pozvánku s odkazem (platí 7 dní).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="E-mail" htmlFor="inv-email" className="flex-1">
                <Input
                  id="inv-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="kolega@firma.cz"
                  required
                />
              </Field>
              <Field label="Role" htmlFor="inv-role" className="sm:w-44">
                <Select id="inv-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                  <option value="member">Jen nahlíží</option>
                  <option value="admin">Správce</option>
                </Select>
              </Field>
              <Button type="submit" loading={busy === 'invite'} icon={<Mail />}>
                Pozvat
              </Button>
            </form>
            {sent && <p className="mt-3 text-xs text-[var(--status-success-text)]">Pozvánka odeslána.</p>}
            {error && <p className="mt-3 text-xs text-[var(--status-error-text)]">{error}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Členové{members ? ` (${members.length})` : ''}</CardTitle>
          {!isAdmin && <p className="mt-1 text-xs text-[var(--text-tertiary)]">Jste běžný uživatel - jen nahlížíte.</p>}
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {(members ?? []).map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name} {m.isYou && <span className="text-[var(--text-tertiary)]">(vy)</span>}
                  </p>
                  <p className="truncate text-xs text-[var(--text-tertiary)]">{m.email}</p>
                </div>
                {isAdmin && !m.isYou ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.role}
                      onChange={(e) => run(`role-${m.userId}`, () => changeMemberRole(company.id, m.userId, e.target.value as Role))}
                      className="!h-8 !w-32 text-xs"
                    >
                      <option value="member">Jen nahlíží</option>
                      <option value="admin">Správce</option>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `rm-${m.userId}`}
                      onClick={() => run(`rm-${m.userId}`, () => removeMember(company.id, m.userId))}
                      icon={<Trash2 />}
                      aria-label="Odebrat"
                    />
                  </div>
                ) : (
                  <RoleBadge role={m.role} />
                )}
              </li>
            ))}
          </ul>

          {isAdmin && invitations && invitations.length > 0 && (
            <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Čeká na přijetí</p>
              <ul className="space-y-2">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3">
                    <Mail className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{inv.email}</span>
                    <RoleBadge role={inv.role} />
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `inv-${inv.id}`}
                      onClick={() => run(`inv-${inv.id}`, () => revokeInvite(company.id, inv.id))}
                    >
                      Zrušit
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && !sent && <p className="mt-3 text-xs text-[var(--status-error-text)]">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
