import useSWR from 'swr';
import { api } from '~/lib/api';
import type { Folder, Source, SourcesResponse } from '~/types';

export function useSources(companyId: string | null) {
  const key = companyId ? `/api/companies/${companyId}/sources` : null;
  const { data, error, isLoading, mutate } = useSWR<SourcesResponse>(key);

  return {
    sources: data?.sources,
    capabilities: data?.capabilities,
    error,
    isLoading,
    mutate,
  };
}

/** Provision an app-managed collection mailbox for the company. */
export function createCollectionEmailSource(companyId: string) {
  return api<{ source: Source }>(`/api/companies/${companyId}/sources/collection-email`, {
    method: 'POST',
  });
}

export interface ImapInput {
  name: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  folder?: string;
}

export function createImapSource(companyId: string, input: ImapInput) {
  return api<{ source: Source }>(`/api/companies/${companyId}/sources/imap`, {
    method: 'POST',
    body: input,
  });
}

export function testImapSource(companyId: string, input: ImapInput) {
  return api<{ ok: boolean; error?: string }>(`/api/companies/${companyId}/sources/imap/test`, {
    method: 'POST',
    body: input,
  });
}

export function updateSource(companyId: string, sourceId: string, input: { name?: string; enabled?: boolean }) {
  return api<{ source: Source }>(`/api/companies/${companyId}/sources/${sourceId}`, {
    method: 'PATCH',
    body: input,
  });
}

export function deleteSource(companyId: string, sourceId: string) {
  return api<{ ok: boolean }>(`/api/companies/${companyId}/sources/${sourceId}`, {
    method: 'DELETE',
  });
}

export function pollSource(companyId: string, sourceId: string) {
  return api<{ ok: boolean }>(`/api/companies/${companyId}/sources/${sourceId}/poll`, {
    method: 'POST',
  });
}

export function listSourceFolders(companyId: string, sourceId: string, parentId?: string) {
  const suffix = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
  return api<{ folders: Folder[] }>(`/api/companies/${companyId}/sources/${sourceId}/folders${suffix}`);
}

export function setSourceFolder(companyId: string, sourceId: string, input: { folderId: string; folderPath: string }) {
  return api<{ source: Source }>(`/api/companies/${companyId}/sources/${sourceId}/folder`, {
    method: 'PATCH',
    body: input,
  });
}

export function startOAuth(provider: 'onedrive' | 'google_drive', companyId: string) {
  return api<{ url: string }>(`/api/oauth/${provider}/start?companyId=${encodeURIComponent(companyId)}`);
}
