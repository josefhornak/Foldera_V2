import useSWR from 'swr';
import { api } from '~/lib/api';
import type { Billing } from '~/types';

export function useBilling(companyId: string | null) {
  const key = companyId ? `/api/companies/${companyId}/billing` : null;
  const { data, error, isLoading, mutate } = useSWR<{ billing: Billing }>(key, {
    refreshInterval: 30000,
    keepPreviousData: true,
  });
  return { billing: data?.billing, error, isLoading, mutate };
}

export function subscribeCompany(companyId: string) {
  return api<{ billing: Billing }>(`/api/companies/${companyId}/subscribe`, { method: 'POST' });
}

export function cancelSubscription(companyId: string) {
  return api<{ billing: Billing }>(`/api/companies/${companyId}/cancel`, { method: 'POST' });
}
