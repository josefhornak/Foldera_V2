/**
 * OneDrive source — Microsoft Graph OAuth + folder polling.
 *
 * OAuth credentials come from env (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET).
 * Tokens are stored encrypted on the source row (DriveSourceConfig).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import env from '../../config/env.js';
import type { Source, SourceCursor } from '../../db/schema/sources.schema.js';
import type { IncomingFile, PollResult } from '../../types/contracts.js';
import { AppError, ErrorCodes } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { mimeTypeForFileName } from './attachmentFilter.js';
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

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_API = 'https://graph.microsoft.com/v1.0';

const ONEDRIVE_SCOPES = 'offline_access Files.Read.All User.Read';

/** Safety bound for pagination during a single poll */
const MAX_LIST_PAGES = 10;

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: Record<string, unknown>;
}

interface GraphChildrenResponse {
  value: GraphDriveItem[];
  '@odata.nextLink'?: string;
}

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

// ---------------------------------------------------------------------------
// Credentials / OAuth
// ---------------------------------------------------------------------------

export function isOneDriveConfigured(): boolean {
  return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}

/** Per-company credentials when provided, else the (optional) global env app. */
function getCredentials(creds?: OAuthCredentials): { clientId: string; clientSecret: string } {
  if (creds) return creds;
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new AppError(
      ErrorCodes.BAD_REQUEST,
      'Microsoft OAuth credentials are not configured',
      400
    );
  }
  return { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET };
}

/** Build the Microsoft authorization URL with a CSRF state parameter */
export function buildOneDriveAuthUrl(redirectUri: string, state: string, creds?: OAuthCredentials): string {
  const { clientId } = getCredentials(creds);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: ONEDRIVE_SCOPES,
    state,
  });
  return `${MICROSOFT_AUTH_URL}?${params.toString()}`;
}

async function requestTokens(body: URLSearchParams, logLabel: string): Promise<OAuthTokens> {
  const response = await fetchWithTimeout(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    logLabel,
  });
  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, `[OneDrive] ${logLabel} failed`);
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `${logLabel} failed (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }
  const data = (await response.json()) as MicrosoftTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Exchange an authorization code for tokens */
export async function exchangeOneDriveCode(code: string, redirectUri: string, creds?: OAuthCredentials): Promise<OAuthTokens> {
  const { clientId, clientSecret } = getCredentials(creds);
  return requestTokens(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
    'OneDrive token exchange'
  );
}

/** Refresh an access token (Microsoft may rotate the refresh token) */
export async function refreshOneDriveToken(refreshToken: string, creds?: OAuthCredentials): Promise<OAuthTokens> {
  const { clientId, clientSecret } = getCredentials(creds);
  return requestTokens(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    'OneDrive token refresh'
  );
}

/** Resolve the signed-in account's email via Microsoft Graph */
export async function getMicrosoftAccountEmail(accessToken: string): Promise<string> {
  const response = await fetchWithTimeout(`${GRAPH_API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    logLabel: 'OneDrive get user info',
  });
  if (!response.ok) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `Failed to get Microsoft user info (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }
  const data = (await response.json()) as { mail?: string; userPrincipalName: string };
  return data.mail ?? data.userPrincipalName;
}

// ---------------------------------------------------------------------------
// Graph API — folders / files
// ---------------------------------------------------------------------------

function childrenUrl(parentId: string | undefined, query: string[]): string {
  const base =
    !parentId || parentId === 'root'
      ? `${GRAPH_API}/me/drive/root/children`
      : `${GRAPH_API}/me/drive/items/${encodeURIComponent(parentId)}/children`;
  // NOTE: URLSearchParams encodes '$' as '%24' which Graph does not recognise
  // as OData parameters, so the query string is built manually.
  return `${base}?${query.join('&')}`;
}

async function listChildrenPage(
  accessToken: string,
  parentId: string | undefined,
  select: string,
  skipToken?: string
): Promise<{ items: GraphDriveItem[]; nextSkipToken?: string }> {
  const query = [`$select=${select}`, '$top=100'];
  if (skipToken) query.push(`$skiptoken=${encodeURIComponent(skipToken)}`);

  const response = await fetchWithTimeout(childrenUrl(parentId, query), {
    headers: { Authorization: `Bearer ${accessToken}` },
    logLabel: 'OneDrive list children',
  });
  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, '[OneDrive] Failed to list children');
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `Failed to list OneDrive folder contents (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }

  const data = (await response.json()) as GraphChildrenResponse;
  let nextSkipToken: string | undefined;
  const nextLink = data['@odata.nextLink'];
  if (nextLink) {
    nextSkipToken = new URL(nextLink).searchParams.get('$skiptoken') ?? undefined;
  }
  return { items: data.value, nextSkipToken };
}

/** List subfolders of a OneDrive folder (folder picker). `parentId` omitted = root. */
export async function listOneDriveFolders(
  accessToken: string,
  parentId?: string
): Promise<DriveFolder[]> {
  const folders: DriveFolder[] = [];
  let skipToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { items, nextSkipToken } = await listChildrenPage(
      accessToken,
      parentId,
      'id,name,folder',
      skipToken
    );
    for (const item of items) {
      if (item.folder !== undefined) folders.push({ id: item.id, name: item.name });
    }
    if (!nextSkipToken) break;
    skipToken = nextSkipToken;
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether a OneDrive file is a supported invoice candidate (by file name) */
export function isOneDriveFileSupported(fileName: string): boolean {
  return mimeTypeForFileName(fileName) !== null;
}

async function downloadOneDriveFile(accessToken: string, fileId: string): Promise<Buffer> {
  const response = await fetchWithTimeout(
    `${GRAPH_API}/me/drive/items/${encodeURIComponent(fileId)}/content`,
    { headers: { Authorization: `Bearer ${accessToken}` }, logLabel: 'OneDrive download file' },
    60_000
  );
  if (!response.ok) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      `Failed to download OneDrive file (HTTP ${response.status})`,
      mapUpstreamStatus(response.status)
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

/**
 * Poll the watched OneDrive folder for new files.
 *
 * Cursor: `lastModifiedTime` (ISO) + `seenFileIds` ring (last 500 ids) — the
 * ring guards against double-processing files sharing the cursor timestamp.
 */
export async function pollOneDriveSource(source: Source, tmpDir: string): Promise<PollResult> {
  const config = getDriveConfig(source);
  if (!config.folderId) {
    throw new AppError(ErrorCodes.BAD_REQUEST, 'No watched folder selected for this source', 400);
  }

  const creds = (await loadOAuthCredentials(source.companyId, 'onedrive')) ?? undefined;
  const accessToken = await getValidAccessToken(source, (rt) => refreshOneDriveToken(rt, creds));
  const seenIds = new Set(source.cursor.seenFileIds ?? []);
  const cursorTime = source.cursor.lastModifiedTime ? Date.parse(source.cursor.lastModifiedTime) : 0;

  // Collect candidate files across pages
  const candidates: { id: string; name: string; mimeType: string; modifiedAt: Date }[] = [];
  let skipToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { items, nextSkipToken } = await listChildrenPage(
      accessToken,
      config.folderId,
      'id,name,size,lastModifiedDateTime,file',
      skipToken
    );
    for (const item of items) {
      if (item.file === undefined) continue; // folders etc.
      const mimeType = mimeTypeForFileName(item.name) ?? item.file.mimeType;
      if (!mimeType || !isOneDriveFileSupported(item.name)) continue;
      if (seenIds.has(item.id)) continue;
      const modifiedMs = item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) : Date.now();
      if (cursorTime && modifiedMs < cursorTime) continue; // strictly older than cursor
      candidates.push({ id: item.id, name: item.name, mimeType, modifiedAt: new Date(modifiedMs) });
    }
    if (!nextSkipToken) break;
    skipToken = nextSkipToken;
  }

  // Download
  const files: IncomingFile[] = [];
  const processedIds: string[] = [];
  let newestMs = cursorTime;
  for (const candidate of candidates) {
    const content = await downloadOneDriveFile(accessToken, candidate.id);
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
    '[OneDrive] Poll completed'
  );
  return { files, cursor };
}
