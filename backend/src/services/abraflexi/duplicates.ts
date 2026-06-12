/**
 * Duplicate invoice detection.
 *
 * A document already in ABRA Flexi is a duplicate of the incoming invoice when
 * it has the SAME supplier IČO AND (the same variable symbol OR the same
 * received invoice number / cisDosle).
 *
 * Strategy (per V1 gotchas): filter server-side only on the simple, reliable
 * equality (varSym / cisDosle) and verify the supplier IČO client-side —
 * combined WQL filters are unreliable for some queries.
 */

import { logger } from '../../utils/logger.js';
import type { AbraDuplicateQuery, AbraFlexiConfig } from '../../types/contracts.js';
import { abraGetList } from './client.js';
import { ENTITY_FAKTURA_PRIJATA, escapeWql, normalizeIco } from './helpers.js';
import { abraInvoiceRowSchema, type AbraInvoiceRow } from './types.js';

/**
 * Client-side duplicate matching over candidate rows (pure, unit-testable).
 * Returns the first non-cancelled row whose IČO matches and whose varSym or
 * cisDosle matches the query.
 */
export function pickDuplicate(
  rows: AbraInvoiceRow[],
  query: AbraDuplicateQuery,
): { id: string; code: string } | null {
  if (!query.supplierIco) return null;
  const wantedIco = normalizeIco(query.supplierIco);
  const wantedVarSym = query.variableSymbol?.trim() || null;
  const wantedNumber = query.invoiceNumber?.trim().toLowerCase() || null;
  if (!wantedVarSym && !wantedNumber) return null;

  for (const row of rows) {
    if (row.storno === true || row.storno === 'true') continue;
    if (!row.ic || normalizeIco(row.ic) !== wantedIco) continue;

    const varSymMatches = !!wantedVarSym && row.varSym?.trim() === wantedVarSym;
    const numberMatches =
      !!wantedNumber && row.cisDosle?.trim().toLowerCase() === wantedNumber;

    if (varSymMatches || numberMatches) {
      const id = row.id !== undefined ? String(row.id) : '';
      if (!id) continue;
      return { id, code: row.kod ?? id };
    }
  }

  return null;
}

async function fetchCandidates(
  cfg: AbraFlexiConfig,
  field: 'varSym' | 'cisDosle',
  value: string,
): Promise<AbraInvoiceRow[]> {
  const filter = encodeURIComponent(`${field} eq '${escapeWql(value)}'`);
  const raw = await abraGetList(
    cfg,
    `/${ENTITY_FAKTURA_PRIJATA}/(${filter}).json?detail=full&limit=50`,
    ENTITY_FAKTURA_PRIJATA,
  );

  const rows: AbraInvoiceRow[] = [];
  for (const item of raw) {
    const parsed = abraInvoiceRowSchema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/**
 * Check whether the invoice already exists in ABRA Flexi.
 * Returns the existing document's id + code, or null when no duplicate found
 * (including when the query lacks an IČO or any document number to match on).
 */
export async function findDuplicateInvoice(
  cfg: AbraFlexiConfig,
  query: AbraDuplicateQuery,
): Promise<{ id: string; code: string } | null> {
  if (!query.supplierIco || (!query.variableSymbol && !query.invoiceNumber)) {
    return null;
  }

  const candidates: AbraInvoiceRow[] = [];
  const seenIds = new Set<string>();

  const collect = (rows: AbraInvoiceRow[]): void => {
    for (const row of rows) {
      const id = row.id !== undefined ? String(row.id) : `${row.kod ?? ''}|${row.varSym ?? ''}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      candidates.push(row);
    }
  };

  if (query.variableSymbol?.trim()) {
    collect(await fetchCandidates(cfg, 'varSym', query.variableSymbol.trim()));
  }
  if (query.invoiceNumber?.trim()) {
    collect(await fetchCandidates(cfg, 'cisDosle', query.invoiceNumber.trim()));
  }

  const duplicate = pickDuplicate(candidates, query);
  if (duplicate) {
    logger.info(
      { companyId: cfg.companyId, duplicateId: duplicate.id, duplicateCode: duplicate.code },
      '[AbraFlexi] Duplicate invoice found',
    );
  }
  return duplicate;
}
