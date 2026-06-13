/**
 * Minimal ISDOC 6.0.1 invoice generator for Foldera's own subscription
 * invoices. Foldera bills as a non-VAT sole trader, so every amount carries a
 * 0% / "no VAT" treatment (VATApplicable=false). The XML is attached to the
 * invoice e-mail so customers can import it straight into their accounting.
 */
import { randomUUID } from 'node:crypto';

import { XMLBuilder } from 'fast-xml-parser';

export interface IsdocLine {
  id: number;
  description: string;
  quantity: number;
  unitPriceCzk: number;
  amountCzk: number;
}

export interface IsdocInvoice {
  number: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  variableSymbol: string;
  supplier: { name: string; ico: string; address: string; email: string; iban: string | null; account: string };
  customer: { name: string; ico: string | null; address: string | null };
  lines: IsdocLine[];
  totalCzk: number;
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

function money(n: number): string {
  return n.toFixed(2);
}

function partyAddress(name: string, ico: string | null, address: string | null) {
  // ISDOC PostalAddress is loosely structured; we put the whole line in StreetName.
  return {
    Party: {
      PartyIdentification: ico ? { ID: ico } : undefined,
      PartyName: { Name: name },
      PostalAddress: address
        ? { StreetName: address, City: '', PostalZone: '', Country: { IdentificationCode: 'CZ', Name: 'Česká republika' } }
        : undefined,
      PartyTaxScheme: ico ? { CompanyID: ico, TaxScheme: 'VAT' } : undefined,
    },
  };
}

/** Build an ISDOC 6.0.1 XML string for a non-VAT-payer invoice. */
export function buildIsdocXml(inv: IsdocInvoice): string {
  const lines = inv.lines.map((ln) => ({
    '@_xml:id': `L${ln.id}`,
    ID: ln.id,
    InvoicedQuantity: { '@_unitCode': 'kus', '#text': ln.quantity },
    LineExtensionAmount: money(ln.amountCzk),
    LineExtensionAmountTaxInclusive: money(ln.amountCzk),
    LineExtensionTaxAmount: money(0),
    UnitPrice: money(ln.unitPriceCzk),
    UnitPriceTaxInclusive: money(ln.unitPriceCzk),
    ClassifiedTaxCategory: { Percent: '0', VATApplicable: 'false' },
    Item: { Description: ln.description },
  }));

  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    Invoice: {
      '@_xmlns': 'http://isdoc.cz/namespace/2013',
      '@_version': '6.0.1',
      DocumentType: '1',
      ID: inv.number,
      UUID: randomUUID(),
      IssueDate: inv.issueDate,
      TaxPointDate: inv.issueDate,
      VATApplicable: 'false',
      LocalCurrencyCode: 'CZK',
      CurrRate: '1',
      RefCurrRate: '1',
      AccountingSupplierParty: partyAddress(inv.supplier.name, inv.supplier.ico, inv.supplier.address),
      AccountingCustomerParty: partyAddress(inv.customer.name, inv.customer.ico, inv.customer.address),
      InvoiceLines: { InvoiceLine: lines },
      TaxTotal: {
        TaxSubTotal: {
          TaxableAmount: money(inv.totalCzk),
          TaxAmount: money(0),
          TaxInclusiveAmount: money(inv.totalCzk),
          AlreadyClaimedTaxableAmount: money(0),
          AlreadyClaimedTaxAmount: money(0),
          AlreadyClaimedTaxInclusiveAmount: money(0),
          DifferenceTaxableAmount: money(inv.totalCzk),
          DifferenceTaxAmount: money(0),
          DifferenceTaxInclusiveAmount: money(inv.totalCzk),
          TaxCategory: { Percent: '0', VATApplicable: 'false' },
        },
        TaxAmount: money(0),
      },
      LegalMonetaryTotal: {
        TaxExclusiveAmount: money(inv.totalCzk),
        TaxInclusiveAmount: money(inv.totalCzk),
        AlreadyClaimedTaxExclusiveAmount: money(0),
        AlreadyClaimedTaxInclusiveAmount: money(0),
        DifferenceTaxExclusiveAmount: money(inv.totalCzk),
        DifferenceTaxInclusiveAmount: money(inv.totalCzk),
        PayableRoundingAmount: money(0),
        PaidDepositsAmount: money(0),
        PayableAmount: money(inv.totalCzk),
      },
      PaymentMeans: {
        Payment: {
          PaidAmount: money(inv.totalCzk),
          PaymentMeansCode: '42',
          Details: {
            PaymentDueDate: inv.dueDate,
            ID: inv.supplier.account,
            BankCode: inv.supplier.account.split('/')[1] ?? '',
            IBAN: inv.supplier.iban ?? '',
            VariableSymbol: inv.variableSymbol,
          },
        },
      },
    },
  };

  return builder.build(doc);
}
