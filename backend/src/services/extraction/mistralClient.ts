/**
 * Thin fetch-based Mistral AI client.
 *
 * Ported API call patterns from Foldera v1 (services/mistral/ocr.ts):
 * - `/v1/ocr` with `mistral-ocr-latest` — document/image as base64 data URL
 * - `/v1/chat/completions` with `mistral-small-latest` — structured JSON extraction
 * - JSON-from-model-response parsing (handles ```json fences)
 * - Retry with exponential backoff on 429 / 5xx / network errors
 */

import env from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export const OCR_MODEL = 'mistral-ocr-latest';
export const EXTRACTION_MODEL = 'mistral-small-latest';

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
const OCR_TIMEOUT_MS = 120_000;
const CHAT_TIMEOUT_MS = 90_000;

export interface MistralConfig {
  apiKey: string;
  baseUrl: string;
}

/** Returns null when MISTRAL_API_KEY is not configured. */
export function getMistralConfig(): MistralConfig | null {
  const apiKey = env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  return { apiKey, baseUrl: env.MISTRAL_API_URL.replace(/\/+$/, '') };
}

export class MistralApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MistralApiError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof MistralApiError) {
    return error.status === 429 || error.status >= 500;
  }
  // Network failures / timeouts (TypeError, AbortError, ...) are retryable.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postJson(
  config: MistralConfig,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new MistralApiError(
          `Mistral ${path} failed: HTTP ${response.status} ${text.slice(0, 200)}`,
          response.status,
        );
      }

      return (await response.json()) as unknown;
    } catch (error: unknown) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const delayMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
        logger.warn(
          { path, attempt: attempt + 1, delayMs, error: message },
          '[Extraction] Mistral request failed, retrying',
        );
        await sleep(delayMs);
        continue;
      }

      throw error;
    }
  }

  // Unreachable, but keeps TypeScript happy without non-null assertions.
  throw lastError instanceof Error ? lastError : new Error('Mistral request failed');
}

/**
 * Run OCR on a document (PDF or image) provided as a base64 data URL.
 * Returns the markdown text of all pages joined with page separators.
 */
export async function ocrDocument(
  config: MistralConfig,
  dataUrl: string,
  kind: 'pdf' | 'image',
): Promise<string> {
  const document =
    kind === 'pdf'
      ? { type: 'document_url', document_url: dataUrl }
      : { type: 'image_url', image_url: dataUrl };

  const data = await postJson(
    config,
    '/v1/ocr',
    { model: OCR_MODEL, document, include_image_base64: false },
    OCR_TIMEOUT_MS,
  );

  if (!isRecord(data) || !Array.isArray(data.pages)) {
    throw new Error('Mistral OCR returned an unexpected response shape');
  }

  const markdown = data.pages
    .map(page => (isRecord(page) && typeof page.markdown === 'string' ? page.markdown : ''))
    .filter(text => text.trim().length > 0)
    .join('\n\n---\n\n');

  return markdown;
}

/**
 * Run a structured-extraction chat completion and return the parsed JSON object.
 * Uses `response_format: json_object` with low temperature, like v1.
 */
export async function chatCompleteJson(
  config: MistralConfig,
  prompt: string,
  documentText: string,
): Promise<Record<string, unknown>> {
  const data = await postJson(
    config,
    '/v1/chat/completions',
    {
      model: EXTRACTION_MODEL,
      messages: [{ role: 'user', content: `${prompt}\n\nDokument:\n${documentText}` }],
      temperature: 0.1,
      // Multi-page invoices with 20+ line items need room (ported from v1).
      max_tokens: 16384,
      response_format: { type: 'json_object' },
    },
    CHAT_TIMEOUT_MS,
  );

  if (!isRecord(data) || !Array.isArray(data.choices)) {
    throw new Error('Mistral chat returned an unexpected response shape');
  }

  const first = data.choices[0];
  const message = isRecord(first) ? first.message : undefined;
  const content = isRecord(message) ? message.content : undefined;

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Mistral chat returned empty content');
  }

  return parseJsonResponse(content);
}

/**
 * Parse JSON from a model response, tolerating ```json fences (ported from v1).
 */
export function parseJsonResponse(content: string): Record<string, unknown> {
  try {
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    const jsonStr = jsonMatch?.[1] ?? content;
    const parsed: unknown = JSON.parse(jsonStr);
    if (!isRecord(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new Error(`Failed to parse model response as JSON: ${content.slice(0, 200)}`);
  }
}
