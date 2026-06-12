import useSWR from 'swr';
import type { StatsResponse } from '~/types';

export function useStats(companyId: string | null, refreshInterval = 15000) {
  const key = companyId ? `/api/companies/${companyId}/documents/stats` : null;
  const { data, error, isLoading, mutate } = useSWR<StatsResponse>(key, {
    refreshInterval,
    keepPreviousData: true,
  });

  return { stats: data, error, isLoading, mutate };
}
