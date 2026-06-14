/**
 * Per-company OAuth app credentials for cloud drive sources. Each company brings
 * its own Google/Azure OAuth app; the client secret is encrypted at rest. These
 * helpers load the decrypted credentials for the OAuth start/callback/refresh
 * flows.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { oauthCredentials } from '../../db/schema/index.js';
import { decryptSecret } from '../../utils/crypto.js';
import { AppError, ErrorCodes } from '../../utils/errors.js';

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export type DriveProvider = 'google_drive' | 'onedrive';

const PROVIDER_LABEL: Record<DriveProvider, string> = {
  google_drive: 'Google Drive',
  onedrive: 'OneDrive',
};

/** Load a company's decrypted OAuth credentials for a provider, or null. */
export async function loadOAuthCredentials(
  companyId: string,
  provider: DriveProvider,
): Promise<OAuthCredentials | null> {
  const [row] = await db
    .select({ clientId: oauthCredentials.clientId, clientSecretEnc: oauthCredentials.clientSecretEnc })
    .from(oauthCredentials)
    .where(and(eq(oauthCredentials.companyId, companyId), eq(oauthCredentials.provider, provider)))
    .limit(1);
  if (!row) return null;
  return { clientId: row.clientId, clientSecret: decryptSecret(row.clientSecretEnc) };
}

/** Like loadOAuthCredentials but throws a 400 when not configured. */
export async function requireOAuthCredentials(
  companyId: string,
  provider: DriveProvider,
): Promise<OAuthCredentials> {
  const creds = await loadOAuthCredentials(companyId, provider);
  if (!creds) {
    throw new AppError(
      ErrorCodes.BAD_REQUEST,
      `Pro ${PROVIDER_LABEL[provider]} nejsou nastaveny přihlašovací údaje OAuth aplikace. Zadejte je v Nastavení → Zdroje.`,
      400,
    );
  }
  return creds;
}
