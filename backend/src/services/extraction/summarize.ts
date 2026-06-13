/**
 * Collapse detailed invoice line items into one summary item per VAT rate
 * ("souhrnně"). Ported from Foldera V1: the OCR/AI prompt is unchanged — this is
 * a pure post-extraction transform applied only when a company opts into summary
 * mode. The grand total per VAT rate (and thus the document total ABRA computes)
 * is preserved exactly; only the number of rows changes.
 */
import type { ExtractedInvoice, ExtractedLineItem } from '../../types/contracts.js';

/** Effective line total, deriving from unit price × quantity when total is null. */
function lineTotal(item: ExtractedLineItem): number {
  if (item.total != null) return item.total;
  if (item.unitPrice != null) return item.unitPrice * (item.quantity && item.quantity !== 0 ? item.quantity : 1);
  return 0;
}

/** Tidy a header description for use as a summary line label. */
function cleanDescription(text: string | null): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

/**
 * Group line items by VAT rate, summing line totals into a single item per rate
 * (quantity 1, unit price = the summed total). Returns the input unchanged when
 * there is nothing to collapse (0 or 1 items).
 */
export function summarizeLineItems(
  items: ExtractedLineItem[],
  header: Pick<ExtractedInvoice, 'description'>,
): ExtractedLineItem[] {
  if (!Array.isArray(items) || items.length <= 1) return items;

  const groups = new Map<number, number>(); // vatRate → summed total
  for (const item of items) {
    const rate = item.vatRate ?? 0;
    groups.set(rate, (groups.get(rate) ?? 0) + lineTotal(item));
  }

  const multiRate = groups.size > 1;
  const headerDesc = cleanDescription(header.description);

  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0]) // highest VAT rate first
    .map(([rate, total]) => {
      let description: string;
      if (headerDesc && !multiRate) description = headerDesc;
      else if (headerDesc) description = `${headerDesc} (DPH ${rate}%)`;
      else description = `Souhrnná položka DPH ${rate}%`;
      return {
        description,
        quantity: 1,
        unit: null,
        unitPrice: total,
        total,
        vatRate: rate,
      };
    });
}
