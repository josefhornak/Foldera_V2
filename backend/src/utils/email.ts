/**
 * Outbound e-mail via SMTP (Resend in production). When SMTP_HOST is unset the
 * message is logged instead of sent, so local/dev never blocks on mail.
 */
import nodemailer, { type Transporter } from 'nodemailer';

import env from '../config/env.js';
import { logger } from './logger.js';
import { toError } from './errors.js';

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: env.SMTP_REQUIRE_TLS,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  bcc?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}): Promise<void> {
  const t = getTransport();
  if (!t) {
    logger.warn(
      { to: opts.to, subject: opts.subject },
      '[Email] SMTP not configured — message not sent (dev fallback)',
    );
    return;
  }
  try {
    await t.sendMail({ from: env.MAIL_FROM, ...opts });
    logger.info({ to: opts.to, subject: opts.subject }, '[Email] Sent');
  } catch (error) {
    logger.error({ to: opts.to, error: toError(error).message }, '[Email] Send failed');
    throw error;
  }
}

/** Escape user-controlled text before interpolating into an HTML e-mail body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SHELL = (inner: string): string =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b0b10;color:#efeff4;padding:32px">
     <div style="max-width:480px;margin:0 auto;background:#14141c;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:32px">
       <div style="font-weight:700;font-size:20px;color:#8b5cf6;margin-bottom:20px">Foldera</div>
       ${inner}
       <p style="color:#666674;font-size:12px;margin-top:28px">Faktury automaticky do ABRA Flexi.</p>
     </div>
   </div>`;

/** Send the 6-digit signup verification code. */
export async function sendVerificationCode(to: string, name: string, code: string): Promise<void> {
  const safeName = name ? escapeHtml(name) : '';
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den${safeName ? ` ${safeName}` : ''},</p>
    <p style="font-size:15px;color:#9c9cac;margin:0 0 20px">váš ověřovací kód pro registraci do Foldera je:</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;background:#0e0e13;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:18px 0;color:#efeff4">${code}</div>
    <p style="font-size:13px;color:#666674;margin:18px 0 0">Kód platí 15 minut. Pokud jste o registraci nežádali, e-mail ignorujte.</p>`;
  await sendMail({
    to,
    subject: `Foldera – ověřovací kód ${code}`,
    html: SHELL(inner),
    text: `Váš ověřovací kód do Foldera je ${code}. Platí 15 minut.`,
  });
}

/** Alert a company admin that a document failed to process or export. */
export async function sendDocumentFailureAlert(
  to: string,
  opts: {
    companyName: string;
    fileName: string;
    supplierName?: string | null;
    amount?: string | null;
    phase: 'export' | 'processing';
    errorMessage?: string | null;
    link: string;
  }
): Promise<void> {
  const phaseLabel = opts.phase === 'export' ? 'při exportu do ABRA Flexi' : 'při zpracování';
  const rows: string[] = [
    `<tr><td style="color:#9c9cac;padding:4px 0">Firma</td><td style="color:#efeff4;text-align:right">${escapeHtml(opts.companyName)}</td></tr>`,
    `<tr><td style="color:#9c9cac;padding:4px 0">Soubor</td><td style="color:#efeff4;text-align:right">${escapeHtml(opts.fileName)}</td></tr>`,
  ];
  if (opts.supplierName)
    rows.push(`<tr><td style="color:#9c9cac;padding:4px 0">Dodavatel</td><td style="color:#efeff4;text-align:right">${escapeHtml(opts.supplierName)}</td></tr>`);
  if (opts.amount)
    rows.push(`<tr><td style="color:#9c9cac;padding:4px 0">Částka</td><td style="color:#efeff4;text-align:right">${escapeHtml(opts.amount)}</td></tr>`);

  const reason = opts.errorMessage
    ? `<div style="background:#0e0e13;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 14px;margin:16px 0;color:#f0a3a3;font-size:13px;line-height:1.5">${escapeHtml(opts.errorMessage)}</div>`
    : '';

  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den,</p>
    <p style="font-size:15px;color:#9c9cac;margin:0 0 16px">u jednoho dokladu nastala chyba <b style="color:#efeff4">${phaseLabel}</b>. Doklad <b style="color:#efeff4">nebyl</b> založen do účetnictví.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 4px">${rows.join('')}</table>
    ${reason}
    <a href="${opts.link}" style="display:inline-block;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;margin-top:6px">Zobrazit doklady</a>
    <p style="font-size:13px;color:#666674;margin:18px 0 0">${
      opts.phase === 'export'
        ? 'Po opravě nastavení můžete export zopakovat přímo v aplikaci.'
        : 'Doklad se nepodařilo přečíst — zkontrolujte ho v aplikaci a případně nahrajte znovu.'
    } Tato upozornění chodí správcům firmy.</p>`;

  await sendMail({
    to,
    subject: `Foldera – chyba u dokladu (${opts.companyName})`,
    html: SHELL(inner),
    text: `U dokladu "${opts.fileName}" ve firmě ${opts.companyName} nastala chyba ${phaseLabel}. ${
      opts.errorMessage ? `Důvod: ${opts.errorMessage}. ` : ''
    }Doklad nebyl založen. Detail: ${opts.link}`,
  });
}

/** Tell a company admin the free trial ended — ask them to confirm going paid. */
export async function sendTrialEndedAlert(
  to: string,
  opts: { companyName: string; link: string }
): Promise<void> {
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den,</p>
    <p style="font-size:15px;color:#9c9cac;margin:0 0 16px">zkušební období pro firmu <b style="color:#efeff4">${escapeHtml(opts.companyName)}</b> skončilo. Příchozí doklady se teď <b style="color:#efeff4">nezpracovávají</b>.</p>
    <p style="font-size:15px;color:#9c9cac;margin:0 0 18px">Chcete-li přejít na ostrý provoz, je potřeba to potvrdit — aktivací se spustí předplatné <b style="color:#efeff4">199 Kč měsíčně</b> (100 dokladů v ceně, každý další 2 Kč). Bez vašeho potvrzení vám nic neúčtujeme.</p>
    <a href="${opts.link}" style="display:inline-block;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">Aktivovat předplatné</a>
    <p style="font-size:13px;color:#666674;margin:18px 0 0">Aktivaci potvrzuje správce firmy přímo v aplikaci. Dokud ji nepotvrdíte, zůstává účet bez poplatku.</p>`;
  await sendMail({
    to,
    subject: `Foldera – zkušební období skončilo (${opts.companyName})`,
    html: SHELL(inner),
    text: `Zkušební období pro firmu ${opts.companyName} skončilo a doklady se nezpracovávají. Chcete-li přejít na ostrý provoz (199 Kč/měs, 100 dokladů v ceně), potvrďte aktivaci předplatného zde: ${opts.link}. Bez potvrzení vám nic neúčtujeme.`,
  });
}

/** Invite a person to join a company with a given role. */
export async function sendCompanyInvite(
  to: string,
  companyName: string,
  role: 'admin' | 'member',
  link: string
): Promise<void> {
  const roleLabel = role === 'admin' ? 'správce' : 'běžný uživatel (jen nahlíží)';
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den,</p>
    <p style="font-size:15px;color:#9c9cac;margin:0 0 18px">byli jste pozváni do firmy <b style="color:#efeff4">${escapeHtml(companyName)}</b> ve Foldeře jako <b style="color:#efeff4">${roleLabel}</b>.</p>
    <a href="${link}" style="display:inline-block;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">Přijmout pozvánku</a>
    <p style="font-size:13px;color:#666674;margin:18px 0 0">Pozvánka platí 7 dní. Pokud ještě nemáte účet, nejprve se zaregistrujte stejným e-mailem a poté pozvánku přijměte.</p>`;
  await sendMail({
    to,
    subject: `Foldera – pozvánka do firmy ${companyName}`,
    html: SHELL(inner),
    text: `Byli jste pozváni do firmy ${companyName} ve Foldeře jako ${roleLabel}. Pozvánku přijměte zde: ${link} (platí 7 dní).`,
  });
}
