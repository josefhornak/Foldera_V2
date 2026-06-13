/**
 * ARES lookup (Czech public business register) for signup autofill.
 * https://ares.gov.cz — REST v3 economic-subjects endpoint.
 */
import { logger } from '../utils/logger.js';
import { toError } from '../utils/errors.js';

const ARES_BASE = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
const TIMEOUT_MS = 8000;

export interface AresCompany {
  ico: string;
  name: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  fullAddress: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Look up a company by IČO. Returns null when not found or on any error. */
export async function lookupAres(icoRaw: string): Promise<AresCompany | null> {
  const ico = icoRaw.replace(/\D/g, '');
  if (!/^\d{1,8}$/.test(ico)) return null;
  const padded = ico.padStart(8, '0');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ARES_BASE}/${padded}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const sidlo = (data.sidlo ?? {}) as Record<string, unknown>;
    const zipRaw = sidlo.psc;
    return {
      ico: padded,
      name: asString(data.obchodniJmeno),
      dic: asString(data.dic),
      street:
        asString(sidlo.nazevUlice) ??
        (asString(sidlo.textovaAdresa)?.split(',')[0] ?? null),
      city: asString(sidlo.nazevObce),
      zip: zipRaw != null ? String(zipRaw).replace(/\s/g, '') : null,
      fullAddress: asString(sidlo.textovaAdresa),
    };
  } catch (error) {
    logger.warn({ ico: padded, error: toError(error).message }, '[ARES] Lookup failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
