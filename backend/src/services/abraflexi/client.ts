/**
 * ABRA Flexi HTTP client.
 *
 * Fetch-based transport with:
 * - Basic auth (apiUser:apiPassword)
 * - 30s timeout per attempt (AbortController)
 * - Retry with exponential backoff + jitter: 3 attempts on network errors,
 *   timeouts, HTTP 5xx and 429 — NEVER on other 4xx (a rejected payload will
 *   not get better by retrying)
 * - SSRF guard on the (user-configured) base URL
 * - winstrom envelope parsing helpers
 *
 * Simplified port of V1 `services/erp/resilientClient.ts` — no DB-backed
 * circuit breaker, no rate limiter, no telemetry.
 */

import { logger } from '../../utils/logger.js';
import { AppError, ErrorCodes, toError } from '../../utils/errors.js';
import type { AbraFlexiConfig } from '../../types/contracts.js';
import { normalizeBaseUrl } from './helpers.js';
import { abraWriteResponseSchema, abraListEnvelopeSchema } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 8_000;

export interface AbraRequestOptions {
  /** Path appended to the normalized base URL (usually starts with '/'; '.json' probes the company resource itself) */
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Request body — JSON string or raw bytes (attachments) */
  body?: string | Uint8Array;
  /** Content-Type header when a body is sent (default application/json) */
  contentType?: string;
  timeoutMs?: number;
}

export interface AbraHttpResponse {
  status: number;
  statusText: string;
  ok: boolean;
  text: string;
}

function buildHeaders(cfg: AbraFlexiConfig, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${cfg.apiUser}:${cfg.apiPassword}`).toString('base64')}`,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function backoffDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = delay * 0.2 * (Math.random() - 0.5);
  return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute one HTTP request against ABRA Flexi with timeout + retry.
 * Non-2xx responses are returned (not thrown) so callers can inspect the body;
 * retryable statuses (5xx/429) are retried before being returned.
 *
 * @throws {AppError} SERVICE_UNAVAILABLE when the host is unreachable after all attempts
 */
export async function abraRequest(
  cfg: AbraFlexiConfig,
  opts: AbraRequestOptions,
): Promise<AbraHttpResponse> {
  const baseUrl = normalizeBaseUrl(cfg.apiUrl);
  const url = `${baseUrl}${opts.path}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = opts.method ?? 'GET';
  const headers = buildHeaders(cfg, opts.body !== undefined ? (opts.contentType ?? 'application/json') : undefined);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: opts.body,
        signal: controller.signal,
      });
      const text = await response.text();

      if (!response.ok && isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
        logger.warn(
          { companyId: cfg.companyId, url, status: response.status, attempt },
          '[AbraFlexi] Retryable HTTP error — backing off',
        );
        await sleep(backoffDelay(attempt));
        continue;
      }

      return { status: response.status, statusText: response.statusText, ok: response.ok, text };
    } catch (error: unknown) {
      lastError = toError(error);
      const isTimeout = lastError.name === 'AbortError';
      logger.warn(
        { companyId: cfg.companyId, url, attempt, error: lastError.message, isTimeout },
        '[AbraFlexi] Request failed',
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError(
    ErrorCodes.SERVICE_UNAVAILABLE,
    `Nepodařilo se připojit k ABRA Flexi: ${lastError?.message ?? 'neznámá chyba'}`,
    503,
  );
}

// ---------------------------------------------------------------------------
// winstrom envelope parsing
// ---------------------------------------------------------------------------

/**
 * Extract human-readable error messages from an ABRA Flexi error response body.
 * Returns '' when the body is not parseable.
 */
export function parseAbraErrorMessages(responseText: string): string {
  try {
    const parsed = abraWriteResponseSchema.safeParse(JSON.parse(responseText));
    const win = parsed.success ? parsed.data.winstrom : undefined;
    const messages = (win?.results ?? [])
      .flatMap((r) => r.errors ?? [])
      .map((e) => e.message)
      .filter((m): m is string => !!m);
    // Some rejections (e.g. permission / validation on DELETE) carry the reason
    // at the winstrom level, not under results[].errors[] — e.g.
    // {"winstrom":{"success":"false","message":"K této akci nemáte přístup."}}.
    if (messages.length === 0 && typeof win?.message === 'string' && win.message) {
      messages.push(win.message);
    }
    if (messages.length > 0) return ` - ${messages.join('; ')}`;
  } catch {
    // Not JSON — return empty
  }
  return '';
}

/** Build the standard AppError for an HTTP-level rejection by ABRA Flexi. */
export function abraRejectionError(res: AbraHttpResponse, contextLabel: string): AppError {
  const detail = parseAbraErrorMessages(res.text);
  const isServerSide = res.status >= 500;
  return new AppError(
    isServerSide ? ErrorCodes.SERVICE_UNAVAILABLE : ErrorCodes.BAD_REQUEST,
    `ABRA Flexi: ${contextLabel} selhalo: ${res.status} ${res.statusText}${detail}`,
    isServerSide ? 503 : 400,
    { body: res.text.slice(0, 500) },
  );
}

/**
 * Parse and validate an ABRA Flexi write (POST/PUT) success response.
 *
 * @returns The created/updated entity id (and kod when returned)
 * @throws {AppError} When the response is not valid JSON, missing the winstrom
 *   envelope, indicates failure, or does not contain an entity id
 */
export function parseWriteResponse(
  responseText: string,
  entityLabel: string,
): { id: string; kod: string | null } {
  let json: unknown;
  try {
    json = JSON.parse(responseText);
  } catch {
    throw new AppError(ErrorCodes.INTERNAL_SERVER_ERROR, 'Odpověď z ABRA Flexi není validní JSON', 500);
  }

  const parsed = abraWriteResponseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.winstrom) {
    throw new AppError(ErrorCodes.INTERNAL_SERVER_ERROR, 'Neplatná struktura odpovědi z ABRA Flexi - chybí winstrom', 500);
  }

  const winstrom = parsed.data.winstrom;
  // success can be boolean or string ("true"/"false") — normalize so the
  // truthy string "false" never passes as success.
  const isSuccess = winstrom.success === true || winstrom.success === 'true';
  if (!isSuccess) {
    const errorMessage = winstrom.message || JSON.stringify(winstrom.results ?? winstrom);
    throw new AppError(ErrorCodes.BAD_REQUEST, `Chyba při vytváření ${entityLabel}: ${errorMessage}`, 400);
  }

  const first = winstrom.results?.[0];
  const id = first?.id !== undefined ? String(first.id) : '';
  if (!id) {
    throw new AppError(ErrorCodes.INTERNAL_SERVER_ERROR, `Nezískáno ID ${entityLabel} z odpovědi ABRA Flexi`, 500);
  }

  return { id, kod: first?.kod ?? null };
}

/**
 * GET a list endpoint and return the raw rows under the given winstrom key.
 * A 404 on a filtered URL means "no matches" → empty array.
 */
export async function abraGetList(
  cfg: AbraFlexiConfig,
  path: string,
  winstromKey: string,
): Promise<unknown[]> {
  const res = await abraRequest(cfg, { path });

  if (res.status === 404) return [];
  if (!res.ok) {
    throw abraRejectionError(res, `čtení ${winstromKey}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new AppError(ErrorCodes.INTERNAL_SERVER_ERROR, 'Odpověď z ABRA Flexi není validní JSON', 500);
  }

  const envelope = abraListEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new AppError(ErrorCodes.INTERNAL_SERVER_ERROR, 'Neplatná struktura odpovědi z ABRA Flexi - chybí winstrom', 500);
  }

  const rows = envelope.data.winstrom[winstromKey];
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) {
    throw new AppError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      `Pole '${winstromKey}' v odpovědi ABRA Flexi není seznam`,
      500,
    );
  }
  return rows;
}
