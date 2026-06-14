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

import { and, desc, eq, sql } from 'drizzle-orm';

import env from '../config/env.js';
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
import { blockMessage, decideBilling, recordDocumentUsage } from '../services/billing.js';
import { notifyBankReview, notifyDocumentFailure } from '../services/notifications.js';
import { extractInvoice } from '../services/extraction/index.js';
import { summarizeLineItems } from '../services/extraction/summarize.js';
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
  attachmentPath: { filePath: string; fileName: string; mimeType: string } | null,
  originalEmail: { filePath: string; fileName: string } | null = null
): Promise<ExportOutcome> {
  const cfg = getAbraConfig(company);
  if (!cfg) {
    return {
      status: DOCUMENT_STATUS.EXPORT_FAILED,
      errorMessage: 'ABRA Flexi connection is not configured',
    };
  }

  const docType = invoice.documentType;
  const isReceipt = docType === 'receipt';
  const isAdvance = docType === 'advance_invoice'; // zálohová faktura
  const isTaxPayment = docType === 'tax_payment'; // daňový doklad k přijaté platbě (DDPP)

  // Zálohové faktury i DDPP se zakládají do faktura-prijata, jen s vlastním typem
  // dokladu (Foldera podtyp pozná z dokladu; typ je konfigurovaný default).
  const exportOptions: { typDokl?: string } = isAdvance
    ? { typDokl: env.ABRA_DEFAULT_TYP_ZALOHA }
    : isTaxPayment
      ? { typDokl: env.ABRA_DEFAULT_TYP_DDPP }
      : {};
  const attachEntity = isReceipt ? ENTITY_POKLADNI_POHYB : undefined;

  // The duplicate check only covers regular faktura-prijata — skip it for
  // receipts (pokladna) and zálohové faktury (different document class).
  if (!isReceipt && !isAdvance) {
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
        // Zálohové faktury / DDPP have their own účtování — never apply the
        // předkontace / členění DPH harvested from the supplier's regular
        // invoices (ABRA rejects it on those document types).
        if (!isAdvance && !isTaxPayment) {
          defaults = await getSupplierDefaults(cfg, supplier.code);
        }
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
  if (company.accountingFillMode === 'ai' && !isAdvance && !isTaxPayment) {
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

  // Export the document (invoice → faktura-prijata, receipt → pokladni-pohyb)
  // with the given accounting defaults.
  const doExport = (d: AbraSupplierDefaults): Promise<AbraExportResult> =>
    isReceipt
      ? exportReceiptToPokladna(cfg, invoice, supplierCode, d)
      : exportPurchaseInvoice(cfg, invoice, d, exportOptions);

  let result: AbraExportResult;
  try {
    result = await doExport(defaults);
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
    result = await doExport(historyDefaults);
    notes.push(
      `Zaúčtování navržené AI (${aiFilled.join(', ')}) ABRA odmítla — doklad byl vytvořen bez něj, ` +
        `doplňte ho prosím ručně.`
    );
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
        attachEntity
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

  // Optionally attach the original e-mail (.eml) alongside the invoice file.
  if (originalEmail) {
    try {
      await uploadInvoiceAttachment(
        cfg,
        result.id,
        originalEmail.filePath,
        originalEmail.fileName,
        'message/rfc822',
        attachEntity
      );
    } catch (error) {
      notes.push(`Originální e-mail se nepodařilo přiložit: ${toError(error).message}`);
      logger.warn(
        { companyId: company.id, abraId: result.id, error: toError(error).message },
        '[Pipeline] Original e-mail attachment failed'
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
/** Normalize a bank identifier for comparison (strip punctuation, uppercase). */
function normBank(s: string | null | undefined): string {
  return (s ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Anti-fraud control against invoice-payment redirection. Returns a Czech reason
 * string when the payee bank account should be HELD for admin approval — a new
 * supplier carrying a bank account, or a known supplier whose IBAN/account
 * differs from their last approved (exported) document — else null. Receipts
 * (cash) and documents with no bank details are exempt.
 */
async function reviewBankAccount(companyId: string, invoice: ExtractedInvoice): Promise<string | null> {
  if (invoice.documentType === 'receipt') return null;
  const curIban = invoice.iban ? normBank(invoice.iban) : '';
  const curAcct = invoice.bankAccount ? normBank(`${invoice.bankAccount}${invoice.bankCode ?? ''}`) : '';
  const shown = invoice.iban || (invoice.bankAccount ? `${invoice.bankAccount}${invoice.bankCode ? '/' + invoice.bankCode : ''}` : '');
  if (!curIban && !curAcct) return null; // no payee bank → nothing to redirect

  if (!invoice.supplierIco) {
    return `Doklad bez IČO dodavatele s bankovním účtem ${shown}. Ověřte příjemce platby.`;
  }

  const [prev] = await db
    .select({ extracted: documents.extracted })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.status, DOCUMENT_STATUS.EXPORTED),
        sql`${documents.extracted}->>'supplierIco' = ${invoice.supplierIco}`,
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  if (!prev?.extracted) {
    return `První doklad od dodavatele (IČO ${invoice.supplierIco}); bankovní účet ${shown} zatím nebyl ověřen.`;
  }

  const p = prev.extracted as ExtractedInvoice;
  // Compare like-for-like; flag only a definite mismatch (avoids cross-format noise).
  if (curIban && p.iban && curIban !== normBank(p.iban)) {
    return `IBAN dodavatele se změnil: dříve ${p.iban}, nyní ${invoice.iban}. Ověřte před platbou.`;
  }
  if (curAcct && p.bankAccount && curAcct !== normBank(`${p.bankAccount}${p.bankCode ?? ''}`)) {
    return `Bankovní účet dodavatele se změnil: dříve ${p.bankAccount}${p.bankCode ? '/' + p.bankCode : ''}, nyní ${shown}. Ověřte před platbou.`;
  }
  return null;
}

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

    // Billing gate — block BEFORE spending OCR when the trial/plan limit is hit.
    // Usage is only counted later, when the document is actually exported.
    const decision = decideBilling(company);
    if (!decision.allowed) {
      await db
        .update(documents)
        .set({
          status: DOCUMENT_STATUS.SKIPPED_LIMIT,
          errorMessage: blockMessage(decision.reason!),
          processedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
      log.info({ documentId, reason: decision.reason }, '[Pipeline] Skipped — billing limit reached');
      return;
    }

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
      await notifyDocumentFailure(company, {
        fileName: file.fileName,
        phase: 'processing',
        errorMessage: extraction.error ?? 'Doklad se nepodařilo přečíst.',
      });
      return;
    }

    const invoice = extraction.fields;

    // Company opted into "souhrnně": collapse line items into one per VAT rate
    // before the record is persisted/exported. The grand total is preserved.
    if (company.lineItemMode === 'summary' && invoice.lineItems.length > 1) {
      const before = invoice.lineItems.length;
      invoice.lineItems = summarizeLineItems(invoice.lineItems, invoice);
      log.info({ documentId, before, after: invoice.lineItems.length }, '[Pipeline] Line items summarized by VAT rate');
    }

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
      invoice.documentType === 'receipt' ||
      invoice.documentType === 'advance_invoice' ||
      invoice.documentType === 'tax_payment';
    if (!exportable) {
      await db
        .update(documents)
        .set({ ...baseFields, status: DOCUMENT_STATUS.SKIPPED_NOT_INVOICE, processedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
      log.info({ documentId, documentType: invoice.documentType }, '[Pipeline] Not a purchase invoice — skipped');
      return;
    }

    // Attach the original e-mail to the ABRA doc when the company opted in and
    // the document came from an e-mail source (.eml captured by the poller).
    const originalEmail =
      company.attachOriginalEmail && file.originalEmailPath
        ? { filePath: file.originalEmailPath, fileName: `puvodni-email-${invoice.variableSymbol ?? invoice.invoiceNumber ?? 'doklad'}.eml` }
        : null;

    // Anti-fraud: hold for admin approval when the payee bank account is new or
    // changed for this supplier (invoice-redirection protection).
    const reviewReason = await reviewBankAccount(companyId, invoice);
    if (reviewReason) {
      await db
        .update(documents)
        .set({ ...baseFields, status: DOCUMENT_STATUS.NEEDS_REVIEW, errorMessage: reviewReason, processedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
      log.warn({ documentId, supplierIco: invoice.supplierIco }, '[Pipeline] Held for bank-account review');
      await notifyBankReview(company, { fileName: file.fileName, supplierName: invoice.supplierName, reason: reviewReason });
      return;
    }

    let outcome: ExportOutcome;
    try {
      outcome = await runAbraExport(
        company,
        invoice,
        { filePath: file.filePath, fileName: file.fileName, mimeType: file.mimeType },
        originalEmail
      );
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

    // Count usage only for documents actually sent to ABRA Flexi. Duplicates,
    // non-invoices and failed exports are free.
    if (outcome.status === DOCUMENT_STATUS.EXPORTED) {
      await recordDocumentUsage(company);
    } else if (outcome.status === DOCUMENT_STATUS.EXPORT_FAILED) {
      await notifyDocumentFailure(company, {
        fileName: file.fileName,
        supplierName: invoice.supplierName,
        totalAmount: baseFields.totalAmount,
        currency: invoice.currency,
        phase: 'export',
        errorMessage: outcome.errorMessage,
      });
    }

    log.info(
      { documentId, status: outcome.status, abraCode: outcome.abraCode, confidence: extraction.confidence },
      '[Pipeline] Document processed'
    );
  } finally {
    await safeUnlink(file.filePath);
    if (file.originalEmailPath) await safeUnlink(file.originalEmailPath);
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

  // A retry that now succeeds is the first time this document reaches ABRA — count it.
  if (outcome.status === DOCUMENT_STATUS.EXPORTED) {
    await recordDocumentUsage(company);
  } else if (outcome.status === DOCUMENT_STATUS.EXPORT_FAILED) {
    await notifyDocumentFailure(company, {
      fileName: row.fileName,
      supplierName: row.supplierName,
      totalAmount: row.totalAmount,
      currency: row.currency,
      phase: 'export',
      errorMessage: outcome.errorMessage,
    });
  }

  logger.info({ documentId, companyId, status: outcome.status }, '[Pipeline] Export retry finished');
}
