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

const SHELL = (inner: string): string =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b0b10;color:#efeff4;padding:32px">
     <div style="max-width:480px;margin:0 auto;background:#14141c;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:32px">
       <div style="font-weight:700;font-size:20px;color:#8b5cf6;margin-bottom:20px">Foldera</div>
       ${inner}
       <p style="color:#666674;font-size:12px;margin-top:28px">Automatický most mezi fakturami a ABRA Flexi.</p>
     </div>
   </div>`;

/** Send the 6-digit signup verification code. */
export async function sendVerificationCode(to: string, name: string, code: string): Promise<void> {
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den${name ? ` ${name}` : ''},</p>
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
