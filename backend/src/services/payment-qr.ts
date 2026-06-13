/**
 * Czech "QR platba" (SPAYD / SPD) helper.
 *
 * Builds the short payment descriptor string and renders it as a PNG QR code
 * so it can be embedded in the invoice PDF. The bank account is configured in
 * domestic `číslo/kód` form; we derive the IBAN here because SPAYD's ACC field
 * requires it.
 */
import QRCode from 'qrcode';

/** Compute the two IBAN check digits for a Czech BBAN (mod-97, ISO 13616). */
function ibanCheckDigits(bban: string): string {
  const rearranged = `${bban}CZ00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of rearranged) remainder = (remainder * 10 + Number(ch)) % 97;
  return String(98 - remainder).padStart(2, '0');
}

/**
 * Convert a domestic account string (`[predcisli-]cislo/kod`) to an IBAN.
 * Returns null if the input doesn't look like a Czech account number.
 */
export function toCzechIban(account: string): string | null {
  const m = account.trim().match(/^(?:(\d+)-)?(\d+)\/(\d{4})$/);
  if (!m) return null;
  const prefix = (m[1] ?? '0').padStart(6, '0');
  const number = (m[2] ?? '').padStart(10, '0');
  const bank = m[3] ?? '';
  const bban = `${bank}${prefix}${number}`;
  return `CZ${ibanCheckDigits(bban)}${bban}`;
}

export interface SpaydParams {
  account: string; // domestic form, e.g. "2002272017/3030"
  amountCzk: number;
  variableSymbol: string;
  message?: string;
  recipientName?: string;
}

/** Build the SPAYD payload string (`SPD*1.0*ACC:...`). Returns null without a valid IBAN. */
export function buildSpayd(params: SpaydParams): string | null {
  const iban = toCzechIban(params.account);
  if (!iban) return null;
  const fields: string[] = [
    'SPD*1.0',
    `ACC:${iban}`,
    `AM:${params.amountCzk.toFixed(2)}`,
    'CC:CZK',
    `X-VS:${params.variableSymbol}`,
  ];
  if (params.message) fields.push(`MSG:${sanitize(params.message)}`);
  if (params.recipientName) fields.push(`RN:${sanitize(params.recipientName)}`);
  return fields.join('*');
}

/** SPAYD forbids `*` and `%` inside values; keep messages short and clean. */
function sanitize(value: string): string {
  return value.replace(/[*%]/g, ' ').slice(0, 60);
}

/** Render a SPAYD string as a PNG QR code buffer, or null if it can't be built. */
export async function buildPaymentQrPng(params: SpaydParams): Promise<Buffer | null> {
  const payload = buildSpayd(params);
  if (!payload) return null;
  return QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: { dark: '#0b0b10', light: '#ffffff' },
  });
}
