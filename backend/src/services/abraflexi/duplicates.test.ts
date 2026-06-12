import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AbraFlexiConfig } from '../../types/contracts.js';
import { pickDuplicate, findDuplicateInvoice } from './duplicates.js';
import { harvestDefaultsFromRows } from './suppliers.js';
import type { AbraInvoiceRow } from './types.js';

const cfg: AbraFlexiConfig = {
  apiUrl: 'https://demo.flexibee.eu/c/demo',
  apiUser: 'user',
  apiPassword: 'pass',
  companyId: 'cmp_1',
};

const row = (overrides: Partial<AbraInvoiceRow>): AbraInvoiceRow => ({
  id: 1,
  kod: 'FAP-2026/0001',
  cisDosle: 'FV-001',
  varSym: '20260001',
  ic: '12345678',
  datVyst: '2026-01-10',
  ...overrides,
});

describe('pickDuplicate', () => {
  it('matches on same IČO + same varSym', () => {
    const result = pickDuplicate([row({})], {
      supplierIco: '12345678',
      variableSymbol: '20260001',
      invoiceNumber: null,
    });
    expect(result).toEqual({ id: '1', code: 'FAP-2026/0001' });
  });

  it('matches on same IČO + same cisDosle (case-insensitive)', () => {
    const result = pickDuplicate([row({ varSym: 'other' })], {
      supplierIco: '12345678',
      variableSymbol: null,
      invoiceNumber: 'fv-001',
    });
    expect(result).toEqual({ id: '1', code: 'FAP-2026/0001' });
  });

  it('requires the IČO to match — varSym alone is not a duplicate', () => {
    const result = pickDuplicate([row({ ic: '87654321' })], {
      supplierIco: '12345678',
      variableSymbol: '20260001',
      invoiceNumber: 'FV-001',
    });
    expect(result).toBeNull();
  });

  it('normalizes IČO before comparing (padding, separators)', () => {
    const result = pickDuplicate([row({ ic: '00345678' })], {
      supplierIco: '345678', // unpadded
      variableSymbol: '20260001',
      invoiceNumber: null,
    });
    expect(result).toEqual({ id: '1', code: 'FAP-2026/0001' });
  });

  it('returns null without an IČO or without any document number', () => {
    expect(
      pickDuplicate([row({})], { supplierIco: null, variableSymbol: '20260001', invoiceNumber: 'FV-001' }),
    ).toBeNull();
    expect(
      pickDuplicate([row({})], { supplierIco: '12345678', variableSymbol: null, invoiceNumber: null }),
    ).toBeNull();
  });

  it('skips cancelled (storno) documents', () => {
    const result = pickDuplicate([row({ storno: true }), row({ id: 2, storno: 'false' })], {
      supplierIco: '12345678',
      variableSymbol: '20260001',
      invoiceNumber: null,
    });
    expect(result?.id).toBe('2');
  });
});

describe('findDuplicateInvoice (mocked fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const winstromList = (rows: unknown[]): Response =>
    new Response(JSON.stringify({ winstrom: { 'faktura-prijata': rows } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it('filters server-side by varSym/cisDosle and verifies IČO client-side', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.includes(encodeURIComponent("varSym eq '20260001'"))) {
          // Server returns a same-varSym doc from a DIFFERENT supplier → not a duplicate
          return winstromList([row({ id: 7, ic: '99999999' })]);
        }
        if (url.includes(encodeURIComponent("cisDosle eq 'FV-001'"))) {
          return winstromList([row({ id: 8, varSym: 'jiný' })]);
        }
        return winstromList([]);
      }),
    );

    const result = await findDuplicateInvoice(cfg, {
      supplierIco: '12345678',
      variableSymbol: '20260001',
      invoiceNumber: 'FV-001',
    });

    expect(result).toEqual({ id: '8', code: 'FAP-2026/0001' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/faktura-prijata/(');
    expect(calls[0]).toContain('detail=full');
  });

  it('returns null when nothing matches and short-circuits without IČO', async () => {
    const fetchMock = vi.fn(async () => winstromList([]));
    vi.stubGlobal('fetch', fetchMock);

    expect(
      await findDuplicateInvoice(cfg, { supplierIco: '12345678', variableSymbol: '111', invoiceNumber: null }),
    ).toBeNull();

    // No IČO → no network call at all
    fetchMock.mockClear();
    expect(
      await findDuplicateInvoice(cfg, { supplierIco: null, variableSymbol: '111', invoiceNumber: 'X' }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a 404 on the filtered URL as "no matches"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    expect(
      await findDuplicateInvoice(cfg, { supplierIco: '12345678', variableSymbol: '111', invoiceNumber: null }),
    ).toBeNull();
  });
});

describe('harvestDefaultsFromRows', () => {
  it('takes the most frequent codes, sorted most-recent-first, decoding code: refs', () => {
    const rows: AbraInvoiceRow[] = [
      row({ datVyst: '2026-01-01', typDokl: 'code:FAKTURA', typUcOp: 'code:SLUZBY', clenDph: 'P21', stredisko: { kod: 'BRNO' }, formaUhradyCis: 'code:PREVOD' }),
      row({ datVyst: '2026-03-01', typDokl: 'code:FAKTURA', typUcOp: 'code:ZBOZI', clenDph: 'P21', stredisko: 'code:PRAHA', formaUhradyCis: 'code:PREVOD' }),
      row({ datVyst: '2026-02-01', typDokl: 'code:FAKTURA', typUcOp: 'code:SLUZBY', clenDph: 'P21', stredisko: 'code:PRAHA', formaUhradyCis: undefined }),
    ];
    expect(harvestDefaultsFromRows(rows)).toEqual({
      documentType: 'FAKTURA',
      predpisZauctovani: 'SLUZBY',
      cleneniDph: 'P21',
      cleneniKonVykDph: null,
      stredisko: 'PRAHA',
      formaUhrady: 'PREVOD',
    });
  });

  it('breaks frequency ties in favour of the most recent invoice', () => {
    const rows: AbraInvoiceRow[] = [
      row({ datVyst: '2026-01-01', typUcOp: 'code:OLD' }),
      row({ datVyst: '2026-05-01', typUcOp: 'code:NEW' }),
    ];
    expect(harvestDefaultsFromRows(rows).predpisZauctovani).toBe('NEW');
  });

  it('returns nulls for missing fields', () => {
    expect(harvestDefaultsFromRows([])).toEqual({
      documentType: null,
      predpisZauctovani: null,
      cleneniDph: null,
      cleneniKonVykDph: null,
      stredisko: null,
      formaUhrady: null,
    });
  });
});
