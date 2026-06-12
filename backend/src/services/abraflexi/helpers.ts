/**
 * ABRA Flexi pure helpers — URL normalization, number/date formatting,
 * code-reference handling and WQL escaping.
 *
 * Ported from Foldera V1 `services/erp/abraFlexiHelpers.ts` +
 * `abraFlexiAccountingLookup.service.ts`. These encode several gotchas:
 * - API URLs may arrive with trailing slashes or a `/v2` segment
 * - reference fields come back as "code:XYZ" strings, bare codes, or objects
 * - WQL string literals escape single quotes by doubling them
 */

import type { AbraFlexiConfig } from '../../types/contracts.js';
import { assertPublicUrl } from '../../utils/urlValidation.js';

/** ABRA Flexi entity type for received invoices. */
export const ENTITY_FAKTURA_PRIJATA = 'faktura-prijata' as const;

/**
 * Normalize an ABRA Flexi API URL by removing trailing slashes and `/v2`
 * segments, and validate it against private network ranges (SSRF guard).
 * Result shape: `https://host/c/company`.
 */
export function normalizeBaseUrl(apiUrl: string): string {
  let u = apiUrl.trim();
  if (u.endsWith('/')) u = u.slice(0, -1);
  if (u.endsWith('/v2')) u = u.slice(0, -3);
  u = u.replace('/v2/c/', '/c/');
  assertPublicUrl(u, 'ABRA Flexi');
  return u;
}

/**
 * Build the deep link into the ABRA Flexi web UI for a received invoice.
 *
 * API URL pattern:  `https://host/c/company`
 * UI URL pattern:   `https://host/flexi/company/faktura-prijata/{id}/edit`
 */
export function buildAbraWebUrl(cfg: AbraFlexiConfig, abraInvoiceId: string): string {
  const base = normalizeBaseUrl(cfg.apiUrl);
  return `${base.replace('/c/', '/flexi/')}/${ENTITY_FAKTURA_PRIJATA}/${encodeURIComponent(abraInvoiceId)}/edit`;
}

/** Format a number as a two-decimal string suitable for ABRA Flexi. Returns `'0'` for invalid input. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '0';
  return value.toFixed(2);
}

/** Round a currency amount to 2 decimal places (never `toFixed` — fails on edge cases like 1.255). */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Normalize a Czech IČO: strip non-digits and left-pad to 8 digits. */
export function normalizeIco(ico: string): string {
  return ico.replace(/\D/g, '').padStart(8, '0');
}

/** Escape a string literal for use inside a WQL filter ('' doubles single quotes). */
export function escapeWql(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Active Czech bank codes (ČNB register). Used to guard the `smerKod` reference
 * on exports: an OCR-misread code (e.g. 3830) is not in the ABRA bank číselník
 * and would make ABRA reject the whole invoice. Kept deliberately broad; an
 * unlisted-but-valid code only means the směrový kód is omitted (the account
 * number and IBAN are still kept), never a failed export.
 */
const KNOWN_CZ_BANK_CODES = new Set([
  '0100', '0300', '0600', '0710', '0800', '2010', '2020', '2060', '2070', '2100',
  '2200', '2220', '2250', '2260', '2275', '2600', '2700', '3030', '3050', '3060',
  '3500', '4000', '4300', '5500', '5800', '6000', '6100', '6200', '6210', '6300',
  '6700', '6800', '7910', '7950', '7960', '7970', '7980', '7990', '8030', '8040',
  '8060', '8090', '8150', '8190', '8198', '8199', '8200', '8215', '8220', '8225',
  '8230', '8240', '8250', '8255', '8265', '8270', '8272', '8280', '8283', '8291',
  '8293', '8294', '8296', '8298', '8299',
]);

/** True when `code` is a real Czech bank (směrový) code in the ČNB register. */
export function isKnownCzBankCode(code: string | null | undefined): boolean {
  return code != null && KNOWN_CZ_BANK_CODES.has(code.trim());
}

/** Return an ISO date (YYYY-MM-DD) or null when the input is missing/malformed. */
export function isoDateOrNull(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * Extract a bare code from an ABRA Flexi reference value.
 * Handles "code:ABC" strings, bare codes, and `{ kod: "ABC" }` objects.
 */
export function extractCode(ref: unknown): string | null {
  if (ref === null || ref === undefined || ref === '') return null;
  if (typeof ref === 'string') {
    return ref.startsWith('code:') ? ref.substring(5) : ref;
  }
  if (typeof ref === 'object' && 'kod' in ref) {
    const kod = (ref as { kod: unknown }).kod;
    return typeof kod === 'string' && kod !== '' ? kod : null;
  }
  return null;
}

/**
 * Most frequent non-null value; ties broken by first occurrence
 * (callers pass values ordered most-recent-first, so ties prefer recency).
 */
export function mostFrequent(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    // Map preserves insertion order → strictly greater keeps the earliest (most recent) on ties
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
