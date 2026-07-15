import fs from 'node:fs/promises';
import path from 'node:path';

import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { simpleParser } from 'mailparser';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '../db/client.js';
import { documents, DOCUMENT_STATUS, type DocumentStatus } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany, requireAdminRole } from '../middleware/companyScope.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { enqueueExportRetry, enqueueProcessDocument } from '../queue/queues.js';
import {
  filterInvoiceAttachments,
  resolveMimeType,
  validateMagicNumber,
  type SupportedMimeType,
} from '../services/sources/attachmentFilter.js';
import { logger } from '../utils/logger.js';
import { sha256Hex, decryptSecret } from '../utils/crypto.js';
import { deleteExportedDocument } from '../services/abraflexi/export.js';
import { ENTITY_FAKTURA_PRIJATA } from '../services/abraflexi/helpers.js';
import { documentColumnsFromExtracted } from '../services/documentFields.js';
import { removeStored, resolveStoredPath, storedFileExists } from '../services/storage.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { escapeLikePattern } from '../utils/sqlUtils.js';
import { ensureTmpDir } from '../utils/tmpDir.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
/** Upper bound on MIME parts examined when unwrapping a container (DoS guard). */
const MAX_MIME_PARTS = 50;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE, files: MAX_UPLOAD_FILES },
});

interface UploadResult {
  fileName: string;
  status: 'queued' | 'duplicate' | 'unsupported';
  documentId?: string;
}

interface ReadyFile {
  content: Buffer;
  fileName: string;
  mimeType: SupportedMimeType;
}

/** Dedup, persist to the temp dir and enqueue a single ready file. */
async function queueFile(
  companyId: string,
  tmpDir: string,
  file: ReadyFile
): Promise<UploadResult> {
  const contentHash = sha256Hex(file.content);
  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.contentHash, contentHash)))
    .limit(1);
  if (existing) return { fileName: file.fileName, status: 'duplicate', documentId: existing.id };

  const ext = path.extname(file.fileName);
  const filePath = path.join(tmpDir, `upload-${nanoid(16)}${ext}`);
  await fs.writeFile(filePath, file.content);

  await enqueueProcessDocument({
    companyId,
    sourceId: null,
    file: {
      externalRef: `upload:${contentHash}`,
      fileName: file.fileName,
      mimeType: file.mimeType,
      filePath,
      receivedAt: new Date().toISOString(),
    },
  });
  return { fileName: file.fileName, status: 'queued' };
}

/**
 * Some "documents" are actually MIME containers — an email (.eml) saved with a
 * .pdf name, or a MIME-wrapped invoice. When a raw file isn't a supported type,
 * try to pull out the real invoice attachments inside.
 *
 * Strategy: mailparser first (handles real .eml / RFC822 well), then a tolerant
 * manual multipart splitter (handles bare multipart bodies with no envelope,
 * various transfer encodings). Returns [] when nothing usable is found.
 */
async function extractMimeAttachments(buffer: Buffer, fallbackName: string): Promise<ReadyFile[]> {
  const head = buffer.subarray(0, 512).toString('latin1');
  const looksMime = /^\s*--\S/.test(head) || /content-(type|disposition)\s*:/i.test(head);
  if (looksMime) {
    const fromMime = await extractViaMimeParsers(buffer, head);
    if (fromMime.length > 0) return fromMime;
  }

  // Final fallback: carve a raw-embedded PDF out of an arbitrary wrapper
  // (e.g. nested multipart/form-data bodies that embed the PDF uncompressed).
  const carved = carveEmbeddedPdf(buffer, fallbackName);
  return carved ? [carved] : [];
}

/** mailparser (raw + synthesized header) then a tolerant manual multipart split. */
async function extractViaMimeParsers(buffer: Buffer, head: string): Promise<ReadyFile[]> {
  // Attempt 1+2: mailparser, raw then with a synthesized multipart header.
  try {
    const collect = async (raw: Buffer): Promise<ReadyFile[]> => {
      const parsed = await simpleParser(raw);
      const out: ReadyFile[] = [];
      for (const [i, att] of filterInvoiceAttachments(parsed.attachments).entries()) {
        const mimeType = resolveMimeType(att.contentType, att.filename);
        if (mimeType && att.content) {
          out.push({ content: att.content, fileName: att.filename || `priloha-${i + 1}`, mimeType });
        }
      }
      return out;
    };
    let found = await collect(buffer);
    if (found.length === 0) {
      const firstLine = (head.split(/\r?\n/)[0] ?? '').trim();
      if (firstLine.startsWith('--') && firstLine.length > 2) {
        const wrapped = Buffer.concat([
          Buffer.from(
            `MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${firstLine.slice(2)}"\r\n\r\n`,
            'utf8'
          ),
          buffer,
        ]);
        found = await collect(wrapped);
      }
    }
    if (found.length > 0) return found;
  } catch {
    /* fall through to the manual splitter */
  }

  // Attempt 3: tolerant manual multipart split.
  return manualMultipartExtract(buffer);
}

/** Parse RFC822-style headers (with folded-line continuation) into a map. */
function parseMimeHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  let lastKey = '';
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && lastKey) {
      out[lastKey] += ' ' + line.trim();
      continue;
    }
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (m) {
      lastKey = m[1]!.toLowerCase().trim();
      out[lastKey] = m[2]!;
    }
  }
  return out;
}

function decodeQuotedPrintable(s: string): Buffer {
  const t = s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(t, 'latin1');
}

/**
 * Tolerant multipart extractor: derives the boundary from the first delimiter
 * line, splits parts, decodes each by its Content-Transfer-Encoding and keeps
 * the ones that are valid supported documents (magic-number checked).
 */
function manualMultipartExtract(buffer: Buffer): ReadyFile[] {
  const text = buffer.toString('latin1');
  const firstDelim = text.split(/\r?\n/).find((l) => l.startsWith('--') && l.trim().length > 2);
  if (!firstDelim) return [];
  const boundary = firstDelim.trim().slice(2);
  if (!boundary) return [];

  const out: ReadyFile[] = [];
  // Bound the work: a hostile body could declare thousands of tiny parts.
  const segments = text.split('--' + boundary).slice(1, 1 + MAX_MIME_PARTS);
  for (const segment of segments) {
    const part = segment.replace(/^\r?\n/, '');
    if (!part || part.startsWith('--')) continue; // closing delimiter / epilogue
    const sepMatch = /\r?\n\r?\n/.exec(part);
    if (!sepMatch) continue;
    const headers = parseMimeHeaders(part.slice(0, sepMatch.index));
    let body = part.slice(sepMatch.index + sepMatch[0].length).replace(/\r?\n$/, '');

    const ctype = (headers['content-type'] ?? '').split(';')[0]!.trim();
    const disposition = headers['content-disposition'] ?? '';
    const filename = /filename\*?=(?:"([^"]+)"|([^;\r\n]+))/i.exec(
      disposition + ';' + (headers['content-type'] ?? '')
    );
    const fileName = (filename?.[1] ?? filename?.[2])?.trim();

    const mimeType = resolveMimeType(ctype, fileName);
    if (!mimeType) continue;

    const enc = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase().trim();
    let content: Buffer;
    if (enc === 'base64') content = Buffer.from(body.replace(/\s+/g, ''), 'base64');
    else if (enc === 'quoted-printable') content = decodeQuotedPrintable(body);
    else content = Buffer.from(body, 'latin1');

    if (content.length > 0 && validateMagicNumber(content, mimeType)) {
      out.push({ content, fileName: fileName || `priloha-${out.length + 1}`, mimeType });
    }
  }
  return out;
}

/**
 * Locate and slice out a raw (uncompressed) PDF embedded in an arbitrary
 * wrapper — handles oddities like nested multipart/form-data bodies that carry
 * the PDF verbatim. Returns null when no PDF is present.
 */
function carveEmbeddedPdf(buffer: Buffer, fallbackName: string): ReadyFile | null {
  const start = buffer.indexOf(Buffer.from('%PDF-', 'latin1'));
  if (start === -1) return null;
  const eof = buffer.lastIndexOf(Buffer.from('%%EOF', 'latin1'));
  if (eof === -1 || eof < start) return null;
  const content = buffer.subarray(start, eof + 5); // include the %%EOF marker
  if (content.length < 64) return null;
  const base = fallbackName.replace(/\.[^.]+$/, '').trim() || 'dokument';
  return { content, fileName: `${base}.pdf`, mimeType: 'application/pdf' };
}

/**
 * Manual upload (button + drag & drop in the UI). Files go through the exact
 * same pipeline as documents from polled sources: written to the shared temp
 * dir, queued for processing, then retained under the file-retention policy.
 *
 * Open to any member, unlike the other mutating routes here: handing invoices
 * in is the job, and a colleague who may only ever add documents shouldn't need
 * the admin role that also lets them delete documents or rewire the ABRA
 * connection. Everything a member uploads still goes through extraction and the
 * usual review gates before it reaches ABRA Flexi.
 */
router.post('/upload', uploadLimiter, upload.array('files', MAX_UPLOAD_FILES), async (req, res, next) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      throw new AppError(ErrorCodes.BAD_REQUEST, 'No files uploaded', 400);
    }

    const tmpDir = await ensureTmpDir();
    const companyId = req.company!.id;
    const results: UploadResult[] = [];

    for (const file of files) {
      // Multer decodes latin1 — recover UTF-8 filenames (diacritics)
      const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      const mimeType = resolveMimeType(file.mimetype, fileName);
      if (mimeType && validateMagicNumber(file.buffer, mimeType)) {
        results.push(await queueFile(companyId, tmpDir, { content: file.buffer, fileName, mimeType }));
        continue;
      }

      // Not a supported file as-is — it may be a MIME container (email/EML or a
      // MIME-wrapped invoice). Parse it and queue any real attachments inside.
      const inner = await extractMimeAttachments(file.buffer, fileName);
      if (inner.length > 0) {
        logger.info({ fileName, count: inner.length }, '[Upload] Unwrapped MIME container');
        for (const att of inner) {
          results.push(await queueFile(companyId, tmpDir, att));
        }
        continue;
      }

      // Diagnostic: capture why a file was rejected (helps support odd formats).
      logger.warn(
        {
          fileName,
          declaredMime: file.mimetype,
          size: file.buffer.length,
          head: file.buffer
            .subarray(0, 400)
            .toString('latin1')
            .replace(/[^\x20-\x7e]/g, '.'),
        },
        '[Upload] Unsupported file'
      );
      results.push({ fileName, status: 'unsupported' });
    }

    res.status(202).json({ results });
  } catch (err) {
    next(err);
  }
});

/** Statuses grouped under the UI "Chyba" (error) filter / stats `failed` bucket. */
const FAILED_STATUSES = [DOCUMENT_STATUS.EXPORT_FAILED, DOCUMENT_STATUS.EXTRACTION_FAILED] as const;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  // 'failed' is a virtual group matching both error statuses (mirrors stats.failed).
  status: z
    .enum([...(Object.values(DOCUMENT_STATUS) as [DocumentStatus, ...DocumentStatus[]]), 'failed'])
    .optional(),
  search: z.string().max(200).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const companyId = req.company!.id;

    const conditions = [eq(documents.companyId, companyId)];
    if (q.status === 'failed') conditions.push(inArray(documents.status, [...FAILED_STATUSES]));
    else if (q.status) conditions.push(eq(documents.status, q.status));
    if (q.search) {
      const pattern = `%${escapeLikePattern(q.search)}%`;
      const searchCond = or(
        ilike(documents.supplierName, pattern),
        ilike(documents.invoiceNumber, pattern),
        ilike(documents.variableSymbol, pattern),
        ilike(documents.fileName, pattern)
      );
      if (searchCond) conditions.push(searchCond);
    }

    const where = and(...conditions);
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: documents.id,
          fileName: documents.fileName,
          status: documents.status,
          errorMessage: documents.errorMessage,
          supplierName: documents.supplierName,
          supplierIco: documents.supplierIco,
          invoiceNumber: documents.invoiceNumber,
          variableSymbol: documents.variableSymbol,
          issueDate: documents.issueDate,
          dueDate: documents.dueDate,
          totalAmount: documents.totalAmount,
          currency: documents.currency,
          confidence: documents.confidence,
          abraCode: documents.abraCode,
          abraUrl: documents.abraUrl,
          processedAt: documents.processedAt,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(where)
        .orderBy(desc(documents.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ value: count() }).from(documents).where(where),
    ]);

    res.json({ documents: rows, total: total?.value ?? 0, page: q.page, pageSize: q.pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const companyId = req.company!.id;
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byStatus, recent] = await Promise.all([
      db
        .select({ status: documents.status, count: count(), avgConfidence: sql<number>`avg(${documents.confidence})` })
        .from(documents)
        .where(eq(documents.companyId, companyId))
        .groupBy(documents.status),
      db
        .select({ status: documents.status, count: count(), avgConfidence: sql<number>`avg(${documents.confidence})` })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), gte(documents.createdAt, since30d)))
        .groupBy(documents.status),
    ]);

    const summarize = (rows: typeof byStatus) => {
      let total = 0;
      let exported = 0;
      let failed = 0;
      let skipped = 0;
      let processing = 0;
      let confidenceSum = 0;
      let confidenceCount = 0;
      for (const row of rows) {
        total += row.count;
        const isSkipped =
          row.status === DOCUMENT_STATUS.SKIPPED_DUPLICATE ||
          row.status === DOCUMENT_STATUS.SKIPPED_NOT_INVOICE ||
          row.status === DOCUMENT_STATUS.SKIPPED_LIMIT;
        if (row.status === DOCUMENT_STATUS.EXPORTED) exported += row.count;
        else if (row.status === DOCUMENT_STATUS.EXPORT_FAILED || row.status === DOCUMENT_STATUS.EXTRACTION_FAILED)
          failed += row.count;
        else if (row.status === DOCUMENT_STATUS.PROCESSING) processing += row.count;
        else skipped += row.count;
        // Average accuracy reflects only real invoices — skip non-invoice and
        // duplicate documents so they don't distort the percentage.
        if (row.avgConfidence != null && !isSkipped) {
          confidenceSum += Number(row.avgConfidence) * row.count;
          confidenceCount += row.count;
        }
      }
      return {
        total,
        exported,
        failed,
        skipped,
        processing,
        avgConfidence: confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : null,
        successRate: exported + failed > 0 ? Math.round((exported / (exported + failed)) * 100) : null,
      };
    };

    res.json({ allTime: summarize(byStatus), last30Days: summarize(recent) });
  } catch (err) {
    next(err);
  }
});

router.get('/:documentId', async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, String(req.params.documentId)), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
    // rawText can be large — strip it from the detail payload; it is served by
    // /text for the reader that actually wants it.
    const extracted = row.extracted ? { ...row.extracted, rawText: null } : null;
    res.json({
      document: {
        ...row,
        extracted,
        // Whether the original can still be shown — the file may have expired.
        hasFile: await storedFileExists(row.storageKey),
        hasText: Boolean(row.extracted?.rawText),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The original file, for previewing the document being corrected. Streamed
 * through the API (never a public path) so company scoping and auth apply, and
 * inline so the browser renders it instead of downloading.
 */
router.get('/:documentId/file', async (req, res, next) => {
  try {
    const [row] = await db
      .select({
        storageKey: documents.storageKey,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
      })
      .from(documents)
      .where(and(eq(documents.id, String(req.params.documentId)), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
    if (!(await storedFileExists(row.storageKey))) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Originál dokladu už není k dispozici.', 404);
    }

    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
    // The file is someone's invoice — never let a shared cache hold it.
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(resolveStoredPath(row.storageKey!), (err) => {
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
});

/**
 * What the OCR actually read. Kept out of the detail payload (it is large) and
 * out of the list entirely; this is the fallback preview once the original has
 * expired, and the reference when checking a correction.
 */
router.get('/:documentId/text', async (req, res, next) => {
  try {
    const [row] = await db
      .select({ extracted: documents.extracted })
      .from(documents)
      .where(and(eq(documents.id, String(req.params.documentId)), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
    res.json({ text: row.extracted?.rawText ?? null });
  } catch (err) {
    next(err);
  }
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum musí být ve tvaru RRRR-MM-DD');

/**
 * What a human may correct.
 *
 * A whitelist, and `.strict()`, on purpose: `rawText` is the OCR record of what
 * the document actually said and must stay exactly as read, and `lineItems` /
 * `vatBreakdown` are structured sets the form cannot express yet. `isInvoice`
 * and `confidence` are the extractor's own verdict — an edit corrects the data,
 * it doesn't rewrite history.
 */
const documentEditSchema = z
  .object({
    documentType: z.enum(['invoice', 'advance_invoice', 'tax_payment', 'receipt', 'credit_note', 'other']),
    supplierName: z.string().max(255).nullable(),
    supplierIco: z.string().max(32).nullable(),
    supplierDic: z.string().max(32).nullable(),
    supplierAddress: z.string().max(500).nullable(),
    invoiceNumber: z.string().max(64).nullable(),
    variableSymbol: z.string().max(32).nullable(),
    constantSymbol: z.string().max(32).nullable(),
    specificSymbol: z.string().max(32).nullable(),
    orderNumber: z.string().max(64).nullable(),
    issueDate: isoDate.nullable(),
    taxDate: isoDate.nullable(),
    dueDate: isoDate.nullable(),
    totalAmount: z.number().finite().nullable(),
    totalWithoutVat: z.number().finite().nullable(),
    currency: z.string().max(8).nullable(),
    bankAccount: z.string().max(64).nullable(),
    bankCode: z.string().max(8).nullable(),
    iban: z.string().max(64).nullable(),
    swift: z.string().max(32).nullable(),
    description: z.string().max(2000).nullable(),
  })
  .partial()
  .strict();

/**
 * Correct what the AI read.
 *
 * The stored `extracted` JSON is exactly what an export sends, so editing it
 * here is what makes a resend behave differently (see retryExport). Blocked for
 * documents already in ABRA Flexi: Foldera would then claim something the
 * accounting system doesn't say.
 */
router.patch('/:documentId', requireAdminRole, async (req, res, next) => {
  try {
    const patch = documentEditSchema.parse(req.body);
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, String(req.params.documentId)), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
    if (row.status === DOCUMENT_STATUS.EXPORTED) {
      throw new AppError(
        ErrorCodes.CONFLICT,
        'Doklad už je založený v ABRA Flexi — upravte ho přímo tam, jinak by se údaje rozešly.',
        409
      );
    }
    if (row.status === DOCUMENT_STATUS.PROCESSING) {
      throw new AppError(ErrorCodes.CONFLICT, 'Doklad se právě zpracovává. Počkejte na dokončení.', 409);
    }
    if (!row.extracted) {
      throw new AppError(
        ErrorCodes.CONFLICT,
        'U tohoto dokladu se nepodařilo přečíst žádná data, není co upravit.',
        409
      );
    }

    const edited = { ...row.extracted, ...patch };
    const [updated] = await db
      .update(documents)
      .set({
        ...documentColumnsFromExtracted(edited),
        // Capture the model's own answer the first time a human overrides it —
        // the only ground truth we get about where extraction goes wrong.
        extractedOriginal: row.extractedOriginal ?? row.extracted,
        editedAt: new Date(),
      })
      .where(and(eq(documents.id, row.id), eq(documents.companyId, req.company!.id)))
      .returning();
    if (!updated) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);

    res.json({
      document: {
        ...updated,
        extracted: { ...edited, rawText: null },
        hasFile: await storedFileExists(updated.storageKey),
        hasText: Boolean(edited.rawText),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Retry export to ABRA Flexi from stored extracted data (export_failed only) */
router.post('/:documentId/retry', requireAdminRole, async (req, res, next) => {
  try {
    const [row] = await db
      .select({ id: documents.id, status: documents.status, extracted: documents.extracted })
      .from(documents)
      .where(and(eq(documents.id, String(req.params.documentId)), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
    if (row.status !== DOCUMENT_STATUS.EXPORT_FAILED) {
      throw new AppError(ErrorCodes.CONFLICT, 'Only failed exports can be retried', 409);
    }
    if (!row.extracted) {
      throw new AppError(ErrorCodes.CONFLICT, 'No extracted data available for retry', 409);
    }

    await db
      .update(documents)
      .set({ status: DOCUMENT_STATUS.PROCESSING, errorMessage: null })
      .where(and(eq(documents.id, row.id), eq(documents.companyId, req.company!.id)));

    await enqueueExportRetry({ documentId: row.id, companyId: req.company!.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Approve a doc held for bank-account review → export it (admin-confirmed payee). */
router.post('/:documentId/approve', requireAdminRole, async (req, res, next) => {
  try {
    const [row] = await db
      .select({ id: documents.id, status: documents.status, extracted: documents.extracted })
      .from(documents)
      .where(and(eq(documents.id, String(req.params.documentId)), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
    if (row.status !== DOCUMENT_STATUS.NEEDS_REVIEW) {
      throw new AppError(ErrorCodes.CONFLICT, 'Only documents held for review can be approved', 409);
    }
    if (!row.extracted) {
      throw new AppError(ErrorCodes.CONFLICT, 'No extracted data available', 409);
    }
    await db
      .update(documents)
      .set({ status: DOCUMENT_STATUS.PROCESSING, errorMessage: null })
      .where(and(eq(documents.id, row.id), eq(documents.companyId, req.company!.id)));
    await enqueueExportRetry({ documentId: row.id, companyId: req.company!.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete a document record (metadata only — files are never stored anyway).
 * `?fromAbra=true` also deletes the document from ABRA Flexi when it was
 * exported there. The ABRA record may have been removed manually already, in
 * which case we proceed (alreadyGone). A hard ABRA failure (e.g. the doc is in
 * a closed/accounted period) aborts the whole delete so Foldera and ABRA don't
 * silently diverge — the caller is told why.
 */
router.delete('/:documentId', requireAdminRole, async (req, res, next) => {
  try {
    const fromAbra = req.query.fromAbra === 'true' || req.query.fromAbra === '1';
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, String(req.params.documentId)), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);

    let abra: { deleted: boolean; alreadyGone: boolean } | null = null;
    if (fromAbra && row.abraId) {
      const c = req.company!;
      if (!c.abraApiUrl || !c.abraApiUser || !c.abraApiPasswordEnc) {
        throw new AppError(
          ErrorCodes.BAD_REQUEST,
          'ABRA Flexi není připojená — doklad z ní nelze smazat.',
          400,
        );
      }
      const cfg = {
        apiUrl: c.abraApiUrl,
        apiUser: c.abraApiUser,
        apiPassword: decryptSecret(c.abraApiPasswordEnc),
        companyId: c.id,
      };
      const isReceipt = row.extracted?.documentType === 'receipt';
      const entity = isReceipt ? 'pokladni-pohyb' : ENTITY_FAKTURA_PRIJATA;
      // Throws on a hard failure → the Foldera record below is NOT deleted.
      abra = await deleteExportedDocument(cfg, entity, row.abraId);
    }

    await db
      .delete(documents)
      .where(and(eq(documents.id, row.id), eq(documents.companyId, req.company!.id)));

    // Deleting the document means deleting the file — don't wait for retention.
    await removeStored(row.storageKey);

    res.json({ ok: true, abra });
  } catch (err) {
    next(err);
  }
});

export default router;
