/**
 * OCR extraction path: PDF/image → mistral-ocr-latest (markdown text) →
 * mistral-small-latest structured field extraction → `ExtractedInvoice`.
 *
 * Ported API flow from Foldera v1 services/mistral/ocr.ts (two-step:
 * dedicated OCR endpoint, then a JSON-mode chat completion to parse the
 * OCR markdown into structured fields).
 */

import { readFile } from 'fs/promises';
import { logger } from '../../utils/logger.js';
import type { ExtractionInput, ExtractionResult } from '../../types/contracts.js';
import {
  getMistralConfig,
  ocrDocument,
  chatCompleteJson,
} from './mistralClient.js';
import { PURCHASE_INVOICE_EXTRACTION_PROMPT } from './prompts.js';
import { mapModelOutputToInvoice, modelConfidenceOf } from './mapping.js';
import { scoreOcrConfidence } from './confidence.js';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
]);

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|tiff?|bmp)$/i;

/** Determine the OCR document kind, or null when the file is not OCR-able. */
export function detectOcrKind(fileName: string, mimeType: string): 'pdf' | 'image' | null {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (IMAGE_MIME_TYPES.has(lowerMime)) return 'image';
  if (lowerMime.startsWith('image/')) return 'image';
  if (IMAGE_EXTENSIONS.test(lowerName)) return 'image';
  return null;
}

/** Detect MIME type from base64 header (ported from v1). */
export function detectMimeTypeFromBase64(base64: string): string | null {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('JVBER')) return 'application/pdf';
  return null;
}

/**
 * Extract a purchase invoice from a PDF or image via Mistral OCR + chat.
 * Never throws — returns a failed `ExtractionResult` instead.
 */
export async function extractViaOcr(input: ExtractionInput): Promise<ExtractionResult> {
  const config = getMistralConfig();
  if (config == null) {
    return {
      success: false,
      source: 'ocr',
      fields: null,
      confidence: 0,
      error: 'MISTRAL_API_KEY is not configured',
    };
  }

  const kind = detectOcrKind(input.fileName, input.mimeType);
  if (kind == null) {
    return {
      success: false,
      source: 'none',
      fields: null,
      confidence: 0,
      error: `unsupported mime type: ${input.mimeType}`,
    };
  }

  try {
    const buffer = await readFile(input.filePath);
    const base64 = buffer.toString('base64');

    // Prefer the sniffed MIME (the declared one may be octet-stream).
    const sniffedMime = detectMimeTypeFromBase64(base64);
    const mime =
      sniffedMime ?? (kind === 'pdf' ? 'application/pdf' : normalizeImageMime(input.mimeType));
    const effectiveKind = sniffedMime === 'application/pdf' ? 'pdf' : kind;
    const dataUrl = `data:${mime};base64,${base64}`;

    // Step 1: dedicated OCR — markdown text of all pages.
    const markdown = await ocrDocument(config, dataUrl, effectiveKind);
    if (!markdown.trim()) {
      return {
        success: false,
        source: 'ocr',
        fields: null,
        confidence: 0,
        error: 'OCR returned empty content',
      };
    }

    // Step 2: structured extraction + classification in one JSON-mode call.
    const raw = await chatCompleteJson(config, PURCHASE_INVOICE_EXTRACTION_PROMPT, markdown);

    const fields = mapModelOutputToInvoice(raw, markdown);
    const confidence = scoreOcrConfidence(fields, modelConfidenceOf(raw));

    logger.info(
      {
        fileName: input.fileName,
        kind: effectiveKind,
        isInvoice: fields.isInvoice,
        documentType: fields.documentType,
        confidence,
        invoiceNumber: fields.invoiceNumber,
        lineItemCount: fields.lineItems.length,
      },
      '[Extraction] OCR extraction complete',
    );

    // Non-invoice documents are still a successful extraction (isInvoice: false).
    return { success: true, source: 'ocr', fields, confidence };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { fileName: input.fileName, error: message },
      '[Extraction] OCR extraction failed',
    );
    return { success: false, source: 'ocr', fields: null, confidence: 0, error: message };
  }
}

function normalizeImageMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower === 'image/jpg') return 'image/jpeg';
  if (lower.startsWith('image/')) return lower;
  return 'image/jpeg';
}
