/**
 * Shared helpers for source pollers: temp file naming, OAuth token storage
 * on the source row (encrypted, refresh-and-persist), HTTP helpers.
 */
import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  SOURCE_TYPE,
  sources,
  type DriveSourceConfig,
  type Source,
} from '../../db/schema/sources.schema.js';
import { decryptSecret, encryptSecret } from '../../utils/crypto.js';
import { AppError, ErrorCodes } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** OAuth token bundle. `expiresAt` is unix epoch milliseconds. */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/** A cloud folder entry for the folder picker UI */
export interface DriveFolder {
  id: string;
  name: string;
}

/** Bounded ring of already-processed drive file ids kept on the cursor */
export const SEEN_FILE_IDS_LIMIT = 500;

/** Refresh tokens when less than 5 minutes to expiry */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Temp files
// ---------------------------------------------------------------------------

/** Build a unique, filesystem-safe temp file name preserving the original name */
export function uniqueTempFileName(originalName: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${safe}`;
}

// ---------------------------------------------------------------------------
// Drive token storage (encrypted on sources.config)
// ---------------------------------------------------------------------------

/** Narrow a source to its drive config; throws for non-drive sources. */
export function getDriveConfig(source: Source): DriveSourceConfig {
  if (source.type !== SOURCE_TYPE.ONEDRIVE && source.type !== SOURCE_TYPE.GOOGLE_DRIVE) {
    throw new AppError(ErrorCodes.BAD_REQUEST, 'Source is not a cloud drive source', 400);
  }
  return source.config as DriveSourceConfig;
}

/**
 * Persist refreshed tokens back onto the source row (encrypted).
 * Keeps the previous refresh token when the provider did not rotate it.
 */
export async function persistDriveTokens(
  sourceId: string,
  config: DriveSourceConfig,
  tokens: OAuthTokens
): Promise<DriveSourceConfig> {
  const newConfig: DriveSourceConfig = {
    ...config,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : config.refreshTokenEnc,
    tokenExpiresAt: tokens.expiresAt,
  };
  await db
    .update(sources)
    .set({ config: newConfig, updatedAt: new Date() })
    .where(eq(sources.id, sourceId));
  logger.info({ sourceId }, '[Sources] Refreshed and persisted drive tokens');
  return newConfig;
}

/**
 * Return a valid access token for a drive source, refreshing it via the
 * provider-specific `refresh` function (and persisting the result) when the
 * stored token is missing or expires in less than 5 minutes.
 */
export async function getValidAccessToken(
  source: Source,
  refresh: (refreshToken: string) => Promise<OAuthTokens>
): Promise<string> {
  const config = getDriveConfig(source);

  if (config.accessTokenEnc && config.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return decryptSecret(config.accessTokenEnc);
  }

  if (!config.refreshTokenEnc) {
    throw new AppError(
      ErrorCodes.UNAUTHORIZED,
      'Cloud connection needs re-authorization (missing refresh token)',
      401
    );
  }

  const tokens = await refresh(decryptSecret(config.refreshTokenEnc));
  await persistDriveTokens(source.id, config, tokens);
  return tokens.accessToken;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Map an upstream HTTP status to an appropriate AppError status code */
export function mapUpstreamStatus(status: number): number {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409) {
    return status;
  }
  if (status === 429) return 429;
  return 502;
}

/**
 * fetch() with an AbortController timeout; network errors become AppError 502.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { logLabel: string },
  timeoutMs = 30_000
): Promise<Response> {
  const { logLabel, ...fetchInit } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchInit, signal: controller.signal });
  } catch (err: unknown) {
    logger.error({ error: (err as Error).message, url }, `[Sources] ${logLabel} network error`);
    throw new AppError(ErrorCodes.SERVICE_UNAVAILABLE, `${logLabel} failed (network error)`, 502);
  } finally {
    clearTimeout(timeout);
  }
}
