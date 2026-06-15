import useSWR from 'swr';
import { api } from '~/lib/api';
import type { DocumentDetail, DocumentsResponse } from '~/types';

interface DocumentsQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  refreshInterval?: number;
}

export function documentsKey(companyId: string, query: DocumentsQuery = {}): string {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 20));
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  return `/api/companies/${companyId}/documents?${params.toString()}`;
}

export function useDocuments(companyId: string | null, query: DocumentsQuery = {}) {
  const key = companyId ? documentsKey(companyId, query) : null;
  const { data, error, isLoading, mutate } = useSWR<DocumentsResponse>(key, {
    refreshInterval: query.refreshInterval,
    keepPreviousData: true,
  });

  return {
    documents: data?.documents,
    total: data?.total ?? 0,
    error,
    isLoading,
    mutate,
  };
}

export function useDocumentDetail(companyId: string | null, docId: string | null) {
  const key = companyId && docId ? `/api/companies/${companyId}/documents/${docId}` : null;
  const { data, error, isLoading, mutate } = useSWR<{ document: DocumentDetail }>(key);

  return {
    document: data?.document,
    error,
    isLoading,
    mutate,
  };
}

export function retryDocument(companyId: string, docId: string) {
  return api<{ ok: boolean }>(`/api/companies/${companyId}/documents/${docId}/retry`, {
    method: 'POST',
  });
}

/** Approve a document held for bank-account review → export it. */
export function approveDocument(companyId: string, docId: string) {
  return api<{ ok: boolean }>(`/api/companies/${companyId}/documents/${docId}/approve`, {
    method: 'POST',
  });
}

export interface DeleteDocumentResult {
  ok: boolean;
  /** Present when fromAbra was requested for an exported document. */
  abra: { deleted: boolean; alreadyGone: boolean } | null;
}

/**
 * Delete a document from Foldera. When `fromAbra` is true and the document was
 * exported, it is also removed from ABRA Flexi (no-op if it's already gone
 * there). A hard ABRA failure rejects and leaves the Foldera record intact.
 */
export function deleteDocument(companyId: string, docId: string, fromAbra = false) {
  const qs = fromAbra ? '?fromAbra=true' : '';
  return api<DeleteDocumentResult>(`/api/companies/${companyId}/documents/${docId}${qs}`, {
    method: 'DELETE',
  });
}
