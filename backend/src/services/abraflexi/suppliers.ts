/**
 * Supplier (adresar) operations: lookup by IČO, auto-create, bank account,
 * and harvesting per-supplier defaults from previous received invoices.
 *
 * WQL gotcha (from V1): complex server-side filters are unreliable in ABRA
 * Flexi — keep filters simple (single equality) and do sorting/aggregation
 * client-side.
 */

import { logger } from '../../utils/logger.js';
import type {
  AbraFlexiConfig,
  AbraSupplierDefaults,
  AbraSupplierMatch,
  ExtractedInvoice,
} from '../../types/contracts.js';
import { abraGetList, abraRequest, abraRejectionError, parseWriteResponse } from './client.js';
import {
  ENTITY_FAKTURA_PRIJATA,
  escapeWql,
  extractCode,
  mostFrequent,
  normalizeIco,
} from './helpers.js';
import { abraAdresarRowSchema, abraInvoiceRowSchema, type AbraInvoiceRow } from './types.js';

/**
 * Find a supplier in the ABRA Flexi address book by IČO.
 * Returns null when not found. The IČO match is re-verified client-side.
 */
export async function findSupplierByIco(
  cfg: AbraFlexiConfig,
  ico: string,
): Promise<AbraSupplierMatch | null> {
  const normalizedIco = normalizeIco(ico);
  if (!/^\d{8}$/.test(normalizedIco)) {
    logger.warn({ companyId: cfg.companyId, ico }, '[AbraFlexi] Invalid IČO — skipping supplier lookup');
    return null;
  }

  const filter = encodeURIComponent(`ic eq '${escapeWql(normalizedIco)}'`);
  const rows = await abraGetList(cfg, `/adresar/(${filter}).json?detail=full&limit=10`, 'adresar');

  for (const raw of rows) {
    const parsed = abraAdresarRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data;
    // Client-side verification — WQL filters can be unreliable
    if (row.ic && normalizeIco(row.ic) !== normalizedIco) continue;
    if (!row.kod) continue;
    return {
      code: row.kod,
      name: row.nazev ?? row.kod,
      ico: row.ic ?? normalizedIco,
    };
  }

  return null;
}

/**
 * Naive split of a single-line address ("Ulice 12, 110 00 Praha") into
 * street / zip / city for the adresar entry. Unparseable input lands in `ulice`.
 */
function splitAddress(address: string): { street?: string; city?: string; zip?: string } {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts[0];
  const rest = parts.slice(1).join(', ');
  const zipCityMatch = rest.match(/(\d{3}\s?\d{2})\s+(.+)/);
  if (zipCityMatch) {
    return { street, zip: zipCityMatch[1]?.replace(/\s/g, ''), city: zipCityMatch[2] };
  }
  return { street: parts.length > 1 ? street : address, city: rest || undefined };
}

/**
 * Create a new supplier in the ABRA Flexi address book.
 * When the IČO is known it is used as the explicit `kod` so the code can be
 * referenced immediately; the authoritative value is still read back from the
 * response.
 *
 * @throws {AppError} on failure — caller decides whether to abort the export
 */
export async function createSupplierInAbra(
  cfg: AbraFlexiConfig,
  invoice: ExtractedInvoice,
): Promise<AbraSupplierMatch> {
  const name = invoice.supplierName?.trim() || 'Neznámý dodavatel';
  const normalizedIc = invoice.supplierIco ? normalizeIco(invoice.supplierIco) : undefined;

  const adresar: Record<string, unknown> = {
    nazev: name,
    stat: 'code:CZ',
    typVztahuK: 'typVztahu.dodavatel',
  };
  if (normalizedIc) {
    adresar.ic = normalizedIc;
    // Use IČO as the AbraFlexi code so we know it upfront
    adresar.kod = normalizedIc;
  }
  if (invoice.supplierDic) adresar.dic = invoice.supplierDic.replace(/\s/g, '');
  if (invoice.supplierAddress) {
    const { street, city, zip } = splitAddress(invoice.supplierAddress);
    if (street) adresar.ulice = street;
    if (city) adresar.mesto = city;
    if (zip) adresar.psc = zip;
  }

  logger.info(
    { companyId: cfg.companyId, name, ic: normalizedIc },
    '[AbraFlexi] Creating new supplier in address book',
  );

  const res = await abraRequest(cfg, {
    path: '/adresar.json',
    method: 'POST',
    body: JSON.stringify({ winstrom: { adresar } }),
  });

  if (!res.ok) {
    throw abraRejectionError(res, 'vytvoření dodavatele');
  }

  const { id, kod } = parseWriteResponse(res.text, 'dodavatele');
  const code = kod ?? normalizedIc ?? id;

  logger.info({ companyId: cfg.companyId, supplierCode: code, supplierId: id }, '[AbraFlexi] Supplier created');

  return { code, name, ico: normalizedIc ?? null };
}

/**
 * Attach a bank account to an existing adresar entry.
 * Non-critical — logs a warning on failure but never throws, so a missing
 * bank account never blocks the invoice export.
 */
export async function addBankAccountToSupplier(
  cfg: AbraFlexiConfig,
  supplierCode: string,
  invoice: ExtractedInvoice,
): Promise<void> {
  if (!invoice.bankAccount || !invoice.bankCode) return;

  const ucet: Record<string, unknown> = {
    firma: `code:${supplierCode}`,
    buc: invoice.bankAccount,
    smerKod: `code:${invoice.bankCode}`,
  };
  if (invoice.iban) ucet.iban = invoice.iban;

  try {
    const res = await abraRequest(cfg, {
      path: '/adresar-bankovni-ucet.json',
      method: 'POST',
      body: JSON.stringify({ winstrom: { 'adresar-bankovni-ucet': ucet } }),
    });

    if (!res.ok) {
      logger.warn(
        { companyId: cfg.companyId, supplierCode, status: res.status, body: res.text.slice(0, 500) },
        '[AbraFlexi] Failed to add bank account to supplier (non-critical)',
      );
      return;
    }

    logger.info({ companyId: cfg.companyId, supplierCode }, '[AbraFlexi] Bank account added to supplier');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { companyId: cfg.companyId, supplierCode, error: message },
      '[AbraFlexi] Failed to add bank account to supplier (non-critical)',
    );
  }
}

// ---------------------------------------------------------------------------
// Supplier defaults harvesting ("koukání na předchozí doklady")
// ---------------------------------------------------------------------------

const EMPTY_DEFAULTS: AbraSupplierDefaults = {
  documentType: null,
  predpisZauctovani: null,
  cleneniDph: null,
  stredisko: null,
  formaUhrady: null,
};

/** Parse, sort (datVyst desc) and aggregate the most frequent codes from invoice rows. Pure — unit-testable. */
export function harvestDefaultsFromRows(rows: AbraInvoiceRow[]): AbraSupplierDefaults {
  const sorted = [...rows].sort((a, b) => (b.datVyst ?? '').localeCompare(a.datVyst ?? ''));

  return {
    documentType: mostFrequent(sorted.map((r) => extractCode(r.typDokl))),
    predpisZauctovani: mostFrequent(sorted.map((r) => extractCode(r.typUcOp))),
    cleneniDph: mostFrequent(sorted.map((r) => extractCode(r.clenDph))),
    stredisko: mostFrequent(sorted.map((r) => extractCode(r.stredisko))),
    formaUhrady: mostFrequent(sorted.map((r) => extractCode(r.formaUhradyCis))),
  };
}

/**
 * Harvest defaults from the supplier's most recent received invoices in ABRA
 * Flexi: most frequent typ dokladu, předpis zaúčtování (typUcOp), členění DPH,
 * středisko and forma úhrady. Missing values → nulls.
 *
 * Simple server-side filter (firma equality), sorting client-side by datVyst
 * — WQL ordering/complex filters are unreliable.
 */
export async function getSupplierDefaults(
  cfg: AbraFlexiConfig,
  supplierCode: string,
): Promise<AbraSupplierDefaults> {
  if (!supplierCode) return { ...EMPTY_DEFAULTS };

  const filter = encodeURIComponent(`firma eq 'code:${escapeWql(supplierCode)}'`);
  let rawRows: unknown[];
  try {
    rawRows = await abraGetList(
      cfg,
      `/${ENTITY_FAKTURA_PRIJATA}/(${filter}).json?detail=full&limit=10`,
      ENTITY_FAKTURA_PRIJATA,
    );
  } catch (error: unknown) {
    // Defaults are best-effort — never block the export pipeline on them
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { companyId: cfg.companyId, supplierCode, error: message },
      '[AbraFlexi] Failed to load supplier history — using empty defaults',
    );
    return { ...EMPTY_DEFAULTS };
  }

  const rows: AbraInvoiceRow[] = [];
  for (const raw of rawRows) {
    const parsed = abraInvoiceRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    // Skip cancelled documents client-side
    if (parsed.data.storno === true || parsed.data.storno === 'true') continue;
    rows.push(parsed.data);
  }

  const defaults = harvestDefaultsFromRows(rows);
  logger.info(
    { companyId: cfg.companyId, supplierCode, invoicesFound: rows.length, defaults },
    '[AbraFlexi] Supplier defaults harvested',
  );
  return defaults;
}
