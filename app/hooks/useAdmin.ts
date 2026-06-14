import useSWR from 'swr';
import { api } from '~/lib/api';
import { useAuthStore } from '~/stores/auth';
import type { User } from '~/types';

/** Download an issued invoice PDF (rebuilt server-side from the stored data). */
export async function downloadInvoicePdf(id: string, number: string) {
  const token = useAuthStore.getState().token;
  const res = await fetch(`/api/admin/invoices/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Stažení faktury se nezdařilo');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `faktura-${number}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface AdminInvoice {
  id: string;
  number: string;
  period: string;
  customerName: string;
  customerIco: string | null;
  recipientEmail: string;
  issueDate: string;
  dueDate: string;
  variableSymbol: string;
  totalCzk: number;
  paidAt: string | null;
  state: 'paid' | 'overdue' | 'sent' | 'failed';
}

export interface AdminSummary {
  total: number;
  paid: number;
  overdue: number;
  outstandingCzk: number;
}

/** Current user incl. admin flag (refreshes the persisted login payload). */
export function useMe() {
  const { data } = useSWR<{ user: User }>('/api/auth/me', { revalidateOnFocus: false });
  return { user: data?.user, isAdmin: Boolean(data?.user?.isAdmin) };
}

export function useAdminInvoices(enabled: boolean) {
  const { data, error, isLoading, mutate } = useSWR<{ invoices: AdminInvoice[]; summary: AdminSummary }>(
    enabled ? '/api/admin/invoices' : null,
    { refreshInterval: 60000 }
  );
  return { invoices: data?.invoices, summary: data?.summary, error, isLoading, mutate };
}

export function markInvoicePaid(id: string) {
  return api(`/api/admin/invoices/${id}/paid`, { method: 'POST' });
}
export function markInvoiceUnpaid(id: string) {
  return api(`/api/admin/invoices/${id}/unpaid`, { method: 'POST' });
}

export interface AdminOverview {
  users: number;
  companies: number;
  docsTotal: number;
  docsExported: number;
  trial: number;
  active: number;
  cancelled: number;
  mrrCzk: number;
  invoicesOutstandingCzk: number;
}

export interface AdminCompany {
  id: string;
  name: string;
  ico: string | null;
  ownerEmail: string | null;
  billingStatus: 'trial' | 'active' | 'cancelled';
  abraConfigured: boolean;
  createdAt: string;
  trialEndsAt: string | null;
  subscriptionStartedAt: string | null;
  docsTotal: number;
  docsExported: number;
  members: number;
  sources: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
  companies: number;
}

export function useAdminOverview(enabled: boolean) {
  const { data, error, isLoading } = useSWR<{ overview: AdminOverview }>(
    enabled ? '/api/admin/overview' : null,
    { refreshInterval: 60000 }
  );
  return { overview: data?.overview, error, isLoading };
}

export function useAdminCompanies(enabled: boolean) {
  const { data, error, isLoading } = useSWR<{ companies: AdminCompany[] }>(
    enabled ? '/api/admin/companies' : null,
    { refreshInterval: 60000 }
  );
  return { companies: data?.companies, error, isLoading };
}

export function useAdminUsers(enabled: boolean) {
  const { data, error, isLoading } = useSWR<{ users: AdminUser[] }>(enabled ? '/api/admin/users' : null, {
    refreshInterval: 60000,
  });
  return { users: data?.users, error, isLoading };
}
