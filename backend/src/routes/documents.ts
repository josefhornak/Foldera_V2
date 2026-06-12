import fs from 'node:fs/promises';
import path from 'node:path';

import { and, count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '../db/client.js';
import { documents, DOCUMENT_STATUS, type DocumentStatus } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyScope.js';
import { enqueueExportRetry, enqueueProcessDocument } from '../queue/queues.js';
import {
  resolveMimeType,
  validateMagicNumber,
} from '../services/sources/attachmentFilter.js';
import { sha256Hex } from '../utils/crypto.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { escapeLikePattern } from '../utils/sqlUtils.js';
import { ensureTmpDir } from '../utils/tmpDir.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE, files: MAX_UPLOAD_FILES },
});

interface UploadResult {
  fileName: string;
  status: 'queued' | 'duplicate' | 'unsupported';
  documentId?: string;
}

/**
 * Manual upload (drag & drop in the UI). Files go through the exact same
 * pipeline as documents from polled sources: written to the shared temp dir,
 * queued for processing, deleted afterwards — never stored by the app.
 */
router.post('/upload', upload.array('files', MAX_UPLOAD_FILES), async (req, res, next) => {
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
      if (!mimeType || !validateMagicNumber(file.buffer, mimeType)) {
        results.push({ fileName, status: 'unsupported' });
        continue;
      }

      const contentHash = sha256Hex(file.buffer);
      const [existing] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), eq(documents.contentHash, contentHash)))
        .limit(1);
      if (existing) {
        results.push({ fileName, status: 'duplicate', documentId: existing.id });
        continue;
      }

      const ext = path.extname(fileName);
      const filePath = path.join(tmpDir, `upload-${nanoid(16)}${ext}`);
      await fs.writeFile(filePath, file.buffer);

      await enqueueProcessDocument({
        companyId,
        sourceId: null,
        file: {
          externalRef: `upload:${contentHash}`,
          fileName,
          mimeType,
          filePath,
          receivedAt: new Date().toISOString(),
        },
      });
      results.push({ fileName, status: 'queued' });
    }

    res.status(202).json({ results });
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(Object.values(DOCUMENT_STATUS) as [DocumentStatus, ...DocumentStatus[]]).optional(),
  search: z.string().max(200).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const companyId = req.company!.id;

    const conditions = [eq(documents.companyId, companyId)];
    if (q.status) conditions.push(eq(documents.status, q.status));
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
        if (row.status === DOCUMENT_STATUS.EXPORTED) exported += row.count;
        else if (row.status === DOCUMENT_STATUS.EXPORT_FAILED || row.status === DOCUMENT_STATUS.EXTRACTION_FAILED)
          failed += row.count;
        else if (row.status === DOCUMENT_STATUS.PROCESSING) processing += row.count;
        else skipped += row.count;
        if (row.avgConfidence != null) {
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
      .where(and(eq(documents.id, req.params.documentId!), eq(documents.companyId, req.company!.id)))
      .limit(1);
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
    // rawText can be large — strip it from the detail payload
    const extracted = row.extracted ? { ...row.extracted, rawText: null } : null;
    res.json({ document: { ...row, extracted } });
  } catch (err) {
    next(err);
  }
});

/** Retry export to ABRA Flexi from stored extracted data (export_failed only) */
router.post('/:documentId/retry', async (req, res, next) => {
  try {
    const [row] = await db
      .select({ id: documents.id, status: documents.status, extracted: documents.extracted })
      .from(documents)
      .where(and(eq(documents.id, req.params.documentId!), eq(documents.companyId, req.company!.id)))
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

export default router;
