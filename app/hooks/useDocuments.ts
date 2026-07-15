import useSWR from 'swr';
import { api, apiBlob } from '~/lib/api';
import type { DocumentDetail, DocumentEdit, DocumentsResponse } from '~/types';

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

/** The OCR transcript — loaded on demand, it is far too big for the detail payload. */
export function useDocumentText(companyId: string | null, docId: string | null, enabled: boolean) {
  const key = companyId && docId && enabled ? `/api/companies/${companyId}/documents/${docId}/text` : null;
  const { data, error, isLoading } = useSWR<{ text: string | null }>(key);

  return { text: data?.text ?? null, error, isLoading };
}

/**
 * Correct what the AI read. The saved data is what a resend sends, so this is
 * what makes the retry below do something different.
 */
export function updateDocument(companyId: string, docId: string, patch: DocumentEdit) {
  return api<{ document: DocumentDetail }>(`/api/companies/${companyId}/documents/${docId}`, {
    method: 'PATCH',
    body: patch,
  });
}

/** The original file, as an object URL the caller owns and must revoke. */
export async function fetchDocumentFileUrl(companyId: string, docId: string): Promise<string> {
  const blob = await apiBlob(`/api/companies/${companyId}/documents/${docId}/file`);
  return URL.createObjectURL(blob);
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
