/**
 * Google Drive source — OAuth 2.0 + Drive API v3 folder polling.
 *
 * OAuth credentials come from env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 * Tokens are stored encrypted on the source row (DriveSourceConfig).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import env from '../../config/env.js';
import type { Source, SourceCursor } from '../../db/schema/sources.schema.js';
import type { IncomingFile, PollResult } from '../../types/contracts.js';
import { AppError, ErrorCodes } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { mimeTypeForFileName, resolveMimeType } from './attachmentFilter.js';
import { loadOAuthCredentials, type OAuthCredentials } from './credentials.js';
import {
  fetchWithTimeout,
  getDriveConfig,
  getValidAccessToken,
  mapUpstreamStatus,
  SEEN_FILE_IDS_LIMIT,
  uniqueTempFileName,
  type DriveFolder,
  type OAuthTokens,
} from './common.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/** Safety bound for pagination during a single poll */
const MAX_LIST_PAGES = 10;

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

interface GoogleFilesResponse {
  files: GoogleDriveFile[];
  nextPageToken?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

// ---------------------------------------------------------------------------
// Credentials / OAuth
// ---------------------------------------------------------------------------

export function isGoogleDriveConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Per-company credentials when provided, else the (optional) global env app. */
function getCredentials(creds?: OAuthCredentials): { clientId: string; clientSecret: string } {
  if (creds) return creds;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(
      ErrorCodes.BAD_REQUEST,
      'Google OAuth credentials are not configured',
      400
    );
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

/** Build the Google authorization URL with a CSRF state parameter */
export function buildGoogleAuthUrl(redirectUri: string, state: string, creds?: OAuthCredentials): string {
  const { clientId } = getCredentials(creds);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline', // request a refresh token
    prompt: 'consent', // force consent screen so the refresh token is returned
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function requestTokens(body: URLSearchParams, logLabel: string): Promise<OAuthTokens> {
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    logLabel,
  });
  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, `[GoogleDrive] ${logLabel} failed`);
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `${logLabel} failed (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }
  const data = (await response.json()) as GoogleTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Exchange an authorization code for tokens */
export async function exchangeGoogleCode(code: string, redirectUri: string, creds?: OAuthCredentials): Promise<OAuthTokens> {
  const { clientId, clientSecret } = getCredentials(creds);
  return requestTokens(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
    'Google token exchange'
  );
}

/** Refresh an access token (Google keeps the original refresh token) */
export async function refreshGoogleToken(refreshToken: string, creds?: OAuthCredentials): Promise<OAuthTokens> {
  const { clientId, clientSecret } = getCredentials(creds);
  return requestTokens(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    'Google token refresh'
  );
}

/** Resolve the signed-in account's email via the userinfo endpoint */
export async function getGoogleAccountEmail(accessToken: string): Promise<string> {
  const response = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    logLabel: 'Google get user info',
  });
  if (!response.ok) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `Failed to get Google user info (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }
  const data = (await response.json()) as { email: string };
  return data.email;
}

// ---------------------------------------------------------------------------
// Drive API — folders / files
// ---------------------------------------------------------------------------

async function listFilesPage(
  accessToken: string,
  params: URLSearchParams,
  logLabel: string
): Promise<GoogleFilesResponse> {
  const response = await fetchWithTimeout(`${GOOGLE_DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    logLabel,
  });
  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, `[GoogleDrive] ${logLabel} failed`);
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `${logLabel} failed (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }
  return (await response.json()) as GoogleFilesResponse;
}

/** List subfolders of a Google Drive folder (folder picker). `parentId` omitted = root. */
export async function listGoogleDriveFolders(
  accessToken: string,
  parentId?: string
): Promise<DriveFolder[]> {
  const query = `'${(parentId ?? 'root').replace(/'/g, "\\'")}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const folders: DriveFolder[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken, files(id, name)',
      pageSize: '100',
      orderBy: 'name',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await listFilesPage(accessToken, params, 'Google Drive list folders');
    folders.push(...data.files.map((f) => ({ id: f.id, name: f.name })));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return folders;
}

/** Whether a Google Drive file is a supported invoice candidate */
export function isGoogleDriveFileSupported(mimeType: string, fileName: string): boolean {
  // Google-native files (Docs/Sheets/…) are not supported in V2 — no export
  if (mimeType.startsWith('application/vnd.google-apps.')) return false;
  return resolveMimeType(mimeType, fileName) !== null || mimeTypeForFileName(fileName) !== null;
}

async function downloadGoogleDriveFile(accessToken: string, fileId: string): Promise<Buffer> {
  const response = await fetchWithTimeout(
    `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` }, logLabel: 'Google Drive download file' },
    60_000
  );
  if (!response.ok) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `Failed to download Google Drive file (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

/**
 * Poll the watched Google Drive folder for new files.
 *
 * Cursor: `lastModifiedTime` (ISO) + `seenFileIds` ring (last 500 ids) — the
 * ring guards against double-processing files sharing the cursor timestamp.
 */
export async function pollGoogleDriveSource(source: Source, tmpDir: string): Promise<PollResult> {
  const config = getDriveConfig(source);
  if (!config.folderId) {
    throw new AppError(ErrorCodes.BAD_REQUEST, 'No watched folder selected for this source', 400);
  }

  const creds = (await loadOAuthCredentials(source.companyId, 'google_drive')) ?? undefined;
  const accessToken = await getValidAccessToken(source, (rt) => refreshGoogleToken(rt, creds));
  const seenIds = new Set(source.cursor.seenFileIds ?? []);
  const cursorTime = source.cursor.lastModifiedTime ? Date.parse(source.cursor.lastModifiedTime) : 0;

  const folderId = config.folderId.replace(/'/g, "\\'");
  let query = `'${folderId}' in parents and trashed = false`;
  if (source.cursor.lastModifiedTime) {
    query += ` and modifiedTime >= '${source.cursor.lastModifiedTime}'`;
  }

  // Collect candidate files across pages
  const candidates: { id: string; name: string; mimeType: string; modifiedAt: Date }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      pageSize: '100',
      orderBy: 'modifiedTime desc',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await listFilesPage(accessToken, params, 'Google Drive list files');
    for (const file of data.files) {
      if (!isGoogleDriveFileSupported(file.mimeType, file.name)) continue;
      if (seenIds.has(file.id)) continue;
      const modifiedMs = file.modifiedTime ? Date.parse(file.modifiedTime) : Date.now();
      if (cursorTime && modifiedMs < cursorTime) continue; // strictly older than cursor
      const mimeType = resolveMimeType(file.mimeType, file.name) ?? file.mimeType;
      candidates.push({ id: file.id, name: file.name, mimeType, modifiedAt: new Date(modifiedMs) });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  // Download
  const files: IncomingFile[] = [];
  const processedIds: string[] = [];
  let newestMs = cursorTime;
  for (const candidate of candidates) {
    const content = await downloadGoogleDriveFile(accessToken, candidate.id);
    const filePath = path.join(tmpDir, uniqueTempFileName(candidate.name));
    await fs.writeFile(filePath, content);
    files.push({
      externalRef: candidate.id,
      fileName: candidate.name,
      mimeType: candidate.mimeType,
      filePath,
      receivedAt: candidate.modifiedAt,
    });
    processedIds.push(candidate.id);
    newestMs = Math.max(newestMs, candidate.modifiedAt.getTime());
  }

  const cursor: SourceCursor = {
    lastModifiedTime: newestMs ? new Date(newestMs).toISOString() : source.cursor.lastModifiedTime,
    seenFileIds: [...processedIds, ...(source.cursor.seenFileIds ?? [])].slice(0, SEEN_FILE_IDS_LIMIT),
  };

  logger.info(
    { sourceId: source.id, folderId: config.folderId, files: files.length },
    '[GoogleDrive] Poll completed'
  );
  return { files, cursor };
}
