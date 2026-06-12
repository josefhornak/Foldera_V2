import { describe, expect, it } from 'vitest';
import {
  detectStructuredFormat,
  mightBeStructuredXml,
  parseStructuredInvoiceXml,
} from './isdocExtraction.js';
import { scoreIsdocConfidence } from './confidence.js';

const ISDOC_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1">
  <DocumentType>1</DocumentType>
  <ID>FV-2026-0042</ID>
  <IssueDate>2026-05-02</IssueDate>
  <TaxPointDate>2026-05-02</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <Note>Konzultační služby</Note>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <AccountingSupplierParty>
    <Party>
      <PartyIdentification><ID>12345679</ID></PartyIdentification>
      <PartyName><Name>Dodavatel s.r.o.</Name></PartyName>
      <PostalAddress>
        <StreetName>Karlova</StreetName>
        <BuildingNumber>10</BuildingNumber>
        <CityName>Praha 1</CityName>
        <PostalZone>110 00</PostalZone>
        <Country><IdentificationCode>CZ</IdentificationCode><Name>Česká republika</Name></Country>
      </PostalAddress>
      <PartyTaxScheme><CompanyID>CZ12345679</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <PartyIdentification><ID>87654321</ID></PartyIdentification>
      <PartyName><Name>Odběratel a.s.</Name></PartyName>
    </Party>
  </AccountingCustomerParty>
  <InvoiceLines>
    <InvoiceLine>
      <ID>1</ID>
      <InvoicedQuantity unitCode="hod">8</InvoicedQuantity>
      <LineExtensionAmount>20000.00</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>24200.00</LineExtensionAmountTaxInclusive>
      <UnitPrice>2500.00</UnitPrice>
      <ClassifiedTaxCategory><Percent>21</Percent></ClassifiedTaxCategory>
      <Item><Description>Konzultace</Description></Item>
    </InvoiceLine>
  </InvoiceLines>
  <TaxTotal>
    <TaxSubTotal>
      <TaxableAmount>20000.00</TaxableAmount>
      <TaxAmount>4200.00</TaxAmount>
      <TaxCategory><Percent>21</Percent></TaxCategory>
    </TaxSubTotal>
    <TaxAmount>4200.00</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>20000.00</TaxExclusiveAmount>
    <TaxInclusiveAmount>24200.00</TaxInclusiveAmount>
    <PayableAmount>24200.00</PayableAmount>
  </LegalMonetaryTotal>
  <PaymentMeans>
    <Payment>
      <PaidAmount>24200.00</PaidAmount>
      <PaymentMeansCode>42</PaymentMeansCode>
      <Details>
        <PaymentDueDate>2026-05-16</PaymentDueDate>
        <ID>2536670204</ID>
        <BankCode>2010</BankCode>
        <Name>Fio banka</Name>
        <IBAN>CZ6520100000002536670204</IBAN>
        <BIC>FIOBCZPP</BIC>
        <VariableSymbol>20260042</VariableSymbol>
        <ConstantSymbol>0308</ConstantSymbol>
      </Details>
    </Payment>
  </PaymentMeans>
</Invoice>`;

const UBL_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-100</cbc:ID>
  <cbc:IssueDate>2026-04-01</cbc:IssueDate>
  <cbc:DueDate>2026-04-15</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Supplier GmbH</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>Supplier GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>DE89370400440532013000</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">190.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">1000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">190.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:Percent>19</cbc:Percent></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1190.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">1190.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Widget</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:Percent>19</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">100.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

describe('detection', () => {
  it('detects ISDOC by extension and mime regardless of content', () => {
    expect(detectStructuredFormat('faktura.isdoc', 'application/octet-stream', '')).toBe('isdoc');
    expect(detectStructuredFormat('faktura.bin', 'application/x-isdoc', '')).toBe('isdoc');
  });

  it('detects ISDOC by isdoc.cz namespace in XML content', () => {
    expect(detectStructuredFormat('faktura.xml', 'application/xml', ISDOC_FIXTURE)).toBe('isdoc');
  });

  it('detects Peppol/UBL by namespace', () => {
    expect(detectStructuredFormat('invoice.xml', 'text/xml', UBL_FIXTURE)).toBe('ubl');
  });

  it('returns null for unrelated XML and non-XML files', () => {
    expect(detectStructuredFormat('data.xml', 'application/xml', '<root><foo/></root>')).toBeNull();
    expect(detectStructuredFormat('scan.pdf', 'application/pdf', '%PDF-1.7')).toBeNull();
    expect(mightBeStructuredXml('scan.pdf', 'application/pdf')).toBe(false);
    expect(mightBeStructuredXml('faktura.isdoc', 'application/octet-stream')).toBe(true);
  });
});

describe('parseStructuredInvoiceXml — ISDOC (ground truth)', () => {
  const invoice = parseStructuredInvoiceXml(ISDOC_FIXTURE, 'isdoc');

  it('classifies as invoice', () => {
    expect(invoice.isInvoice).toBe(true);
    expect(invoice.documentType).toBe('invoice');
  });

  it('extracts supplier identity and address', () => {
    expect(invoice.supplierName).toBe('Dodavatel s.r.o.');
    expect(invoice.supplierIco).toBe('12345679');
    expect(invoice.supplierDic).toBe('CZ12345679');
    expect(invoice.supplierAddress).toBe('Karlova 10, 110 00 Praha 1');
  });

  it('extracts document numbers, symbols and dates', () => {
    expect(invoice.invoiceNumber).toBe('FV-2026-0042');
    expect(invoice.variableSymbol).toBe('20260042');
    expect(invoice.constantSymbol).toBe('0308');
    expect(invoice.issueDate).toBe('2026-05-02');
    expect(invoice.taxDate).toBe('2026-05-02');
    expect(invoice.dueDate).toBe('2026-05-16');
  });

  it('extracts amounts, currency and VAT breakdown', () => {
    expect(invoice.totalAmount).toBe(24200);
    expect(invoice.totalWithoutVat).toBe(20000);
    expect(invoice.currency).toBe('CZK');
    expect(invoice.vatBreakdown).toEqual([{ rate: 21, base: 20000, vat: 4200 }]);
    expect(invoice.reverseCharge).toBe(false);
  });

  it('extracts bank coordinates and payment method', () => {
    expect(invoice.bankAccount).toBe('2536670204');
    expect(invoice.bankCode).toBe('2010');
    expect(invoice.iban).toBe('CZ6520100000002536670204');
    expect(invoice.swift).toBe('FIOBCZPP');
    expect(invoice.paymentMethod).toBe('převodem');
  });

  it('extracts line items with unit code attribute', () => {
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0]).toEqual({
      description: 'Konzultace',
      quantity: 8,
      unit: 'hod',
      unitPrice: 2500,
      total: 24200,
      vatRate: 21,
    });
  });

  it('extracts the note as description', () => {
    expect(invoice.description).toBe('Konzultační služby');
  });

  it('is ground truth — confidence 95+', () => {
    expect(scoreIsdocConfidence(invoice)).toBeGreaterThanOrEqual(95);
    expect(scoreIsdocConfidence(invoice)).toBe(100);
  });
});

describe('parseStructuredInvoiceXml — ISDOC credit note', () => {
  it('maps DocumentType 2 to credit_note with isInvoice false', () => {
    const creditNote = parseStructuredInvoiceXml(
      ISDOC_FIXTURE.replace('<DocumentType>1</DocumentType>', '<DocumentType>2</DocumentType>'),
      'isdoc',
    );
    expect(creditNote.documentType).toBe('credit_note');
    expect(creditNote.isInvoice).toBe(false);
  });
});

describe('parseStructuredInvoiceXml — Peppol/UBL', () => {
  const invoice = parseStructuredInvoiceXml(UBL_FIXTURE, 'ubl');

  it('extracts header fields', () => {
    expect(invoice.isInvoice).toBe(true);
    expect(invoice.invoiceNumber).toBe('INV-100');
    expect(invoice.issueDate).toBe('2026-04-01');
    expect(invoice.dueDate).toBe('2026-04-15');
    expect(invoice.currency).toBe('EUR');
  });

  it('extracts supplier and IBAN from PayeeFinancialAccount', () => {
    expect(invoice.supplierName).toBe('Supplier GmbH');
    expect(invoice.supplierDic).toBe('DE123456789');
    expect(invoice.iban).toBe('DE89370400440532013000');
  });

  it('extracts amounts and VAT buckets (non-Czech rate preserved)', () => {
    expect(invoice.totalAmount).toBe(1190);
    expect(invoice.totalWithoutVat).toBe(1000);
    expect(invoice.vatBreakdown).toEqual([{ rate: 19, base: 1000, vat: 190 }]);
  });

  it('extracts line items', () => {
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0]).toEqual({
      description: 'Widget',
      quantity: 10,
      unit: 'EA',
      unitPrice: 100,
      total: 1000,
      vatRate: 19,
    });
  });
});
