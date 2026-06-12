/**
 * Attachment upload for received invoices.
 *
 * ABRA Flexi accepts a binary attachment as a raw-body **PUT** to
 *   {base}/faktura-prijata/{id}/prilohy/new/{fileName}
 * with the file's Content-Type header. The filename goes in the PATH (not a
 * query param) and must be URL-encoded (Czech diacritics in OCR'd filenames
 * would otherwise break the request). POST or the `?name=` query form are
 * rejected (405 / a misleading "Import ISDOC funguje pouze v evidencich…" 400).
 *
 * https://podpora.flexibee.eu/cs/articles/4722200-prilohy
 */

import { readFile } from 'fs/promises';
import { logger } from '../../utils/logger.js';
import { AppError, ErrorCodes, toError } from '../../utils/errors.js';
import type { AbraFlexiConfig } from '../../types/contracts.js';
import { abraRequest, abraRejectionError } from './client.js';
import { ENTITY_FAKTURA_PRIJATA } from './helpers.js';

/** Attachments can be large scans — allow a longer timeout than regular calls. */
const ATTACHMENT_TIMEOUT_MS = 60_000;

/**
 * Upload the original document file as an attachment of an existing ABRA
 * Flexi received invoice.
 *
 * @throws {AppError} when the file cannot be read or ABRA rejects the upload
 */
export async function uploadInvoiceAttachment(
  cfg: AbraFlexiConfig,
  abraInvoiceId: string,
  filePath: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch (error: unknown) {
    throw new AppError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      `Soubor přílohy nelze přečíst: ${toError(error).message}`,
      500,
    );
  }

  const safeName = encodeURIComponent(fileName || 'document.pdf');
  const path = `/${ENTITY_FAKTURA_PRIJATA}/${encodeURIComponent(abraInvoiceId)}/prilohy/new/${safeName}`;

  logger.info(
    { companyId: cfg.companyId, abraInvoiceId, fileName, mimeType, sizeBytes: content.length },
    '[AbraFlexi] Uploading invoice attachment',
  );

  const res = await abraRequest(cfg, {
    path,
    method: 'PUT',
    body: new Uint8Array(content),
    contentType: mimeType || 'application/octet-stream',
    timeoutMs: ATTACHMENT_TIMEOUT_MS,
  });

  if (!res.ok) {
    throw abraRejectionError(res, 'nahrání přílohy');
  }

  logger.info({ companyId: cfg.companyId, abraInvoiceId, fileName }, '[AbraFlexi] Attachment uploaded');
}
