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
import { buildPaymentQrPng, toCzechIban } from './payment-qr.js';
import { buildIsdocXml } from './isdoc.js';

const FONT_PATH = path.resolve(process.cwd(), 'assets', 'DejaVuSans.ttf');
const ACCENT = '#6d28d9';
const INK = '#0b0b10';
const MUTED = '#71717a';
const LINE = '#e4e4e7';

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

export async function buildPdf(data: InvoiceData): Promise<Buffer> {
  const left = 50;
  const right = 545;
  const fmt = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;

  const qrPng = await buildPaymentQrPng({
    account: env.BILLING_SUPPLIER_BANK,
    amountCzk: data.totalCzk,
    variableSymbol: data.variableSymbol,
    message: `Foldera ${data.number}`,
    recipientName: env.BILLING_SUPPLIER_NAME,
  });

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.registerFont('dv', FONT_PATH);
  doc.font('dv');

  // ── Header band ──────────────────────────────────────────────────────────
  doc.rect(0, 0, 595, 96).fill(ACCENT);
  doc.fillColor('#ffffff').fontSize(22).text('Foldera', left, 30);
  doc.fontSize(9).fillColor('#ede9fe').text('Automatizace faktur do účetnictví', left, 58);
  doc.fontSize(20).fillColor('#ffffff').text(`Faktura ${data.number}`, 0, 30, { width: right, align: 'right' });
  doc.fontSize(9).fillColor('#ede9fe').text('Daňový doklad — neplátce DPH', 0, 60, { width: right, align: 'right' });
  doc.fillColor(INK);

  // ── Supplier / customer ─────────────────────────────────────────────────
  const topY = 130;
  const colX = 320;
  doc.fontSize(8).fillColor(MUTED).text('DODAVATEL', left, topY);
  doc.fontSize(8).fillColor(MUTED).text('ODBĚRATEL', colX, topY);
  doc.fillColor(INK).fontSize(11).text(env.BILLING_SUPPLIER_NAME, left, topY + 13);
  doc.fontSize(9).fillColor('#3f3f46');
  doc.text(env.BILLING_SUPPLIER_ADDRESS, left, topY + 30, { width: colX - left - 20 });
  doc.text(`IČO: ${env.BILLING_SUPPLIER_ICO}`, left, topY + 46);
  doc.text('Neplátce DPH', left, topY + 60);
  doc.text(env.BILLING_SUPPLIER_EMAIL, left, topY + 74);

  doc.fillColor(INK).fontSize(11).text(data.customerName, colX, topY + 13, { width: right - colX });
  doc.fontSize(9).fillColor('#3f3f46');
  let cy = topY + 30;
  if (data.customerAddress) {
    doc.text(data.customerAddress, colX, cy, { width: right - colX });
    cy = doc.y + 2;
  }
  if (data.customerIco) doc.text(`IČO: ${data.customerIco}`, colX, cy);

  // ── Meta strip ──────────────────────────────────────────────────────────
  const metaY = topY + 104;
  doc.roundedRect(left, metaY, right - left, 30, 4).fill('#f4f4f5');
  doc.fillColor(MUTED).fontSize(8);
  const cells = [
    ['Vystaveno', data.issueDate],
    ['Splatnost', data.dueDate],
    ['Var. symbol', data.variableSymbol],
    ['Účet', env.BILLING_SUPPLIER_BANK],
  ];
  const cellW = (right - left) / cells.length;
  cells.forEach(([label, value], i) => {
    const x = left + i * cellW + 10;
    doc.fillColor(MUTED).fontSize(7).text((label ?? '').toUpperCase(), x, metaY + 6);
    doc.fillColor(INK).fontSize(9).text(value ?? '', x, metaY + 16);
  });

  // ── Line items table ────────────────────────────────────────────────────
  let y = metaY + 52;
  doc.fontSize(8).fillColor(MUTED);
  doc.text('POPIS', left, y);
  doc.text('MNOŽSTVÍ', 320, y, { width: 60, align: 'right' });
  doc.text('CENA', 390, y, { width: 70, align: 'right' });
  doc.text('CELKEM', 465, y, { width: 80, align: 'right' });
  y += 14;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(ACCENT).stroke();
  y += 8;
  doc.fontSize(10);
  for (const ln of data.lines) {
    doc.fillColor(INK).text(ln.description, left, y, { width: 260 });
    const rowH = doc.y - y;
    doc.fillColor('#3f3f46');
    doc.text(String(ln.quantity), 320, y, { width: 60, align: 'right' });
    doc.text(fmt(ln.unitPriceCzk), 390, y, { width: 70, align: 'right' });
    doc.fillColor(INK).text(fmt(ln.amountCzk), 465, y, { width: 80, align: 'right' });
    y += Math.max(rowH, 14) + 8;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // ── Total box ───────────────────────────────────────────────────────────
  y += 6;
  doc.roundedRect(320, y, right - 320, 40, 4).fill(ACCENT);
  doc.fillColor('#ede9fe').fontSize(9).text('CELKEM K ÚHRADĚ', 330, y + 9);
  doc.fillColor('#ffffff').fontSize(18).text(fmt(data.totalCzk), 320, y + 19, { width: right - 320 - 10, align: 'right' });

  // ── QR platba ───────────────────────────────────────────────────────────
  const qrY = y;
  if (qrPng) {
    doc.image(qrPng, left, qrY, { width: 92, height: 92 });
    doc.fillColor(INK).fontSize(9).text('QR platba', left + 102, qrY + 8);
    doc.fillColor(MUTED).fontSize(8).text('Naskenujte v bankovní aplikaci', left + 102, qrY + 22, { width: 150 });
    const iban = toCzechIban(env.BILLING_SUPPLIER_BANK);
    if (iban) doc.fillColor('#3f3f46').fontSize(7).text(iban, left + 102, qrY + 44, { width: 160 });
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .text(
      `Nejsem plátce DPH. Úhradu zašlete na účet ${env.BILLING_SUPPLIER_BANK} pod variabilním symbolem ${data.variableSymbol}. ` +
        `Součástí e-mailu je elektronická faktura ve formátu ISDOC pro snadný import do účetnictví.`,
      left,
      qrY + 110,
      { width: right - left }
    );
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .text(`Foldera · ${env.BILLING_SUPPLIER_EMAIL} · IČO ${env.BILLING_SUPPLIER_ICO}`, left, 770, {
      width: right - left,
      align: 'center',
      lineBreak: false,
    });

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
    const isdocXml = buildIsdocXml({
      number,
      issueDate,
      dueDate,
      variableSymbol,
      supplier: {
        name: env.BILLING_SUPPLIER_NAME,
        ico: env.BILLING_SUPPLIER_ICO,
        address: env.BILLING_SUPPLIER_ADDRESS,
        email: env.BILLING_SUPPLIER_EMAIL,
        iban: toCzechIban(env.BILLING_SUPPLIER_BANK),
        account: env.BILLING_SUPPLIER_BANK,
      },
      customer: { name: company.name, ico: company.ico, address: customerAddress },
      lines: lines.map((l, i) => ({
        id: i + 1,
        description: l.description,
        quantity: l.quantity,
        unitPriceCzk: l.unitPriceCzk,
        amountCzk: l.amountCzk,
      })),
      totalCzk,
    });
    await sendMail({
      to: recipientEmail,
      bcc: env.BILLING_INVOICE_BCC,
      subject: `Foldera – faktura ${number} (${period})`,
      html: `<p>Dobrý den,</p><p>v příloze posíláme fakturu č. <b>${number}</b> za předplatné Foldera za období ${period}.</p><p>Částka k úhradě: <b>${totalCzk} Kč</b>, splatnost ${dueDate}, variabilní symbol ${variableSymbol}.</p><p>Fakturu přikládáme i ve formátu <b>ISDOC</b> pro snadný import do účetnictví. V PDF najdete QR platbu.</p><p>Děkujeme, Foldera.</p>`,
      text: `Faktura ${number} za období ${period}. K úhradě ${totalCzk} Kč, splatnost ${dueDate}, VS ${variableSymbol}.`,
      attachments: [
        { filename: `faktura-${number}.pdf`, content: pdf, contentType: 'application/pdf' },
        { filename: `faktura-${number}.isdoc`, content: Buffer.from(isdocXml, 'utf8'), contentType: 'application/xml' },
      ],
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
