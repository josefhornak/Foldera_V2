import useSWR from 'swr';
import { api } from '~/lib/api';
import { useAuthStore } from '~/stores/auth';
import type { Company } from '~/types';

interface CompaniesResponse {
  companies: Company[];
}

export function useCompanies() {
  const token = useAuthStore((s) => s.token);
  const { data, error, isLoading, mutate } = useSWR<CompaniesResponse>(token ? '/api/companies' : null);

  return {
    companies: data?.companies,
    error,
    isLoading,
    mutate,
  };
}

export function createCompany(input: { name: string; ico?: string }) {
  return api<{ company: Company }>('/api/companies', { method: 'POST', body: input });
}

export function updateCompany(
  id: string,
  input: { name?: string; ico?: string | null; accountingFillMode?: Company['accountingFillMode'] }
) {
  return api<{ company: Company }>(`/api/companies/${id}`, { method: 'PATCH', body: input });
}

export function deleteCompany(id: string) {
  return api<{ ok: boolean }>(`/api/companies/${id}`, { method: 'DELETE' });
}
