import { useState } from 'react';
import { Navigate } from 'react-router';
import { Building2, FileText, Receipt, Users } from 'lucide-react';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { cn } from '~/lib/utils';
import {
  useAdminCompanies,
  useAdminOverview,
  useAdminUsers,
  useMe,
  type AdminCompany,
  type AdminUser,
} from '~/hooks/useAdmin';
import { InvoicesPanel } from './admin-invoices';

const czk = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('cs-CZ') : '—');

const STATUS_LABEL: Record<AdminCompany['billingStatus'], { label: string; color: string }> = {
  trial: { label: 'Trial', color: 'var(--status-info)' },
  active: { label: 'Aktivní', color: 'var(--status-success)' },
  cancelled: { label: 'Zrušeno', color: 'var(--status-error)' },
};

type Tab = 'overview' | 'companies' | 'users' | 'invoices';
const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'overview', label: 'Přehled', icon: FileText },
  { key: 'companies', label: 'Firmy', icon: Building2 },
  { key: 'users', label: 'Uživatelé', icon: Users },
  { key: 'invoices', label: 'Fakturace', icon: Receipt },
];

export function meta() {
  return [{ title: 'Admin — Foldera' }, { name: 'robots', content: 'noindex' }];
}

export default function AdminConsole() {
  const { user, isAdmin } = useMe();
  const [tab, setTab] = useState<Tab>('overview');
  if (user && !isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Admin konzole</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Přehled napříč všemi firmami a uživateli.</p>
      </header>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-[var(--radius-token-md)] px-3.5 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-[var(--brand-primary)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-interactive)] hover:text-[var(--text-primary)]'
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'companies' && <CompaniesTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'invoices' && <InvoicesPanel />}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-default)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <p className={cn('mt-1.5 font-heading text-xl font-bold tabular-nums', accent && 'text-[var(--brand-primary-light)]')}>
        {value}
      </p>
    </div>
  );
}

function OverviewTab() {
  const { isAdmin } = useMe();
  const { overview, error, isLoading } = useAdminOverview(isAdmin);
  return (
    <StateWrapper loading={isLoading} error={error}>
      {overview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Uživatelé" value={String(overview.users)} />
            <StatCard label="Firmy" value={String(overview.companies)} />
            <StatCard label="Doklady do ABRA" value={overview.docsExported.toLocaleString('cs-CZ')} />
            <StatCard label="Doklady celkem" value={overview.docsTotal.toLocaleString('cs-CZ')} />
            <StatCard label="Aktivní předplatné" value={String(overview.active)} />
            <StatCard label="Trial" value={String(overview.trial)} />
            <StatCard label="MRR (odhad)" value={czk(overview.mrrCzk)} accent />
            <StatCard label="Nezaplacené faktury" value={czk(overview.invoicesOutstandingCzk)} />
          </div>
        </div>
      )}
    </StateWrapper>
  );
}

function StatusPill({ status }: { status: AdminCompany['billingStatus'] }) {
  const m = STATUS_LABEL[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: m.color }}>
      <span className="status-dot" style={{ color: m.color }} />
      {m.label}
    </span>
  );
}

function CompaniesTab() {
  const { isAdmin } = useMe();
  const { companies, error, isLoading } = useAdminCompanies(isAdmin);
  return (
    <StateWrapper loading={isLoading} error={error} empty={companies?.length === 0} emptyMessage="Zatím žádné firmy.">
      <div className="overflow-x-auto rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-default)]">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
              <th className="px-4 py-3 font-semibold">Firma</th>
              <th className="px-4 py-3 font-semibold">Vlastník</th>
              <th className="px-4 py-3 font-semibold">Stav</th>
              <th className="px-4 py-3 text-right font-semibold">Doklady (ABRA/celk.)</th>
              <th className="px-4 py-3 text-center font-semibold">Členové</th>
              <th className="px-4 py-3 text-center font-semibold">Zdroje</th>
              <th className="px-4 py-3 text-center font-semibold">ABRA</th>
              <th className="px-4 py-3 font-semibold">Registrace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {companies?.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--text-primary)]">{c.name}</p>
                  {c.ico && <p className="text-xs text-[var(--text-tertiary)]">IČO {c.ico}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{c.ownerEmail ?? '—'}</td>
                <td className="px-4 py-3"><StatusPill status={c.billingStatus} /></td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className="font-semibold">{c.docsExported}</span>
                  <span className="text-[var(--text-tertiary)]"> / {c.docsTotal}</span>
                </td>
                <td className="px-4 py-3 text-center tabular-nums">{c.members}</td>
                <td className="px-4 py-3 text-center tabular-nums">{c.sources}</td>
                <td className="px-4 py-3 text-center">{c.abraConfigured ? '✓' : '—'}</td>
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{date(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StateWrapper>
  );
}

function UsersTab() {
  const { isAdmin } = useMe();
  const { users, error, isLoading } = useAdminUsers(isAdmin);
  return (
    <StateWrapper loading={isLoading} error={error} empty={users?.length === 0} emptyMessage="Zatím žádní uživatelé.">
      <div className="overflow-x-auto rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-default)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
              <th className="px-4 py-3 font-semibold">E-mail</th>
              <th className="px-4 py-3 font-semibold">Jméno</th>
              <th className="px-4 py-3 text-center font-semibold">Ověřen</th>
              <th className="px-4 py-3 text-center font-semibold">Firem</th>
              <th className="px-4 py-3 font-semibold">Registrace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {users?.map((u: AdminUser) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{u.email}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{u.name}</td>
                <td className="px-4 py-3 text-center">
                  {u.emailVerified ? <span className="text-[var(--status-success-text)]">✓</span> : '—'}
                </td>
                <td className="px-4 py-3 text-center tabular-nums">{u.companies}</td>
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{date(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StateWrapper>
  );
}
