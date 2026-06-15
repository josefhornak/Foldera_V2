/**
 * Connection test for ABRA Flexi.
 *
 * GET {base}.json (the company resource) verifies host reachability,
 * credentials and company identifier in a single call. The endpoint must
 * return JSON — an HTML body (login page / proxy error) is treated as failure.
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { toError } from '../../utils/errors.js';
import type { AbraConnectionTestResult, AbraFlexiConfig } from '../../types/contracts.js';
import { abraRequest } from './client.js';

/** `/c/{company}.json` returns `{"company": {..., "nazev": "..."}}` (no winstrom envelope). */
const companyResponseSchema = z.object({
  company: z
    .object({
      nazev: z.string().optional(),
      dbNazev: z.string().optional(),
    })
    .optional(),
  winstrom: z
    .object({
      company: z
        .array(z.object({ nazev: z.string().optional() }))
        .optional(),
    })
    .optional(),
});

/**
 * Test the ABRA Flexi connection. Never throws — all failures are reported as
 * `{ ok: false, error }` so the caller can surface them to the user.
 */
export async function testAbraConnection(cfg: AbraFlexiConfig): Promise<AbraConnectionTestResult> {
  try {
    const res = await abraRequest(cfg, { path: '.json', timeoutMs: 15_000 });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Neplatné přihlašovací údaje k ABRA Flexi' };
    }
    if (res.status === 404) {
      return { ok: false, error: 'Firma (company) v ABRA Flexi nebyla nalezena - zkontrolujte URL' };
    }
    if (!res.ok) {
      return { ok: false, error: `ABRA Flexi vrátila chybu ${res.status} ${res.statusText}` };
    }

    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      // HTML login page or proxy error masquerading as 200
      return { ok: false, error: 'ABRA Flexi nevrátila platnou JSON odpověď - zkontrolujte URL' };
    }

    const parsed = companyResponseSchema.safeParse(json);
    const companyName = parsed.success
      ? (parsed.data.company?.nazev ??
        parsed.data.winstrom?.company?.[0]?.nazev ??
        parsed.data.company?.dbNazev)
      : undefined;

    logger.info({ companyId: cfg.companyId, companyName }, '[AbraFlexi] Connection test OK');
    return companyName ? { ok: true, companyName } : { ok: true };
  } catch (error: unknown) {
    const message = toError(error).message;
    logger.warn({ companyId: cfg.companyId, error: message }, '[AbraFlexi] Connection test failed');
    return { ok: false, error: message };
  }
}
