import { useAuthStore } from '~/stores/auth';

/** Typed API error — `status` is the HTTP status, `data` the parsed body (if any). */
export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

function extractErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    // Primary backend shape: { error: { code, message, ... } }
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === 'string' && message) return message;
    }
    // Fallbacks: { error: "..." } or { message: "..." }
    for (const key of ['error', 'message'] as const) {
      if (typeof record[key] === 'string' && record[key]) return record[key];
    }
  }
  return `Request failed (${status})`;
}

/**
 * Fetch wrapper: adds Bearer token, JSON encoding/decoding, typed errors.
 * On 401 clears the auth store and redirects to /login.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  let data: unknown;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (res.status === 401) {
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
    throw new ApiError(extractErrorMessage(data, 401), 401, data);
  }

  if (!res.ok) {
    throw new ApiError(extractErrorMessage(data, res.status), res.status, data);
  }

  return data as T;
}

/**
 * Multipart upload — same auth and error handling as `api()`, but sends
 * FormData and lets the browser set the Content-Type boundary.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { method: 'POST', headers, body: formData });

  let data: unknown;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (res.status === 401) {
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
    throw new ApiError(extractErrorMessage(data, 401), 401, data);
  }
  if (!res.ok) {
    throw new ApiError(extractErrorMessage(data, res.status), res.status, data);
  }
  return data as T;
}

/** Default SWR fetcher — cache keys are API endpoint paths. */
export function swrFetcher<T>(path: string): Promise<T> {
  return api<T>(path);
}
