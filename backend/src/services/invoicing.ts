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
import { INCLUDED_DOCS, OVERAGE_CZK, PLAN_PRICE_CZK, completedBillingPeriod } from './billing.js';
import { lookupAres } from './ares.js';
import { buildPaymentQrPng, toCzechIban } from './payment-qr.js';
import { buildIsdocXml } from './isdoc.js';

const ASSETS = path.resolve(process.cwd(), 'assets');
const FONT_REG = path.join(ASSETS, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(ASSETS, 'DejaVuSans-Bold.ttf');
const FONT_MONO = path.join(ASSETS, 'DejaVuSansMono.ttf');
const ACCENT = '#6d28d9';
const INK = '#0b0b10';
const MUTED = '#9b9ba6';
const BODY = '#52525b';
const LINE = '#e7e7ea';

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

export async function buildPdf(data: InvoiceData, isdocXml?: string): Promise<Buffer> {
  const left = 48;
  const right = 547;
  const W = right - left;
  const fmt = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;
  const iban = toCzechIban(env.BILLING_SUPPLIER_BANK);

  const qrPng = await buildPaymentQrPng({
    account: env.BILLING_SUPPLIER_BANK,
    amountCzk: data.totalCzk,
    variableSymbol: data.variableSymbol,
    message: `Foldera ${data.number}`,
    recipientName: env.BILLING_SUPPLIER_NAME,
  });

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.registerFont('reg', FONT_REG);
  doc.registerFont('bold', FONT_BOLD);
  doc.registerFont('mono', FONT_MONO);

  /** Monospace, letter-spaced uppercase micro-label — the signature element. */
  const kicker = (text: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions = {}) => {
    doc.font('mono').fontSize(7).fillColor(MUTED).text(text.toUpperCase(), x, y, { characterSpacing: 1.4, ...opts });
  };

  // ── Masthead ──────────────────────────────────────────────────────────────
  doc.font('bold').fontSize(27).fillColor(INK).text('Foldera', left, 50, { continued: true });
  doc.fillColor(ACCENT).text('.');
  kicker('Fakturace · neplátce DPH', left, 84);

  kicker('Faktura — daňový doklad', left, 52, { width: W, align: 'right' });
  doc.font('bold').fontSize(21).fillColor(INK).text(`č. ${data.number}`, left, 64, { width: W, align: 'right' });

  doc.moveTo(left, 106).lineTo(right, 106).lineWidth(2).strokeColor(ACCENT).stroke();

  // ── Parties ────────────────────────────────────────────────────────────────
  const py = 128;
  const colB = 312;
  kicker('Dodavatel', left, py);
  kicker('Odběratel', colB, py);

  doc.font('bold').fontSize(12).fillColor(INK).text(env.BILLING_SUPPLIER_NAME, left, py + 14, { width: colB - left - 16 });
  doc.font('reg').fontSize(9).fillColor(BODY);
  doc.text(env.BILLING_SUPPLIER_ADDRESS, left, py + 32, { width: colB - left - 16 });
  doc.text(`IČO ${env.BILLING_SUPPLIER_ICO} · neplátce DPH`, left, py + 46);
  doc.text(env.BILLING_SUPPLIER_EMAIL, left, py + 60);

  doc.font('bold').fontSize(12).fillColor(INK).text(data.customerName, colB, py + 14, { width: right - colB });
  doc.font('reg').fontSize(9).fillColor(BODY);
  let cy = py + 32;
  if (data.customerAddress) {
    doc.text(data.customerAddress, colB, cy, { width: right - colB });
    cy = doc.y + 2;
  }
  if (data.customerIco) doc.text(`IČO ${data.customerIco}`, colB, cy);

  // ── Meta row (hairline framed) ──────────────────────────────────────────────
  const my = py + 92;
  doc.moveTo(left, my).lineTo(right, my).lineWidth(0.75).strokeColor(LINE).stroke();
  const cells: [string, string][] = [
    ['Vystaveno', data.issueDate],
    ['Splatnost', data.dueDate],
    ['Var. symbol', data.variableSymbol],
    ['Účet', env.BILLING_SUPPLIER_BANK],
  ];
  const cw = W / cells.length;
  cells.forEach(([label, value], i) => {
    const x = left + i * cw;
    kicker(label, x, my + 12);
    doc.font('bold').fontSize(10).fillColor(INK).text(value, x, my + 24, { width: cw - 8 });
  });
  doc.moveTo(left, my + 48).lineTo(right, my + 48).lineWidth(0.75).strokeColor(LINE).stroke();

  // ── Line items ──────────────────────────────────────────────────────────────
  let y = my + 70;
  kicker('Popis', left, y);
  kicker('Množství', 318, y, { width: 62, align: 'right' });
  kicker('Cena', 392, y, { width: 70, align: 'right' });
  kicker('Celkem', 467, y, { width: 80, align: 'right' });
  y += 13;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();
  y += 10;
  for (const ln of data.lines) {
    doc.font('reg').fontSize(10).fillColor(INK).text(ln.description, left, y, { width: 250 });
    const rowH = doc.y - y;
    doc.fillColor(BODY);
    doc.text(String(ln.quantity), 318, y, { width: 62, align: 'right' });
    doc.text(fmt(ln.unitPriceCzk), 392, y, { width: 70, align: 'right' });
    doc.font('bold').fillColor(INK).text(fmt(ln.amountCzk), 467, y, { width: 80, align: 'right' });
    y += Math.max(rowH, 14) + 9;
    doc.moveTo(left, y - 5).lineTo(right, y - 5).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // ── Total — oversized focal figure ──────────────────────────────────────────
  y += 14;
  kicker('Celkem k úhradě', left, y, { width: W, align: 'right' });
  doc.font('bold').fontSize(38).fillColor(ACCENT).text(fmt(data.totalCzk), left, y + 12, { width: W, align: 'right' });
  const totalBottom = y + 12 + 44;

  // ── QR platba (framed) ───────────────────────────────────────────────────────
  if (qrPng) {
    const qy = y + 6;
    doc.roundedRect(left, qy, 78, 78, 6).lineWidth(1).strokeColor(LINE).stroke();
    doc.image(qrPng, left + 6, qy + 6, { width: 66, height: 66 });
    kicker('QR platba', left + 92, qy + 8);
    doc.font('reg').fontSize(8.5).fillColor(BODY).text('Naskenujte v bankovní aplikaci', left + 92, qy + 22, { width: 170 });
    if (iban) doc.font('mono').fontSize(8).fillColor(INK).text(iban, left + 92, qy + 42, { width: 200, characterSpacing: 0.5 });
  }

  // ── Footer (pinned) ──────────────────────────────────────────────────────────
  const fy = Math.max(totalBottom + 40, 720);
  doc.moveTo(left, fy).lineTo(right, fy).lineWidth(0.75).strokeColor(LINE).stroke();
  doc.font('reg').fontSize(8).fillColor(MUTED).text(
    `Neplátce DPH. Úhradu zašlete na účet ${env.BILLING_SUPPLIER_BANK}, variabilní symbol ${data.variableSymbol}. ` +
      `K e-mailu je přiložena elektronická faktura (ISDOC) pro import do účetnictví.`,
    left,
    fy + 10,
    { width: W }
  );
  kicker(`Foldera · ${env.BILLING_SUPPLIER_EMAIL} · IČO ${env.BILLING_SUPPLIER_ICO}`, left, Math.min(fy + 48, 778), {
    width: W,
    align: 'center',
    lineBreak: false,
  });

  // Embed the ISDOC XML directly inside the PDF — one clean hybrid file that is
  // both human-readable and machine-importable (like ZUGFeRD / Factur-X). Czech
  // accounting software detects the embedded .isdoc and imports it.
  if (isdocXml) {
    (doc as unknown as {
      file(src: Buffer, options: { name: string; type?: string; description?: string }): void;
    }).file(Buffer.from(isdocXml, 'utf8'), {
      name: `faktura-${data.number}.isdoc`,
      type: 'application/xml',
      description: `ISDOC faktura ${data.number}`,
    });
  }

  doc.end();
  return done;
}

/** Build, persist and e-mail the invoice for one company + period. */
export async function generateInvoiceFor(
  company: Company,
  period: string,
  periodStart?: Date,
  periodEnd?: Date
): Promise<Invoice | null> {
  const [usageRow] = await db
    .select({ used: monthlyUsage.docCount })
    .from(monthlyUsage)
    .where(and(eq(monthlyUsage.companyId, company.id), eq(monthlyUsage.period, period)))
    .limit(1);
  const used = usageRow?.used ?? 0;
  const overage = Math.max(0, used - INCLUDED_DOCS);

  // Human label for the billed period, e.g. "29. 6. – 28. 7. 2026".
  const label =
    periodStart && periodEnd
      ? `${periodStart.toLocaleDateString('cs-CZ')} – ${new Date(periodEnd.getTime() - 86_400_000).toLocaleDateString('cs-CZ')}`
      : period;

  const lines: InvoiceLine[] = [
    { description: `Předplatné Foldera – ${label}`, quantity: 1, unitPriceCzk: PLAN_PRICE_CZK, amountCzk: PLAN_PRICE_CZK },
  ];
  if (overage > 0) {
    lines.push({
      description: `Doklady nad rámec (${INCLUDED_DOCS} v ceně) – ${label}`,
      quantity: overage,
      unitPriceCzk: OVERAGE_CZK,
      amountCzk: overage * OVERAGE_CZK,
    });
  }
  const totalCzk = lines.reduce((s, l) => s + l.amountCzk, 0);

  // Send to the company's chosen billing e-mail; fall back to the owner account.
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, company.userId)).limit(1);
  const recipientEmail = company.billingEmail ?? owner?.email;
  if (!recipientEmail) {
    logger.warn({ companyId: company.id }, '[Invoicing] No billing e-mail — skipping invoice');
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
    // One clean file: the PDF with the ISDOC embedded inside it.
    const pdf = await buildPdf(
      {
        number,
        issueDate,
        dueDate,
        variableSymbol,
        customerName: company.name,
        customerIco: company.ico,
        customerAddress,
        lines,
        totalCzk,
      },
      isdocXml
    );
    await sendMail({
      to: recipientEmail,
      bcc: env.BILLING_INVOICE_BCC,
      subject: `Foldera – faktura ${number} (${label})`,
      html: `<p>Dobrý den,</p><p>v příloze posíláme fakturu č. <b>${number}</b> za předplatné Foldera za období ${label}.</p><p>Částka k úhradě: <b>${totalCzk} Kč</b>, splatnost ${dueDate}, variabilní symbol ${variableSymbol}.</p><p>V PDF najdete QR platbu a je v něm vložená i elektronická faktura <b>ISDOC</b> pro snadný import do účetnictví.</p><p>Děkujeme, Foldera.</p>`,
      text: `Faktura ${number} za období ${label}. K úhradě ${totalCzk} Kč, splatnost ${dueDate}, VS ${variableSymbol}.`,
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

/**
 * Issue invoices in arrears on each company's subscription anniversary. A
 * company is billed only once a full anniversary period has elapsed, so a
 * mid-month signup is never charged for a partial month. Idempotent per
 * (company, period) via the unique index.
 */
export async function runMonthlyInvoicing(): Promise<void> {
  if (!env.BILLING_INVOICE_ENABLED) return;
  const active = await db.select().from(companies).where(eq(companies.billingStatus, 'active'));
  for (const company of active) {
    if (!company.subscriptionStartedAt) continue;
    const completed = completedBillingPeriod(company.subscriptionStartedAt);
    if (!completed) continue; // first full month hasn't elapsed yet
    const period = completed.key;
    const [existing] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.companyId, company.id), eq(invoices.period, period)))
      .limit(1);
    if (existing) continue;
    try {
      await generateInvoiceFor(company, period, completed.start, completed.end);
    } catch (error) {
      logger.error(
        { companyId: company.id, period, error: toError(error).message },
        '[Invoicing] generateInvoiceFor threw'
      );
    }
  }
}
