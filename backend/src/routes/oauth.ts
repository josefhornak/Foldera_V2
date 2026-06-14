/**
 * OAuth routes for connecting cloud drive sources (OneDrive / Google Drive).
 *
 * Mounted at /api/oauth.
 *
 * Flow:
 * 1. GET /:provider/start?companyId=…  (authenticated)
 *    → verifies company ownership, stores a one-time state token in Redis
 *      (TTL 10 min), responds with { url } for the browser to navigate to.
 * 2. GET /:provider/callback?code&state  (browser redirect, unauthenticated)
 *    → consumes the state (404 when invalid/expired), exchanges the code,
 *      resolves the account email, creates a source row (status
 *      'pending_auth' until a folder is chosen) and redirects back to the app.
 *
 * Note: redirect_uri points at the backend route under APP_BASE_URL — in dev
 * the Vite proxy forwards /api to the backend.
 */
import crypto from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import env from '../config/env.js';
import { db } from '../db/client.js';
import { companyMembers } from '../db/schema/index.js';
import {
  SOURCE_STATUS,
  sources,
  type DriveSourceConfig,
  type SourceType,
} from '../db/schema/sources.schema.js';
import { requireAuth } from '../middleware/auth.js';
import { getRedis } from '../queue/connection.js';
import {
  buildGoogleAuthUrl,
  buildOneDriveAuthUrl,
  exchangeGoogleCode,
  exchangeOneDriveCode,
  getGoogleAccountEmail,
  getMicrosoftAccountEmail,
  requireOAuthCredentials,
} from '../services/sources/index.js';
import { encryptSecret } from '../utils/crypto.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { generateId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

const router = Router();

const OAUTH_STATE_PREFIX = 'oauth_state:';
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

const providerSchema = z.enum(['onedrive', 'google_drive']);
type OAuthProvider = z.infer<typeof providerSchema>;

const startQuerySchema = z.object({ companyId: z.string().min(1) });
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

interface OAuthStateData {
  userId: string;
  companyId: string;
  provider: OAuthProvider;
}

function redirectUriFor(provider: OAuthProvider): string {
  return `${env.APP_BASE_URL}/api/oauth/${provider}/callback`;
}

/** GET /:provider/start?companyId=… → { url } */
router.get('/:provider/start', requireAuth, async (req, res, next) => {
  try {
    const provider = providerSchema.parse(req.params.provider);
    const { companyId } = startQuerySchema.parse(req.query);

    // Authorize via company_members (multi-tenant) — only a company admin
    // (správce) may connect a drive source, consistent with the sources routes.
    const [membership] = await db
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, req.auth!.userId)))
      .limit(1);
    if (!membership) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    if (membership.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Only a company admin can connect a source', 403);
    }

    // One-time state token (CSRF protection), TTL 10 minutes
    const state = crypto.randomBytes(32).toString('hex');
    const stateData: OAuthStateData = { userId: req.auth!.userId, companyId, provider };
    await getRedis().set(
      `${OAUTH_STATE_PREFIX}${state}`,
      JSON.stringify(stateData),
      'EX',
      OAUTH_STATE_TTL_SECONDS
    );

    const redirectUri = redirectUriFor(provider);
    // Per-company OAuth app — throws AppError 400 when not yet configured.
    const creds = await requireOAuthCredentials(companyId, provider);
    const url =
      provider === 'onedrive'
        ? buildOneDriveAuthUrl(redirectUri, state, creds)
        : buildGoogleAuthUrl(redirectUri, state, creds);

    res.json({ url });
  } catch (err) {
    next(err);
  }
});

/** GET /:provider/callback?code&state → creates source, 302 back to the app */
router.get('/:provider/callback', async (req, res, next) => {
  try {
    const provider = providerSchema.parse(req.params.provider);
    const { code, state } = callbackQuerySchema.parse(req.query);

    // Consume the state token (one-time, atomic get-and-delete)
    const raw = await getRedis().getdel(`${OAUTH_STATE_PREFIX}${state}`);
    if (!raw) throw new AppError(ErrorCodes.NOT_FOUND, 'Invalid or expired OAuth state', 404);

    const stateData = JSON.parse(raw) as OAuthStateData;
    if (stateData.provider !== provider) {
      throw new AppError(ErrorCodes.BAD_REQUEST, 'OAuth state provider mismatch', 400);
    }

    const redirectUri = redirectUriFor(provider);
    const creds = await requireOAuthCredentials(stateData.companyId, provider);
    const tokens =
      provider === 'onedrive'
        ? await exchangeOneDriveCode(code, redirectUri, creds)
        : await exchangeGoogleCode(code, redirectUri, creds);

    const accountEmail =
      provider === 'onedrive'
        ? await getMicrosoftAccountEmail(tokens.accessToken)
        : await getGoogleAccountEmail(tokens.accessToken);

    const config: DriveSourceConfig = {
      accountEmail,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : '',
      tokenExpiresAt: tokens.expiresAt,
      folderId: '',
      folderPath: '',
    };

    const id = generateId('src');
    const type: SourceType = provider;
    await db.insert(sources).values({
      id,
      companyId: stateData.companyId,
      type,
      name: accountEmail,
      enabled: true,
      config,
      cursor: {},
      // No folder chosen yet — stays pending until PATCH /:sourceId/folder
      status: SOURCE_STATUS.PENDING_AUTH,
    });

    logger.info(
      { sourceId: id, companyId: stateData.companyId, provider, accountEmail },
      '[OAuth] Connected drive source'
    );

    res.redirect(302, `${env.APP_BASE_URL}/settings/sources?connected=${provider}`);
  } catch (err) {
    next(err);
  }
});

export default router;
