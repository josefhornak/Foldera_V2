/**
 * Document extraction module — Czech/Slovak/EU purchase invoices
 * (faktura přijatá) from PDF, image, or ISDOC/UBL XML files.
 *
 * Implements `ExtractInvoiceFn` from types/contracts.ts:
 * 1. ISDOC/UBL XML → parsed directly as ground truth (source 'isdoc', 95+)
 * 2. PDF/image → Mistral OCR + structured extraction (source 'ocr')
 * 3. Anything else → { success: false, source: 'none' }
 *
 * Used by a fully automatic pipeline (no user review) — never throws,
 * always resolves to an `ExtractionResult` with a 0–100 confidence score.
 */

import { logger } from '../../utils/logger.js';
import type { ExtractionInput, ExtractionResult } from '../../types/contracts.js';
import { extractStructuredInvoice } from './isdocExtraction.js';
import { extractViaOcr, detectOcrKind } from './ocrExtraction.js';

/**
 * Extract purchase-invoice fields from a file (PDF, image, or ISDOC/UBL XML).
 * Never throws.
 */
export async function extractInvoice(input: ExtractionInput): Promise<ExtractionResult> {
  try {
    // 1) Structured e-invoice XML (ISDOC / Peppol UBL) — ground truth, skips OCR.
    const structured = await extractStructuredInvoice(input);
    if (structured != null) return structured;

    // 2) PDF / image — OCR path.
    if (detectOcrKind(input.fileName, input.mimeType) != null) {
      return await extractViaOcr(input);
    }

    // 3) Unsupported file type.
    return {
      success: false,
      source: 'none',
      fields: null,
      confidence: 0,
      error: `unsupported mime type: ${input.mimeType}`,
    };
  } catch (error: unknown) {
    // Defense-in-depth: the sub-extractors already catch, but never throw.
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { fileName: input.fileName, mimeType: input.mimeType, error: message },
      '[Extraction] extractInvoice failed unexpectedly',
    );
    return { success: false, source: 'none', fields: null, confidence: 0, error: message };
  }
}

// Re-exports for consumers and tests.
export type {
  ExtractionInput,
  ExtractionResult,
  ExtractedInvoice,
  ExtractedLineItem,
  VatBucket,
  ExtractInvoiceFn,
} from '../../types/contracts.js';
export {
  extractStructuredInvoice,
  parseStructuredInvoiceXml,
  detectStructuredFormat,
  mightBeStructuredXml,
} from './isdocExtraction.js';
export { extractViaOcr, detectOcrKind } from './ocrExtraction.js';
export {
  scoreOcrConfidence,
  scoreIsdocConfidence,
  isValidIco,
  isIsoDate,
  isTotalConsistent,
  round2,
} from './confidence.js';
export { normalizeBankCode, splitBankAccount } from './bankCodeUtils.js';
export { PURCHASE_INVOICE_EXTRACTION_PROMPT } from './prompts.js';
