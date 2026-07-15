import { describe, it, expect } from 'vitest';
import type { ExtractedInvoice, AbraSupplierDefaults } from '../../types/contracts.js';
import { buildInvoicePayload, classifyVatBreakdown } from './payload.js';
import { buildAbraWebUrl, formatNumber, mostFrequent, normalizeBaseUrl, roundCurrency } from './helpers.js';

const baseInvoice: ExtractedInvoice = {
  isInvoice: true,
  documentType: 'invoice',
  supplierName: 'ACME s.r.o.',
  supplierIco: '12345678',
  supplierDic: 'CZ12345678',
  supplierAddress: 'Dlouhá 12, 110 00 Praha',
  invoiceNumber: 'FV-2026-001',
  variableSymbol: '20260001',
  constantSymbol: '0308',
  specificSymbol: '999',
  orderNumber: null,
  issueDate: '2026-06-01',
  taxDate: '2026-06-02',
  dueDate: '2026-06-15',
  totalAmount: 1210,
  totalWithoutVat: 1000,
  currency: 'CZK',
  vatBreakdown: [{ rate: 21, base: 1000, vat: 210 }],
  reverseCharge: false,
  bankAccount: '123456789',
  bankCode: '0100',
  iban: 'CZ6501000000000123456789',
  swift: 'KOMBCZPP',
  paymentMethod: 'převodem',
  lineItems: [],
  description: 'Konzultační služby',
  rawText: null,
};

const emptyDefaults: AbraSupplierDefaults = {
  documentType: null,
  predpisZauctovani: null,
  cleneniDph: null,
  stredisko: null,
  formaUhrady: null,
};

const fullDefaults: AbraSupplierDefaults = {
  documentType: 'FAKTURA',
  predpisZauctovani: 'SLUZBY',
  cleneniDph: 'P21',
  stredisko: 'CENTRALA',
  formaUhrady: 'PREVOD',
};

describe('buildInvoicePayload', () => {
  it('builds a domestic CZK invoice with recap items and applied defaults', () => {
    const payload = buildInvoicePayload(baseInvoice, fullDefaults, '12345678');
    const f = payload.winstrom['faktura-prijata'];

    // Identification — code: references, never display names
    expect(f.typDokl).toBe('code:FAKTURA');
    expect(f.firma).toBe('code:12345678');
    expect(f.cisDosle).toBe('FV-2026-001');
    expect(f.varSym).toBe('20260001');
    expect(f.specSym).toBe('999');

    // Dates
    expect(f.datVyst).toBe('2026-06-01');
    expect(f.duzpPuv).toBe('2026-06-02');
    expect(f.datSplat).toBe('2026-06-15');

    // Amounts: base sent, VAT recomputed from base × rate (recap mode)
    expect(f.sumZklZakl).toBe('1000.00');
    expect(f.sumDphZakl).toBe('210.00');
    expect(f.typObchodu).toBe('TUZEMSKO');
    expect(f.mena).toBe('code:CZK');

    // Recap line item per VAT bucket
    expect(f.bezPolozek).toBe('false');
    expect(f.polozkyFaktury).toHaveLength(1);
    expect(f.polozkyFaktury?.[0]).toMatchObject({
      mnozMj: 1,
      cenaMj: '1000.00',
      szbDph: 21,
      sumDph: '210.00',
    });

    // Defaults from supplier history
    expect(f.typUcOp).toBe('code:SLUZBY');
    expect(f.clenDph).toBe('code:P21');
    expect(f.stredisko).toBe('code:CENTRALA');
    expect(f.formaUhradyCis).toBe('code:PREVOD');

    // Bank details
    expect(f.buc).toBe('123456789');
    expect(f.smerKod).toBe('code:0100');
    expect(f.iban).toBe('CZ6501000000000123456789');

    expect(f.stat).toBe('code:CZ');
    expect(f.statDph).toBe('code:CZ');
  });

  it('omits firma and code fields when supplier/defaults are missing', () => {
    const payload = buildInvoicePayload(baseInvoice, emptyDefaults, null);
    const f = payload.winstrom['faktura-prijata'];
    expect(f.firma).toBeUndefined();
    expect(f.typDokl).toBeUndefined();
    expect(f.typUcOp).toBeUndefined();
    expect(f.stredisko).toBeUndefined();
    expect(f.formaUhradyCis).toBeUndefined();
  });

  it('uses real line items without sumDph and omits header VAT sums', () => {
    const invoice: ExtractedInvoice = {
      ...baseInvoice,
      lineItems: [
        { description: 'Služba A', quantity: 2, unit: 'ks', unitPrice: 400, total: 800, vatRate: 21 },
        { description: 'Služba B', quantity: null, unit: null, unitPrice: null, total: 200, vatRate: 12 },
      ],
    };
    const payload = buildInvoicePayload(invoice, emptyDefaults, '12345678');
    const f = payload.winstrom['faktura-prijata'];

    expect(f.polozkyFaktury).toHaveLength(2);
    expect(f.polozkyFaktury?.[0]).toEqual({ nazev: 'Služba A', mnozMj: 2, cenaMj: '400.00', szbDph: 21 });
    // null quantity → 1, unit price derived from total
    expect(f.polozkyFaktury?.[1]).toEqual({ nazev: 'Služba B', mnozMj: 1, cenaMj: '200.00', szbDph: 12 });
    // ABRA recalculates VAT from items — header sums must not be sent
    expect(f.sumDphZakl).toBeUndefined();
    expect(f.sumDphSniz).toBeUndefined();
    // Item VAT must never be sent alongside real items (400 on mismatch)
    expect(f.polozkyFaktury?.every((i) => i.sumDph === undefined)).toBe(true);
  });

  it('keeps non-standard VAT rates as recap items (never silently dropped)', () => {
    const invoice: ExtractedInvoice = {
      ...baseInvoice,
      vatBreakdown: [
        { rate: 21, base: 1000, vat: 210 },
        { rate: 10, base: 500, vat: 50 }, // historical reduced rate
      ],
    };
    const payload = buildInvoicePayload(invoice, emptyDefaults, '12345678');
    const f = payload.winstrom['faktura-prijata'];

    const rates = (f.polozkyFaktury ?? []).map((i) => i.szbDph);
    expect(rates).toContain(21);
    expect(rates).toContain(10);
    const tenPct = f.polozkyFaktury?.find((i) => i.szbDph === 10);
    expect(tenPct?.cenaMj).toBe('500.00');
    expect(tenPct?.sumDph).toBe('50.00');
    // 10% has no header slot — only the 21% base lands in sumZklZakl
    expect(f.sumZklZakl).toBe('1000.00');
    expect(f.sumZklSniz).toBeUndefined();
  });

  it('handles reverse charge (CZK): zero VAT sums, TUZEMSKO, sumCelkem = bases', () => {
    const invoice: ExtractedInvoice = {
      ...baseInvoice,
      reverseCharge: true,
      totalAmount: 1000,
      vatBreakdown: [{ rate: 21, base: 1000, vat: 0 }],
    };
    const payload = buildInvoicePayload(invoice, emptyDefaults, '12345678');
    const f = payload.winstrom['faktura-prijata'];

    expect(f.typObchodu).toBe('TUZEMSKO');
    expect(f.sumDphZakl).toBe('0');
    expect(f.sumDphSniz).toBe('0');
    expect(f.sumCelkem).toBe('1000.00');
    // PDP recap item carries no VAT
    expect(f.polozkyFaktury?.[0]?.szbDph).toBe(0);
    expect(f.polozkyFaktury?.[0]?.sumDph).toBe('0');
  });

  it('handles foreign currency via *Men fields', () => {
    const invoice: ExtractedInvoice = {
      ...baseInvoice,
      currency: 'EUR',
      totalAmount: 121,
      vatBreakdown: [{ rate: 21, base: 100, vat: 21 }],
    };
    const payload = buildInvoicePayload(invoice, emptyDefaults, '12345678');
    const f = payload.winstrom['faktura-prijata'];

    expect(f.mena).toBe('code:EUR');
    expect(f.sumZklZaklMen).toBe('100.00');
    expect(f.sumCelkemMen).toBe('121.00');
    // Domestic fields must not be set in the foreign branch
    expect(f.sumZklZakl).toBeUndefined();
    expect(f.typObchodu).toBeUndefined();
  });

  it('falls back to bezPolozek=true when there are no items and no VAT buckets', () => {
    const invoice: ExtractedInvoice = { ...baseInvoice, vatBreakdown: [], lineItems: [] };
    const payload = buildInvoicePayload(invoice, emptyDefaults, '12345678');
    const f = payload.winstrom['faktura-prijata'];
    expect(f.bezPolozek).toBe('true');
    expect(f.polozkyFaktury).toBeUndefined();
  });

  // ABRA rejects a faktura-prijata without datSplat, so a date it cannot parse
  // must fall back rather than be dropped — an export that books beats an export
  // that fails on a date the document only stated in Czech format.
  it('falls back duzpPuv and datSplat to the issue date when the dates are missing or malformed', () => {
    const invoice: ExtractedInvoice = { ...baseInvoice, taxDate: null, dueDate: '15.06.2026' };
    const f = buildInvoicePayload(invoice, emptyDefaults, null).winstrom['faktura-prijata'];
    expect(f.duzpPuv).toBe('2026-06-01');
    expect(f.datSplat).toBe('2026-06-01');
  });
});

describe('classifyVatBreakdown', () => {
  it('routes buckets to standard/reduced/zero and collects non-standard rates', () => {
    const totals = classifyVatBreakdown([
      { rate: 21, base: 100, vat: 21 },
      { rate: 21, base: 50, vat: 10.5 },
      { rate: 12, base: 200, vat: 24 },
      { rate: 0, base: 30, vat: 0 },
      { rate: 15, base: 40, vat: 6 },
    ]);
    expect(totals.baseStandard).toBe(150);
    expect(totals.vatStandard).toBe(31.5);
    expect(totals.baseReduced).toBe(200);
    expect(totals.baseZero).toBe(30);
    expect(totals.otherBuckets).toEqual([{ rate: 15, base: 40, vat: 6 }]);
  });
});

describe('helpers', () => {
  it('roundCurrency uses Math.round(v*100)/100', () => {
    expect(roundCurrency(1.234)).toBe(1.23);
    expect(roundCurrency(1.235)).toBe(1.24); // 1.235*100 = 123.50000000000001 → 124
    expect(roundCurrency(210.0000001)).toBe(210);
  });

  it('formatNumber renders 2 decimals and 0 for invalid input', () => {
    expect(formatNumber(1234.5)).toBe('1234.50');
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('0');
  });

  it('normalizeBaseUrl strips trailing slash and /v2 and blocks private hosts', () => {
    expect(normalizeBaseUrl('https://demo.flexibee.eu/c/demo/')).toBe('https://demo.flexibee.eu/c/demo');
    expect(normalizeBaseUrl('https://demo.flexibee.eu/v2/c/demo')).toBe('https://demo.flexibee.eu/c/demo');
    expect(() => normalizeBaseUrl('http://127.0.0.1/c/demo')).toThrow(/SSRF/);
    expect(() => normalizeBaseUrl('http://192.168.1.5/c/demo')).toThrow(/SSRF/);
  });

  it('normalizeBaseUrl rewrites a pasted web-UI /flexi/ URL to the REST /c/ URL', () => {
    expect(normalizeBaseUrl('https://digiapp.flexibee.eu/flexi/adam_test')).toBe(
      'https://digiapp.flexibee.eu/c/adam_test',
    );
    expect(normalizeBaseUrl('https://digiapp.flexibee.eu/flexi/adam_test/')).toBe(
      'https://digiapp.flexibee.eu/c/adam_test',
    );
    // deep link pasted from the browser → base REST URL
    expect(normalizeBaseUrl('https://digiapp.flexibee.eu/flexi/adam_test/faktura-prijata/42/edit')).toBe(
      'https://digiapp.flexibee.eu/c/adam_test',
    );
  });

  it('buildAbraWebUrl builds the /flexi/ deep link', () => {
    const cfg = { apiUrl: 'https://demo.flexibee.eu/c/demo', apiUser: 'u', apiPassword: 'p', companyId: 'c1' };
    expect(buildAbraWebUrl(cfg, '42')).toBe('https://demo.flexibee.eu/flexi/demo/faktura-prijata/42/edit');
  });

  it('mostFrequent picks the modal value, ties broken by recency (first occurrence)', () => {
    expect(mostFrequent(['A', 'B', 'B', null, 'A', 'A'])).toBe('A');
    expect(mostFrequent(['NEW', 'OLD'])).toBe('NEW');
    expect(mostFrequent([null, null])).toBeNull();
  });
});
