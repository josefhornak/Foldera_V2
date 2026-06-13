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

export function createCompany(input: { name: string; ico?: string; billingEmail?: string }) {
  return api<{ company: Company }>('/api/companies', { method: 'POST', body: input });
}

export function updateCompany(
  id: string,
  input: {
    name?: string;
    ico?: string | null;
    billingEmail?: string | null;
    accountingFillMode?: Company['accountingFillMode'];
    attachOriginalEmail?: boolean;
    advanceInvoiceType?: string | null;
    taxPaymentType?: string | null;
  }
) {
  return api<{ company: Company }>(`/api/companies/${id}`, { method: 'PATCH', body: input });
}

export function deleteCompany(id: string) {
  return api<{ ok: boolean }>(`/api/companies/${id}`, { method: 'DELETE' });
}

export interface AbraInvoiceType {
  kod: string;
  nazev: string;
}
export function useInvoiceTypes(companyId: string | null, enabled: boolean) {
  const { data, isLoading } = useSWR<{ types: AbraInvoiceType[] }>(
    companyId && enabled ? `/api/companies/${companyId}/abraflexi/invoice-types` : null,
    { revalidateOnFocus: false }
  );
  return { types: data?.types, isLoading };
}
