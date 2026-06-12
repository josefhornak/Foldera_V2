/**
 * Czech bank code normalization.
 *
 * Ported from Foldera v1 (queue/extraction/extractors/ocr/bankCodeUtils.ts).
 *
 * Czech bank account formats:
 * - `"123456789/0100"`
 * - `"12345-67890/0800"`
 * - `"123456789 / 0100"`
 */

/**
 * Normalise bank code — extract 4-digit code from account string if needed.
 *
 * @param value - Direct bank code value (may be null)
 * @param bankAccount - Full bank account string to extract code from
 * @returns 4-digit bank code or null
 */
export function normalizeBankCode(value: unknown, bankAccount?: unknown): string | null {
  if (value != null && value !== '') {
    const cleaned = String(value).replace(/\D/g, '');
    if (cleaned.length >= 3 && cleaned.length <= 4) {
      return cleaned.padStart(4, '0');
    }
  }

  if (bankAccount != null && bankAccount !== '') {
    const accountStr = String(bankAccount).trim();
    const slashMatch = accountStr.match(/[/\\]\s*(\d{3,4})\s*$/);
    if (slashMatch?.[1]) {
      return slashMatch[1].padStart(4, '0');
    }
  }

  return null;
}

/**
 * Split a Czech bank account string into account number and bank code.
 * `"2536670204/2600"` → `{ account: "2536670204", code: "2600" }`.
 * When no code suffix is present, returns the trimmed account and the
 * separately provided code (normalized) if any.
 */
export function splitBankAccount(
  account: string | null,
  code: string | null,
): { account: string | null; code: string | null } {
  const normalizedCode = normalizeBankCode(code, account);

  if (account == null || account.trim() === '') {
    return { account: null, code: normalizedCode };
  }

  const cleanedAccount = account.trim().replace(/\s*[/\\]\s*\d{3,4}\s*$/, '');
  return { account: cleanedAccount || null, code: normalizedCode };
}
