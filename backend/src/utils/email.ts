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
  replyTo?: string;
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

/** Hosted brand mark (e-mail clients don't render inline SVG). */
const LOGO_URL = 'https://foldera.cz/icons/icon-128x128.png';

const FONT = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

/**
 * Shared brand shell for every transactional e-mail. A LIGHT, table-based
 * layout with solid colors — renders consistently across clients and, unlike a
 * dark card, survives Outlook desktop dark-mode without low-contrast mangling.
 * The text wordmark sits next to the logo so branding holds even when the
 * image is blocked.
 */
const SHELL = (inner: string): string =>
  `<!DOCTYPE html>
<html lang="cs" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <!--[if mso]><style>table,td,div,p,a{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f3f3f6;-webkit-text-size-adjust:100%">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f3f6">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background:#ffffff;border:1px solid #e7e7ee;border-radius:16px;overflow:hidden">
          <tr><td height="4" style="height:4px;background:#7c4ef0;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr>
            <td style="padding:22px 32px;border-bottom:1px solid #eeeef2">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:11px;vertical-align:middle">
                    <img src="${LOGO_URL}" width="32" height="32" alt="Foldera" style="display:block;border-radius:8px" />
                  </td>
                  <td style="vertical-align:middle;font-family:${FONT};font-weight:800;font-size:20px;letter-spacing:-0.02em;color:#16161d">Foldera</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 32px;font-family:${FONT};font-size:15px;line-height:1.55;color:#16161d">
              ${inner}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;border-top:1px solid #eeeef2;background:#fafafb">
              <p style="font-family:${FONT};color:#9a9aa7;font-size:12px;line-height:1.5;margin:0">
                Doklady automaticky do ABRA Flexi · <a href="https://foldera.cz" style="color:#7c4ef0;text-decoration:none">foldera.cz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

/** Send the 6-digit signup verification code. */
export async function sendVerificationCode(to: string, name: string, code: string): Promise<void> {
  const safeName = name ? escapeHtml(name) : '';
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den${safeName ? ` ${safeName}` : ''},</p>
    <p style="font-size:15px;color:#56566a;margin:0 0 20px">váš ověřovací kód pro registraci do Foldera je:</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;background:#f4f4f7;border:1px solid #e6e6ec;border-radius:10px;padding:18px 0;color:#16161d">${code}</div>
    <p style="font-size:13px;color:#8a8a99;margin:18px 0 0">Kód platí 15 minut. Pokud jste o registraci nežádali, e-mail ignorujte.</p>`;
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
    `<tr><td style="color:#56566a;padding:4px 0">Firma</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.companyName)}</td></tr>`,
    `<tr><td style="color:#56566a;padding:4px 0">Soubor</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.fileName)}</td></tr>`,
  ];
  if (opts.supplierName)
    rows.push(`<tr><td style="color:#56566a;padding:4px 0">Dodavatel</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.supplierName)}</td></tr>`);
  if (opts.amount)
    rows.push(`<tr><td style="color:#56566a;padding:4px 0">Částka</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.amount)}</td></tr>`);

  const reason = opts.errorMessage
    ? `<div style="background:#f4f4f7;border:1px solid #e6e6ec;border-radius:10px;padding:12px 14px;margin:16px 0;color:#c0392b;font-size:13px;line-height:1.5">${escapeHtml(opts.errorMessage)}</div>`
    : '';

  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den,</p>
    <p style="font-size:15px;color:#56566a;margin:0 0 16px">u jednoho dokladu nastala chyba <b style="color:#16161d">${phaseLabel}</b>. Doklad <b style="color:#16161d">nebyl</b> založen do účetnictví.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 4px">${rows.join('')}</table>
    ${reason}
    <a href="${opts.link}" style="display:inline-block;background:#7c4ef0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;margin-top:6px">Zobrazit doklady</a>
    <p style="font-size:13px;color:#8a8a99;margin:18px 0 0">${
      opts.phase === 'export'
        ? 'Po opravě nastavení můžete export zopakovat přímo v aplikaci.'
        : 'Doklad se nepodařilo přečíst - zkontrolujte ho v aplikaci a případně nahrajte znovu.'
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

/** Alert a company admin that a doc is held because its bank account is new/changed. */
export async function sendBankReviewAlert(
  to: string,
  opts: { companyName: string; fileName: string; supplierName?: string | null; reason: string; link: string }
): Promise<void> {
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den,</p>
    <p style="font-size:15px;color:#56566a;margin:0 0 16px">jeden doklad jsme <b style="color:#16161d">pozdrželi ke kontrole</b>, protože obsahuje <b style="color:#16161d">nový nebo změněný bankovní účet</b>. Do ABRA Flexi se založí až po vašem schválení - ochrana proti přesměrování platby.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 4px">
      <tr><td style="color:#56566a;padding:4px 0">Firma</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.companyName)}</td></tr>
      <tr><td style="color:#56566a;padding:4px 0">Soubor</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.fileName)}</td></tr>
      ${opts.supplierName ? `<tr><td style="color:#56566a;padding:4px 0">Dodavatel</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.supplierName)}</td></tr>` : ''}
    </table>
    <div style="background:#f4f4f7;border:1px solid #e6e6ec;border-radius:10px;padding:12px 14px;margin:16px 0;color:#9a6a14;font-size:13px;line-height:1.5">${escapeHtml(opts.reason)}</div>
    <a href="${opts.link}" style="display:inline-block;background:#7c4ef0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">Zkontrolovat doklad</a>
    <p style="font-size:13px;color:#8a8a99;margin:18px 0 0">Ověřte bankovní účet u dodavatele. Pokud je správný, doklad v aplikaci schválíte a založí se do ABRA Flexi.</p>`;
  await sendMail({
    to,
    subject: `Foldera – doklad ke kontrole: bankovní účet (${opts.companyName})`,
    html: SHELL(inner),
    text: `Doklad "${opts.fileName}" (${opts.companyName}) byl pozdržen ke kontrole - nový/změněný bankovní účet. ${opts.reason} Ověřte a schvalte v aplikaci: ${opts.link}`,
  });
}

/** Tell a company admin the free trial ended — ask them to confirm going paid. */
export async function sendTrialEndedAlert(
  to: string,
  opts: { companyName: string; link: string }
): Promise<void> {
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">Dobrý den,</p>
    <p style="font-size:15px;color:#56566a;margin:0 0 16px">zkušební období pro firmu <b style="color:#16161d">${escapeHtml(opts.companyName)}</b> skončilo. Příchozí doklady se teď <b style="color:#16161d">nezpracovávají</b>.</p>
    <p style="font-size:15px;color:#56566a;margin:0 0 18px">Chcete-li přejít na ostrý provoz, je potřeba to potvrdit - aktivací se spustí předplatné <b style="color:#16161d">199 Kč měsíčně</b> (100 dokladů v ceně, každý další 2 Kč). Bez vašeho potvrzení vám nic neúčtujeme.</p>
    <a href="${opts.link}" style="display:inline-block;background:#7c4ef0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">Aktivovat předplatné</a>
    <p style="font-size:13px;color:#8a8a99;margin:18px 0 0">Aktivaci potvrzuje správce firmy přímo v aplikaci. Dokud ji nepotvrdíte, zůstává účet bez poplatku.</p>`;
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
    <p style="font-size:15px;color:#56566a;margin:0 0 18px">byli jste pozváni do firmy <b style="color:#16161d">${escapeHtml(companyName)}</b> ve Foldeře jako <b style="color:#16161d">${roleLabel}</b>.</p>
    <a href="${link}" style="display:inline-block;background:#7c4ef0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">Přijmout pozvánku</a>
    <p style="font-size:13px;color:#8a8a99;margin:18px 0 0">Pozvánka platí 7 dní. Pokud ještě nemáte účet, nejprve se zaregistrujte stejným e-mailem a poté pozvánku přijměte.</p>`;
  await sendMail({
    to,
    subject: `Foldera – pozvánka do firmy ${companyName}`,
    html: SHELL(inner),
    text: `Byli jste pozváni do firmy ${companyName} ve Foldeře jako ${roleLabel}. Pozvánku přijměte zde: ${link} (platí 7 dní).`,
  });
}

/**
 * Notify operators about a new message from the landing-page contact form.
 * Reply-To is the submitter, so a reply goes straight back to them.
 */
export async function sendContactNotification(
  to: string,
  opts: { name: string; email: string; company?: string | null; message: string }
): Promise<void> {
  const rows = [
    `<tr><td style="color:#56566a;padding:4px 0">Jméno</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.name)}</td></tr>`,
    `<tr><td style="color:#56566a;padding:4px 0">E-mail</td><td style="text-align:right"><a href="mailto:${escapeHtml(opts.email)}" style="color:#7c4ef0;text-decoration:none">${escapeHtml(opts.email)}</a></td></tr>`,
    ...(opts.company
      ? [`<tr><td style="color:#56566a;padding:4px 0">Firma</td><td style="color:#16161d;text-align:right">${escapeHtml(opts.company)}</td></tr>`]
      : []),
  ].join('');
  const inner = `
    <p style="font-size:15px;margin:0 0 16px">Nová zpráva z kontaktního formuláře 📨</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 18px">${rows}</table>
    <div style="background:#f4f4f7;border:1px solid #e6e6ec;border-radius:10px;padding:14px 16px;font-size:14px;color:#16161d;white-space:pre-wrap;line-height:1.55">${escapeHtml(opts.message)}</div>
    <p style="font-size:13px;color:#8a8a99;margin:18px 0 0">Odpovězte přímo na tento e-mail – poputuje na adresu odesílatele.</p>`;
  await sendMail({
    to,
    replyTo: opts.email,
    subject: `Foldera – nová zpráva od ${opts.name}`,
    html: SHELL(inner),
    text: `Nová zpráva z kontaktního formuláře.\n\nJméno: ${opts.name}\nE-mail: ${opts.email}${opts.company ? `\nFirma: ${opts.company}` : ''}\n\n${opts.message}`,
  });
}
