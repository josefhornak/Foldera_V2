import { useState } from 'react';
import { Navigate } from 'react-router';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '~/components/ui/Button';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { cn } from '~/lib/utils';
import {
  markInvoicePaid,
  markInvoiceUnpaid,
  useAdminInvoices,
  useMe,
  type AdminInvoice,
} from '~/hooks/useAdmin';

const STATE_META: Record<AdminInvoice['state'], { label: string; color: string }> = {
  paid: { label: 'Zaplaceno', color: 'var(--status-success)' },
  overdue: { label: 'Po splatnosti', color: 'var(--status-error)' },
  sent: { label: 'Odesláno', color: 'var(--status-info)' },
  failed: { label: 'Chyba', color: 'var(--status-warning)' },
};

const czk = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;

export default function AdminInvoices() {
  const { isAdmin } = useMe();
  const { invoices, summary, error, isLoading, mutate } = useAdminInvoices(isAdmin);
  const [busy, setBusy] = useState<string | null>(null);

  // useMe is undefined while loading; only redirect once we know it's false.
  const { user } = useMe();
  if (user && !isAdmin) return <Navigate to="/dashboard" replace />;

  async function toggle(inv: AdminInvoice) {
    setBusy(inv.id);
    try {
      if (inv.state === 'paid') await markInvoiceUnpaid(inv.id);
      else await markInvoicePaid(inv.id);
      await mutate();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Fakturace</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Přehled vystavených faktur a jejich úhrad.</p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard label="Vystaveno faktur" value={String(summary?.total ?? 0)} />
        <SummaryCard label="Nezaplaceno" value={czk(summary?.outstandingCzk ?? 0)} accent />
        <SummaryCard label="Po splatnosti" value={String(summary?.overdue ?? 0)} danger={Boolean(summary?.overdue)} />
      </div>

      <StateWrapper loading={isLoading} error={error} onRetry={() => mutate()}>
        {invoices && invoices.length === 0 ? (
          <div className="rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-default)] p-10 text-center text-sm text-[var(--text-secondary)]">
            Zatím nebyla vystavena žádná faktura. Faktury se generují automaticky vždy 1. v měsíci za předchozí měsíc.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-default)]">
            {/* table header (desktop) */}
            <div className="hidden grid-cols-[1.6fr_1fr_0.8fr_0.9fr_0.9fr_auto] gap-3 border-b border-[var(--border-subtle)] px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] md:grid">
              <span>Odběratel</span>
              <span>Číslo / VS</span>
              <span className="text-right">Částka</span>
              <span>Splatnost</span>
              <span>Stav</span>
              <span />
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {invoices?.map((inv) => {
                const meta = STATE_META[inv.state];
                return (
                  <div
                    key={inv.id}
                    className="flex flex-col gap-3 px-5 py-4 md:grid md:grid-cols-[1.6fr_1fr_0.8fr_0.9fr_0.9fr_auto] md:items-center md:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{inv.customerName}</p>
                      <p className="truncate text-xs text-[var(--text-tertiary)]">{inv.recipientEmail}</p>
                    </div>
                    <div className="text-xs">
                      <p className="font-medium text-[var(--text-secondary)]">{inv.number}</p>
                      <p className="text-[var(--text-tertiary)]">VS {inv.variableSymbol} · {inv.period}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums md:text-right">{czk(inv.totalCzk)}</span>
                    <span className="text-xs text-[var(--text-secondary)]">{inv.dueDate}</span>
                    <span className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: meta.color }}>
                      <span className="status-dot" style={{ color: meta.color }} />
                      {meta.label}
                    </span>
                    <div className="md:justify-self-end">
                      {inv.state !== 'failed' && (
                        <Button
                          size="sm"
                          variant={inv.state === 'paid' ? 'secondary' : 'primary'}
                          loading={busy === inv.id}
                          onClick={() => toggle(inv)}
                          icon={inv.state === 'paid' ? <RotateCcw /> : <Check />}
                        >
                          {inv.state === 'paid' ? 'Zrušit' : 'Zaplaceno'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </StateWrapper>
    </div>
  );
}

function SummaryCard({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-default)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <p
        className={cn(
          'mt-1.5 font-heading text-xl font-bold tabular-nums',
          accent && 'text-[var(--brand-primary-light)]',
          danger && 'text-[var(--status-error-text)]'
        )}
      >
        {value}
      </p>
    </div>
  );
}
