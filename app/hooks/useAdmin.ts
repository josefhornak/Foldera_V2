import useSWR from 'swr';
import { api } from '~/lib/api';
import type { User } from '~/types';

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
