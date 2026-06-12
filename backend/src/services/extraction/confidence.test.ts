import { describe, expect, it } from 'vitest';
import {
  isValidIco,
  isIsoDate,
  isTotalConsistent,
  round2,
  scoreIsdocConfidence,
  scoreOcrConfidence,
} from './confidence.js';
import { emptyInvoice, mapModelOutputToInvoice } from './mapping.js';
import type { ExtractedInvoice } from '../../types/contracts.js';

function fullInvoice(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    ...emptyInvoice(),
    isInvoice: true,
    documentType: 'invoice',
    supplierName: 'ABC Software s.r.o.',
    supplierIco: '12345679', // valid mod-11 checksum
    supplierDic: 'CZ12345679',
    invoiceNumber: 'FV2024/0156',
    variableSymbol: '20240156',
    issueDate: '2024-01-15',
    dueDate: '2024-01-29',
    taxDate: '2024-01-15',
    totalAmount: 78650,
    totalWithoutVat: 65000,
    currency: 'CZK',
    vatBreakdown: [{ rate: 21, base: 65000, vat: 13650 }],
    bankAccount: '2536670204',
    bankCode: '2600',
    ...overrides,
  };
}

describe('round2', () => {
  it('rounds financial values via Math.round(v*100)/100', () => {
    expect(round2(1.226)).toBe(1.23);
    expect(round2(1.224)).toBe(1.22);
    expect(round2(78650.004)).toBe(78650);
  });
});

describe('isValidIco', () => {
  it('accepts a valid 8-digit IČO with correct checksum', () => {
    expect(isValidIco('12345679')).toBe(true);
    expect(isValidIco('00006947')).toBe(true);
  });

  it('rejects invalid checksums, wrong lengths and null', () => {
    expect(isValidIco('12345678')).toBe(false);
    expect(isValidIco('1234567')).toBe(false);
    expect(isValidIco('123456789')).toBe(false);
    expect(isValidIco('abcdefgh')).toBe(false);
    expect(isValidIco(null)).toBe(false);
  });
});

describe('isIsoDate', () => {
  it('accepts valid ISO dates and rejects malformed or impossible ones', () => {
    expect(isIsoDate('2024-01-15')).toBe(true);
    expect(isIsoDate('2024-02-30')).toBe(false);
    expect(isIsoDate('15.01.2024')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('isTotalConsistent', () => {
  it('passes when VAT buckets sum to the total within tolerance', () => {
    expect(isTotalConsistent(fullInvoice())).toBe(true);
    expect(isTotalConsistent(fullInvoice({ totalAmount: 78650.5 }))).toBe(true);
  });

  it('fails when buckets disagree with the total', () => {
    expect(isTotalConsistent(fullInvoice({ totalAmount: 80000 }))).toBe(false);
  });

  it('handles reverse-charge invoices without VAT breakdown', () => {
    const reverseChargeInvoice = fullInvoice({
      vatBreakdown: [],
      reverseCharge: true,
      totalAmount: 450000,
      totalWithoutVat: 450000,
    });
    expect(isTotalConsistent(reverseChargeInvoice)).toBe(true);
  });

  it('fails when total is missing or unverifiable', () => {
    expect(isTotalConsistent(fullInvoice({ totalAmount: null }))).toBe(false);
    expect(isTotalConsistent(fullInvoice({ vatBreakdown: [], reverseCharge: false }))).toBe(false);
  });
});

describe('scoreOcrConfidence', () => {
  it('scores a complete, consistent invoice high', () => {
    expect(scoreOcrConfidence(fullInvoice())).toBeGreaterThanOrEqual(90);
  });

  it('scores an empty extraction at 0', () => {
    expect(scoreOcrConfidence(emptyInvoice())).toBe(0);
  });

  it('penalizes invalid IČO and inconsistent totals', () => {
    const full = scoreOcrConfidence(fullInvoice());
    const badIco = scoreOcrConfidence(fullInvoice({ supplierIco: '12345678' }));
    const badTotal = scoreOcrConfidence(fullInvoice({ totalAmount: 99999 }));
    expect(badIco).toBeLessThan(full);
    expect(badTotal).toBeLessThan(full);
  });

  it('blends in model-reported confidence when provided', () => {
    const withoutModel = scoreOcrConfidence(fullInvoice());
    const withLowModel = scoreOcrConfidence(fullInvoice(), 0.1);
    const withHighModel = scoreOcrConfidence(fullInvoice(), 1);
    expect(withLowModel).toBeLessThan(withoutModel);
    expect(withHighModel).toBeGreaterThanOrEqual(withoutModel);
    expect(withHighModel).toBeLessThanOrEqual(100);
  });

  it('stays within 0–100', () => {
    expect(scoreOcrConfidence(fullInvoice(), 1)).toBeLessThanOrEqual(100);
    expect(scoreOcrConfidence(emptyInvoice(), 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreIsdocConfidence', () => {
  it('always scores ISDOC ground truth at 95+', () => {
    expect(scoreIsdocConfidence(emptyInvoice())).toBeGreaterThanOrEqual(95);
  });

  it('caps at 100 for fully verifiable invoices', () => {
    expect(scoreIsdocConfidence(fullInvoice())).toBe(100);
  });
});

describe('mapModelOutputToInvoice (OCR model output → contract)', () => {
  it('maps snake_case model JSON onto ExtractedInvoice', () => {
    const invoice = mapModelOutputToInvoice(
      {
        document_type: 'invoice',
        is_invoice: true,
        classification_confidence: 0.95,
        vendor_name: 'ABC Software s.r.o.',
        vendor_ic: '123 45 679',
        vendor_dic: 'CZ 12345679',
        vendor_bank_account: '2536670204/2600',
        invoice_number: 'FV2024/0156',
        variable_symbol: 'VS 20240156',
        invoice_date: '15.01.2024',
        due_date: '2024-01-29',
        total_amount: '78 650,00',
        subtotal: 65000,
        currency: 'czk',
        vat_breakdown: [{ rate: 21, base: 65000, vat: 13650 }],
        is_reverse_charge: null,
        line_items: [
          { description: 'Roční licence SW', quantity: 1, unit: 'ks', unit_price: 45000, vat_rate: 21, total_amount: 54450 },
          { description: null }, // dropped — no description
        ],
      },
      'OCR TEXT',
    );

    expect(invoice.isInvoice).toBe(true);
    expect(invoice.documentType).toBe('invoice');
    expect(invoice.supplierIco).toBe('12345679');
    expect(invoice.supplierDic).toBe('CZ12345679');
    expect(invoice.bankAccount).toBe('2536670204');
    expect(invoice.bankCode).toBe('2600');
    expect(invoice.variableSymbol).toBe('20240156');
    expect(invoice.issueDate).toBe('2024-01-15');
    expect(invoice.totalAmount).toBe(78650);
    expect(invoice.currency).toBe('CZK');
    expect(invoice.reverseCharge).toBe(false);
    expect(invoice.vatBreakdown).toEqual([{ rate: 21, base: 65000, vat: 13650 }]);
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.rawText).toBe('OCR TEXT');
  });

  it('classifies non-invoice documents with isInvoice false', () => {
    const receipt = mapModelOutputToInvoice(
      { document_type: 'receipt', is_invoice: false },
      null,
    );
    expect(receipt.isInvoice).toBe(false);
    expect(receipt.documentType).toBe('receipt');
  });

  it('derives the variable symbol from the invoice number when missing', () => {
    const invoice = mapModelOutputToInvoice(
      { document_type: 'invoice', is_invoice: true, invoice_number: 'FV-2024/003' },
      null,
    );
    expect(invoice.variableSymbol).toBe('2024003');
  });
});
