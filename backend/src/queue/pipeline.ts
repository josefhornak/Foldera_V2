/**
 * Document processing pipeline — the heart of Foldera V2.
 *
 * For every incoming file: dedup by content hash → extract (Mistral OCR /
 * ISDOC) → consult ABRA Flexi (duplicate check, supplier defaults from
 * previous documents) → create faktura-prijata → upload the original as an
 * attachment → record metadata. The file itself is deleted afterwards and is
 * never stored by the application.
 *
 * Everything is automatic: low-confidence documents are exported too and only
 * flagged in the list. Only hard failures (ABRA rejection) end up retryable.
 */
import fs from 'node:fs/promises';

import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  companies,
  documents,
  DOCUMENT_STATUS,
  type Company,
} from '../db/schema/index.js';
import {
  exportPurchaseInvoice,
  exportReceiptToPokladna,
  ENTITY_POKLADNI_POHYB,
  findDuplicateInvoice,
  findSupplierByIco,
  getSupplierDefaults,
  suggestClenDph,
  suggestTypUcOp,
  suggestClenKonVykDph,
  uploadInvoiceAttachment,
} from '../services/abraflexi/index.js';
import { isKnownCzBankCode } from '../services/abraflexi/helpers.js';
import { extractInvoice } from '../services/extraction/index.js';
import type {
  AbraExportResult,
  AbraFlexiConfig,
  AbraSupplierDefaults,
  ExtractedInvoice,
} from '../types/contracts.js';
import { decryptSecret, sha256Hex } from '../utils/crypto.js';
import { toError } from '../utils/errors.js';
import { generateId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import type { ProcessDocumentJobData } from './queues.js';

const EMPTY_DEFAULTS: AbraSupplierDefaults = {
  documentType: null,
  predpisZauctovani: null,
  cleneniDph: null,
  cleneniKonVykDph: null,
  stredisko: null,
  formaUhrady: null,
};

function getAbraConfig(company: Company): AbraFlexiConfig | null {
  if (!company.abraApiUrl || !company.abraApiUser || !company.abraApiPasswordEnc) return null;
  return {
    apiUrl: company.abraApiUrl,
    apiUser: company.abraApiUser,
    apiPassword: decryptSecret(company.abraApiPasswordEnc),
    companyId: company.id,
  };
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // already gone — fine, we never keep files around
  }
}

interface ExportOutcome {
  status: (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];
  errorMessage?: string | null;
  abraId?: string | null;
  abraCode?: string | null;
  abraUrl?: string | null;
}

/**
 * Export an extracted invoice to ABRA Flexi: duplicate check → supplier
 * context → create document. Shared by the main pipeline and the retry path.
 * `attachmentPath` is null on retry (the original file no longer exists).
 */
async function runAbraExport(
  company: Company,
  invoice: ExtractedInvoice,
  attachmentPath: { filePath: string; fileName: string; mimeType: string } | null
): Promise<ExportOutcome> {
  const cfg = getAbraConfig(company);
  if (!cfg) {
    return {
      status: DOCUMENT_STATUS.EXPORT_FAILED,
      errorMessage: 'ABRA Flexi connection is not configured',
    };
  }

  const isReceipt = invoice.documentType === 'receipt';

  // Receipts live in the pokladni-pohyb evidence; the invoice duplicate check
  // only covers faktura-prijata, so skip it for receipts.
  if (!isReceipt) {
    const duplicate = await findDuplicateInvoice(cfg, {
      supplierIco: invoice.supplierIco,
      variableSymbol: invoice.variableSymbol,
      invoiceNumber: invoice.invoiceNumber,
    });
    if (duplicate) {
      logger.info(
        { companyId: company.id, abraCode: duplicate.code },
        '[Pipeline] Invoice already exists in ABRA Flexi — skipping'
      );
      return {
        status: DOCUMENT_STATUS.SKIPPED_DUPLICATE,
        abraId: duplicate.id,
        abraCode: duplicate.code,
      };
    }
  }

  let defaults = EMPTY_DEFAULTS;
  let supplierCode: string | null = null;
  if (invoice.supplierIco) {
    try {
      const supplier = await findSupplierByIco(cfg, invoice.supplierIco);
      if (supplier) {
        supplierCode = supplier.code;
        defaults = await getSupplierDefaults(cfg, supplier.code);
      }
    } catch (error) {
      // Context enrichment is best-effort — export proceeds without defaults
      logger.warn(
        { companyId: company.id, error: toError(error).message },
        '[Pipeline] Failed to load supplier defaults from ABRA Flexi'
      );
    }
  }

  // Notes are surfaced to the user on an otherwise successful export (the UI
  // shows them as a non-blocking warning). They explain what was auto-adjusted
  // so a silent omission never looks like missing data.
  const notes: string[] = [];

  // AI accounting fill: history always wins (the values harvested above are
  // kept). Only when the company opted in and a field is still empty do we let
  // the model pick a code from the company's OWN číselník. The model never sees
  // hardcoded codes, and a suggestion never breaks the export (see below).
  const historyDefaults = defaults;
  const aiFilled: string[] = [];
  if (company.accountingFillMode === 'ai' && !isReceipt) {
    const merged = { ...defaults };
    const [clenDph, typUcOp, clenKonVyk] = await Promise.all([
      defaults.cleneniDph == null ? suggestClenDph(cfg, invoice).catch(() => null) : null,
      defaults.predpisZauctovani == null ? suggestTypUcOp(cfg, invoice).catch(() => null) : null,
      defaults.cleneniKonVykDph == null ? suggestClenKonVykDph(cfg, invoice).catch(() => null) : null,
    ]);
    if (clenDph) { merged.cleneniDph = clenDph; aiFilled.push(`řádek DPH „${clenDph}“`); }
    if (typUcOp) { merged.predpisZauctovani = typUcOp; aiFilled.push(`předpis zaúčtování „${typUcOp}“`); }
    if (clenKonVyk) { merged.cleneniKonVykDph = clenKonVyk; aiFilled.push(`řádek KH „${clenKonVyk}“`); }
    defaults = merged;
  }

  let result: AbraExportResult;
  if (isReceipt) {
    result = await exportReceiptToPokladna(cfg, invoice, supplierCode);
  } else {
    try {
      result = await exportPurchaseInvoice(cfg, invoice, defaults);
      if (aiFilled.length > 0) {
        notes.push(`Zaúčtování navrhla AI (${aiFilled.join(', ')}) — zkontrolujte ho v ABRA Flexi.`);
      }
    } catch (error) {
      // An AI-suggested code must never break an otherwise valid export — if ABRA
      // rejects the payload, retry once with history-only defaults and tell the user.
      if (aiFilled.length === 0) throw error;
      logger.warn(
        { companyId: company.id, aiFilled, error: toError(error).message },
        '[Pipeline] AI-suggested accounting rejected — retrying without it'
      );
      result = await exportPurchaseInvoice(cfg, invoice, historyDefaults);
      notes.push(
        `Zaúčtování navržené AI (${aiFilled.join(', ')}) ABRA odmítla — doklad byl vytvořen bez něj, ` +
          `doplňte ho prosím ručně.`
      );
    }
  }

  // smerKod is dropped from the invoice payload when the bank code is not a real
  // ČNB code (see buildInvoicePayload) — tell the user it happened. Receipts
  // never carry a smerKod, so this only applies to invoices.
  if (!isReceipt && invoice.bankCode && !isKnownCzBankCode(invoice.bankCode)) {
    notes.push(
      `Kód banky „${invoice.bankCode}“ nebyl rozpoznán v registru bank ABRA Flexi, ` +
        `proto nebyl k faktuře připojen. Číslo účtu zůstalo zachováno — kód banky ` +
        `případně doplňte v ABRA Flexi ručně.`
    );
  }

  if (attachmentPath) {
    try {
      await uploadInvoiceAttachment(
        cfg,
        result.id,
        attachmentPath.filePath,
        attachmentPath.fileName,
        attachmentPath.mimeType,
        isReceipt ? ENTITY_POKLADNI_POHYB : undefined
      );
    } catch (error) {
      // Attachment failure must never flip a successful export
      notes.push(`Doklad byl vytvořen, ale nahrání přílohy selhalo: ${toError(error).message}`);
      logger.warn(
        { companyId: company.id, abraId: result.id, error: toError(error).message },
        '[Pipeline] Attachment upload failed'
      );
    }
  }

  return {
    status: DOCUMENT_STATUS.EXPORTED,
    abraId: result.id,
    abraCode: result.code,
    abraUrl: result.webUrl,
    errorMessage: notes.length > 0 ? notes.join(' ') : null,
  };
}

/** Main pipeline entry — one incoming file from a source. */
export async function processIncomingFile(data: ProcessDocumentJobData): Promise<void> {
  const { companyId, sourceId, file } = data;
  const log = logger.child({ companyId, sourceId, fileName: file.fileName });

  try {
    const buffer = await fs.readFile(file.filePath);
    const contentHash = sha256Hex(buffer);

    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.contentHash, contentHash)))
      .limit(1);
    if (existing) {
      log.info({ documentId: existing.id }, '[Pipeline] Duplicate content — already processed, skipping');
      return;
    }

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) {
      log.warn('[Pipeline] Company no longer exists — dropping file');
      return;
    }

    const documentId = generateId('doc');
    await db.insert(documents).values({
      id: documentId,
      companyId,
      sourceId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      contentHash,
      externalRef: file.externalRef,
      status: DOCUMENT_STATUS.PROCESSING,
    });

    const extraction = await extractInvoice({
      filePath: file.filePath,
      mimeType: file.mimeType,
      fileName: file.fileName,
    });

    if (!extraction.success || !extraction.fields) {
      await db
        .update(documents)
        .set({
          status: DOCUMENT_STATUS.EXTRACTION_FAILED,
          errorMessage: extraction.error ?? 'Extraction failed',
          processedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
      log.warn({ documentId, error: extraction.error }, '[Pipeline] Extraction failed');
      return;
    }

    const invoice = extraction.fields;
    const baseFields = {
      supplierName: invoice.supplierName,
      supplierIco: invoice.supplierIco,
      invoiceNumber: invoice.invoiceNumber,
      variableSymbol: invoice.variableSymbol,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount != null ? String(invoice.totalAmount) : null,
      currency: invoice.currency,
      confidence: extraction.confidence,
      extracted: invoice,
    };

    // Received invoices and credit notes export to faktura-prijata; receipts
    // (účtenky) export to the cash register (pokladni-pohyb). Everything else
    // (orders, delivery notes, …) is skipped.
    const exportable =
      invoice.isInvoice ||
      invoice.documentType === 'credit_note' ||
      invoice.documentType === 'receipt';
    if (!exportable) {
      await db
        .update(documents)
        .set({ ...baseFields, status: DOCUMENT_STATUS.SKIPPED_NOT_INVOICE, processedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
      log.info({ documentId, documentType: invoice.documentType }, '[Pipeline] Not a purchase invoice — skipped');
      return;
    }

    let outcome: ExportOutcome;
    try {
      outcome = await runAbraExport(company, invoice, {
        filePath: file.filePath,
        fileName: file.fileName,
        mimeType: file.mimeType,
      });
    } catch (error) {
      outcome = {
        status: DOCUMENT_STATUS.EXPORT_FAILED,
        errorMessage: toError(error).message,
      };
    }

    await db
      .update(documents)
      .set({
        ...baseFields,
        status: outcome.status,
        errorMessage: outcome.errorMessage ?? null,
        abraId: outcome.abraId ?? null,
        abraCode: outcome.abraCode ?? null,
        abraUrl: outcome.abraUrl ?? null,
        processedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));

    log.info(
      { documentId, status: outcome.status, abraCode: outcome.abraCode, confidence: extraction.confidence },
      '[Pipeline] Document processed'
    );
  } finally {
    await safeUnlink(file.filePath);
  }
}

/** Retry path — re-export from stored extracted data (file no longer exists). */
export async function retryExport(documentId: string, companyId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)))
    .limit(1);
  if (!row || !row.extracted) return;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return;

  let outcome: ExportOutcome;
  try {
    outcome = await runAbraExport(company, row.extracted, null);
    if (outcome.status === DOCUMENT_STATUS.EXPORTED && !outcome.errorMessage) {
      // Original file is gone on retry — note the missing attachment
      outcome.errorMessage = null;
    }
  } catch (error) {
    outcome = { status: DOCUMENT_STATUS.EXPORT_FAILED, errorMessage: toError(error).message };
  }

  await db
    .update(documents)
    .set({
      status: outcome.status,
      errorMessage: outcome.errorMessage ?? null,
      abraId: outcome.abraId ?? row.abraId,
      abraCode: outcome.abraCode ?? row.abraCode,
      abraUrl: outcome.abraUrl ?? row.abraUrl,
      processedAt: new Date(),
    })
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));

  logger.info({ documentId, companyId, status: outcome.status }, '[Pipeline] Export retry finished');
}
