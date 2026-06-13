/**
 * Monthly subscription invoicing: compute the prior month's charge per active
 * company, render a PDF and e-mail it (with a copy to the supplier). Foldera's
 * billing is a non-VAT sole trader, so invoices carry no VAT.
 */
import path from 'node:path';

import PDFDocument from 'pdfkit';
import { and, eq, like } from 'drizzle-orm';

import env from '../config/env.js';
import { db } from '../db/client.js';
import {
  companies,
  invoices,
  monthlyUsage,
  users,
  type Company,
  type Invoice,
  type InvoiceLine,
} from '../db/schema/index.js';
import { generateId } from '../utils/ids.js';
import { sendMail } from '../utils/email.js';
import { logger } from '../utils/logger.js';
import { toError } from '../utils/errors.js';
import { INCLUDED_DOCS, OVERAGE_CZK, PLAN_PRICE_CZK, currentPeriod } from './billing.js';
import { lookupAres } from './ares.js';

const FONT_PATH = path.resolve(process.cwd(), 'assets', 'DejaVuSans.ttf');

/** 'YYYY-MM' of the month before `date`. */
function priorPeriod(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Next sequential 'YYYYNNNN' invoice number for the current year. */
async function nextInvoiceNumber(): Promise<string> {
  const year = String(new Date().getUTCFullYear());
  const rows = await db.select({ number: invoices.number }).from(invoices).where(like(invoices.number, `${year}%`));
  const maxN = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(4)) || 0), 0);
  return `${year}${String(maxN + 1).padStart(4, '0')}`;
}

interface InvoiceData {
  number: string;
  issueDate: string;
  dueDate: string;
  variableSymbol: string;
  customerName: string;
  customerIco: string | null;
  customerAddress: string | null;
  lines: InvoiceLine[];
  totalCzk: number;
}

function buildPdf(data: InvoiceData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.registerFont('dv', FONT_PATH);
  doc.font('dv');

  const left = 50;
  const right = 545;

  doc.fontSize(20).text(`Faktura č. ${data.number}`, left, 50);
  doc.fontSize(9).fillColor('#555').text('Daňový doklad (neplátce DPH)', left, 78);
  doc.fillColor('#000');

  // Supplier / customer columns
  const topY = 110;
  doc.fontSize(9).fillColor('#777').text('DODAVATEL', left, topY);
  doc.fillColor('#000').fontSize(10);
  doc.text(env.BILLING_SUPPLIER_NAME, left, topY + 14);
  doc.text(env.BILLING_SUPPLIER_ADDRESS, left, topY + 28);
  doc.text(`IČO: ${env.BILLING_SUPPLIER_ICO}`, left, topY + 42);
  doc.text('Neplátce DPH', left, topY + 56);
  doc.text(env.BILLING_SUPPLIER_EMAIL, left, topY + 70);

  const colX = 320;
  doc.fontSize(9).fillColor('#777').text('ODBĚRATEL', colX, topY);
  doc.fillColor('#000').fontSize(10);
  doc.text(data.customerName, colX, topY + 14);
  if (data.customerAddress) doc.text(data.customerAddress, colX, topY + 28, { width: right - colX });
  if (data.customerIco) doc.text(`IČO: ${data.customerIco}`, colX, topY + 56);

  // Meta
  const metaY = topY + 100;
  doc.fontSize(10);
  doc.text(`Datum vystavení: ${data.issueDate}`, left, metaY);
  doc.text(`Datum splatnosti: ${data.dueDate}`, left, metaY + 14);
  doc.text(`Variabilní symbol: ${data.variableSymbol}`, left, metaY + 28);
  doc.text(`Bankovní účet: ${env.BILLING_SUPPLIER_BANK}`, left, metaY + 42);
  if (env.BILLING_SUPPLIER_IBAN) doc.text(`IBAN: ${env.BILLING_SUPPLIER_IBAN}`, left, metaY + 56);

  // Line items table
  let y = metaY + 90;
  doc.fontSize(9).fillColor('#777');
  doc.text('Popis', left, y);
  doc.text('Množství', 330, y, { width: 60, align: 'right' });
  doc.text('Cena', 400, y, { width: 60, align: 'right' });
  doc.text('Celkem', 465, y, { width: 80, align: 'right' });
  doc.moveTo(left, y + 14).lineTo(right, y + 14).strokeColor('#ccc').stroke();
  doc.fillColor('#000').fontSize(10);
  y += 22;
  for (const ln of data.lines) {
    doc.text(ln.description, left, y, { width: 270 });
    doc.text(String(ln.quantity), 330, y, { width: 60, align: 'right' });
    doc.text(`${ln.unitPriceCzk} Kč`, 400, y, { width: 60, align: 'right' });
    doc.text(`${ln.amountCzk} Kč`, 465, y, { width: 80, align: 'right' });
    y += 20;
  }
  doc.moveTo(left, y + 4).lineTo(right, y + 4).strokeColor('#ccc').stroke();
  doc.fontSize(13).text('Celkem k úhradě:', 300, y + 14, { width: 165, align: 'right' });
  doc.text(`${data.totalCzk} Kč`, 465, y + 14, { width: 80, align: 'right' });

  doc
    .fontSize(8)
    .fillColor('#777')
    .text(
      `Nejsem plátce DPH. Úhradu zašlete na účet ${env.BILLING_SUPPLIER_BANK}, variabilní symbol ${data.variableSymbol}.`,
      left,
      y + 60,
      { width: right - left }
    );

  doc.end();
  return done;
}

/** Build, persist and e-mail the invoice for one company + period. */
export async function generateInvoiceFor(company: Company, period: string): Promise<Invoice | null> {
  const [usageRow] = await db
    .select({ used: monthlyUsage.docCount })
    .from(monthlyUsage)
    .where(and(eq(monthlyUsage.companyId, company.id), eq(monthlyUsage.period, period)))
    .limit(1);
  const used = usageRow?.used ?? 0;
  const overage = Math.max(0, used - INCLUDED_DOCS);

  const lines: InvoiceLine[] = [
    { description: `Předplatné Foldera – ${period}`, quantity: 1, unitPriceCzk: PLAN_PRICE_CZK, amountCzk: PLAN_PRICE_CZK },
  ];
  if (overage > 0) {
    lines.push({
      description: `Doklady nad rámec (${INCLUDED_DOCS} v ceně) – ${period}`,
      quantity: overage,
      unitPriceCzk: OVERAGE_CZK,
      amountCzk: overage * OVERAGE_CZK,
    });
  }
  const totalCzk = lines.reduce((s, l) => s + l.amountCzk, 0);

  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, company.userId)).limit(1);
  const recipientEmail = owner?.email;
  if (!recipientEmail) {
    logger.warn({ companyId: company.id }, '[Invoicing] No owner e-mail — skipping invoice');
    return null;
  }

  const number = await nextInvoiceNumber();
  const now = new Date();
  const issueDate = isoDate(now);
  const dueDate = isoDate(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));
  const variableSymbol = number;

  // Customer details from ARES (best-effort).
  const ares = company.ico ? await lookupAres(company.ico) : null;
  const customerAddress = ares?.fullAddress ?? null;

  const id = generateId('inv');
  let status: 'sent' | 'failed' = 'sent';
  let errorMessage: string | null = null;
  try {
    const pdf = await buildPdf({
      number,
      issueDate,
      dueDate,
      variableSymbol,
      customerName: company.name,
      customerIco: company.ico,
      customerAddress,
      lines,
      totalCzk,
    });
    await sendMail({
      to: recipientEmail,
      bcc: env.BILLING_INVOICE_BCC,
      subject: `Foldera – faktura ${number} (${period})`,
      html: `<p>Dobrý den,</p><p>v příloze posíláme fakturu č. <b>${number}</b> za předplatné Foldera za období ${period}.</p><p>Částka k úhradě: <b>${totalCzk} Kč</b>, splatnost ${dueDate}, variabilní symbol ${variableSymbol}.</p><p>Děkujeme, Foldera.</p>`,
      text: `Faktura ${number} za období ${period}. K úhradě ${totalCzk} Kč, splatnost ${dueDate}, VS ${variableSymbol}.`,
      attachments: [{ filename: `faktura-${number}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
  } catch (error) {
    status = 'failed';
    errorMessage = toError(error).message;
    logger.error({ companyId: company.id, number, error: errorMessage }, '[Invoicing] Failed to send invoice');
  }

  const [row] = await db
    .insert(invoices)
    .values({
      id,
      companyId: company.id,
      number,
      period,
      issueDate,
      dueDate,
      variableSymbol,
      customerName: company.name,
      customerIco: company.ico,
      customerAddress,
      recipientEmail,
      overageDocs: overage,
      totalCzk,
      lineItems: lines,
      status,
      errorMessage,
    })
    .returning();
  logger.info({ companyId: company.id, number, totalCzk, status }, '[Invoicing] Invoice issued');
  return row ?? null;
}

/** Issue invoices for the prior month to every eligible active company. */
export async function runMonthlyInvoicing(): Promise<void> {
  if (!env.BILLING_INVOICE_ENABLED) return;
  const period = priorPeriod();
  const active = await db.select().from(companies).where(eq(companies.billingStatus, 'active'));
  for (const company of active) {
    // Only bill companies that were already subscribed during the prior month.
    if (!company.subscriptionStartedAt || currentPeriod(company.subscriptionStartedAt) > period) continue;
    const [existing] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.companyId, company.id), eq(invoices.period, period)))
      .limit(1);
    if (existing) continue;
    try {
      await generateInvoiceFor(company, period);
    } catch (error) {
      logger.error(
        { companyId: company.id, period, error: toError(error).message },
        '[Invoicing] generateInvoiceFor threw'
      );
    }
  }
}
