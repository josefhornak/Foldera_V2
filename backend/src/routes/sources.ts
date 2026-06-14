/**
 * Source management routes.
 *
 * Mounted at /api/companies/:companyId/sources (mergeParams).
 * All queries are company-scoped (defense-in-depth on top of requireCompany).
 * Encrypted secrets / tokens are NEVER returned to the client.
 */
import { and, asc, count, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  SOURCE_STATUS,
  SOURCE_TYPE,
  sources,
  type CollectionEmailSourceConfig,
  type DriveSourceConfig,
  type ImapSourceConfig,
  type Source,
} from '../db/schema/sources.schema.js';
import env from '../config/env.js';
import { oauthCredentials } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany, requireAdminRole } from '../middleware/companyScope.js';
import { pollLimiter, sourceWriteLimiter } from '../middleware/rateLimit.js';
import { enqueuePollSource } from '../queue/queues.js';
import {
  deprovisionCollectionMailbox,
  isCollectionEmailAvailable,
  listDriveFolders,
  provisionCollectionMailbox,
  testImapConnection,
} from '../services/sources/index.js';
import { encryptSecret } from '../utils/crypto.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { generateId } from '../utils/ids.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireCompany);

/** Hard cap on sources per company — bounds the worker's per-poll fan-out. */
const MAX_SOURCES_PER_COMPANY = 25;

/** Throw 409 when the company is already at the source cap. */
async function assertSourceCapacity(companyId: string): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(sources)
    .where(eq(sources.companyId, companyId));
  if ((row?.n ?? 0) >= MAX_SOURCES_PER_COMPANY) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      `Dosáhli jste maximálního počtu zdrojů (${MAX_SOURCES_PER_COMPANY}).`,
      409
    );
  }
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const imapConnectionSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().min(1).max(255),
  password: z.string().min(1),
  folder: z.string().min(1).max(255).optional(),
});

const imapCreateSchema = imapConnectionSchema.extend({
  name: z.string().min(1).max(200),
});

const sourceUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  // IMAP connection fields (only valid for imap sources)
  host: z.string().min(1).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().min(1).max(255).optional(),
  /** Omitted/empty = keep existing password */
  password: z.string().optional(),
  folder: z.string().min(1).max(255).optional(),
});

const watchedFolderSchema = z.object({
  folderId: z.string().min(1),
  folderPath: z.string().min(1).max(1024),
});

const folderQuerySchema = z.object({
  parentId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Public projection of a source — never includes encrypted secrets/tokens */
function toPublicSource(source: Source) {
  let detail: Record<string, unknown>;
  if (source.type === SOURCE_TYPE.COLLECTION_EMAIL) {
    detail = { address: (source.config as CollectionEmailSourceConfig).address };
  } else if (source.type === SOURCE_TYPE.IMAP) {
    const { host, port, user, folder } = source.config as ImapSourceConfig;
    detail = { host, port, user, folder };
  } else {
    const { accountEmail, folderPath } = source.config as DriveSourceConfig;
    detail = { accountEmail, folderPath };
  }

  return {
    id: source.id,
    type: source.type,
    name: source.name,
    enabled: source.enabled,
    status: source.status,
    lastError: source.lastError,
    lastSyncAt: source.lastSyncAt,
    detail,
  };
}

/** Load a source scoped to the request company; 404 when not found */
async function loadSource(req: Request): Promise<Source> {
  const sourceId = req.params.sourceId;
  if (typeof sourceId !== 'string' || !sourceId) {
    throw new AppError(ErrorCodes.BAD_REQUEST, 'Missing sourceId', 400);
  }

  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.companyId, req.company!.id)))
    .limit(1);

  if (!source) throw new AppError(ErrorCodes.NOT_FOUND, 'Source not found', 404);
  return source;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET / — list sources of the company (+ environment capabilities) */
router.get('/', async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(sources)
      .where(eq(sources.companyId, req.company!.id))
      .orderBy(asc(sources.createdAt));
    const collectionEmail = await isCollectionEmailAvailable();
    res.json({ sources: rows.map(toPublicSource), capabilities: { collectionEmail } });
  } catch (err) {
    next(err);
  }
});

/** POST /collection-email — provision an app-managed collection mailbox */
router.post('/collection-email', requireAdminRole, sourceWriteLimiter, async (req, res, next) => {
  try {
    const company = req.company!;
    await assertSourceCapacity(company.id);
    const config = await provisionCollectionMailbox(company.name);

    const id = generateId('src');
    await db.insert(sources).values({
      id,
      companyId: company.id,
      type: SOURCE_TYPE.COLLECTION_EMAIL,
      name: config.address,
      enabled: true,
      config,
      cursor: {},
      status: SOURCE_STATUS.OK,
    });

    const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
    res.status(201).json({ source: toPublicSource(row!) });
  } catch (err) {
    next(err);
  }
});

/** POST /imap/test — test an IMAP connection without creating a source */
router.post('/imap/test', requireAdminRole, sourceWriteLimiter, async (req, res, next) => {
  try {
    const body = imapConnectionSchema.parse(req.body);
    const result = await testImapConnection(body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /imap — create an IMAP source (connection is validated first) */
router.post('/imap', requireAdminRole, sourceWriteLimiter, async (req, res, next) => {
  try {
    const body = imapCreateSchema.parse(req.body);
    await assertSourceCapacity(req.company!.id);

    const test = await testImapConnection(body);
    if (!test.ok) {
      throw new AppError(
        ErrorCodes.BAD_REQUEST,
        `IMAP connection failed: ${test.error ?? 'unknown error'}`,
        400
      );
    }

    const config: ImapSourceConfig = {
      host: body.host,
      port: body.port,
      secure: body.secure,
      user: body.user,
      passwordEnc: encryptSecret(body.password),
      folder: body.folder ?? 'INBOX',
    };

    const id = generateId('src');
    await db.insert(sources).values({
      id,
      companyId: req.company!.id,
      type: SOURCE_TYPE.IMAP,
      name: body.name,
      enabled: true,
      config,
      cursor: {},
      status: SOURCE_STATUS.OK,
    });

    const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
    res.status(201).json({ source: toPublicSource(row!) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /:sourceId — update name/enabled; for IMAP also connection fields */
router.patch('/:sourceId', requireAdminRole, async (req, res, next) => {
  try {
    const source = await loadSource(req);
    const body = sourceUpdateSchema.parse(req.body);

    const connectionFieldsTouched =
      body.host !== undefined ||
      body.port !== undefined ||
      body.secure !== undefined ||
      body.user !== undefined ||
      (body.password !== undefined && body.password !== '') ||
      body.folder !== undefined;

    const updates: Partial<typeof sources.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    if (connectionFieldsTouched) {
      if (source.type !== SOURCE_TYPE.IMAP) {
        throw new AppError(
          ErrorCodes.BAD_REQUEST,
          'Connection fields can only be updated on IMAP sources',
          400
        );
      }
      const current = source.config as ImapSourceConfig;
      const newConfig: ImapSourceConfig = {
        host: body.host ?? current.host,
        port: body.port ?? current.port,
        secure: body.secure ?? current.secure,
        user: body.user ?? current.user,
        // Omitted/empty password = keep existing
        passwordEnc: body.password ? encryptSecret(body.password) : current.passwordEnc,
        folder: body.folder ?? current.folder,
      };
      updates.config = newConfig;
      updates.status = SOURCE_STATUS.OK;
      updates.lastError = null;
    }

    await db
      .update(sources)
      .set(updates)
      .where(and(eq(sources.id, source.id), eq(sources.companyId, req.company!.id)));

    const [row] = await db.select().from(sources).where(eq(sources.id, source.id)).limit(1);
    res.json({ source: toPublicSource(row!) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /:sourceId */
router.delete('/:sourceId', requireAdminRole, async (req, res, next) => {
  try {
    const source = await loadSource(req);
    await db
      .delete(sources)
      .where(and(eq(sources.id, source.id), eq(sources.companyId, req.company!.id)));
    // Best-effort teardown of the host mailbox after the row is gone.
    if (source.type === SOURCE_TYPE.COLLECTION_EMAIL) {
      await deprovisionCollectionMailbox(source.config as CollectionEmailSourceConfig);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** POST /:sourceId/poll — enqueue an on-demand poll job */
router.post('/:sourceId/poll', requireAdminRole, pollLimiter, async (req, res, next) => {
  try {
    const source = await loadSource(req);
    await enqueuePollSource(source.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET /:sourceId/folders?parentId= — drive folder listing for the picker */
router.get('/:sourceId/folders', async (req, res, next) => {
  try {
    const source = await loadSource(req);
    const { parentId } = folderQuerySchema.parse(req.query);
    const folders = await listDriveFolders(source, parentId);
    res.json({ folders });
  } catch (err) {
    next(err);
  }
});

/** PATCH /:sourceId/folder — set the watched drive folder, reset cursor */
router.patch('/:sourceId/folder', requireAdminRole, async (req, res, next) => {
  try {
    const source = await loadSource(req);
    if (source.type !== SOURCE_TYPE.ONEDRIVE && source.type !== SOURCE_TYPE.GOOGLE_DRIVE) {
      throw new AppError(
        ErrorCodes.BAD_REQUEST,
        'Watched folder can only be set on drive sources',
        400
      );
    }
    const body = watchedFolderSchema.parse(req.body);

    const current = source.config as DriveSourceConfig;
    const newConfig: DriveSourceConfig = {
      ...current,
      folderId: body.folderId,
      folderPath: body.folderPath,
    };

    await db
      .update(sources)
      .set({
        config: newConfig,
        cursor: {},
        status: SOURCE_STATUS.OK,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(sources.id, source.id), eq(sources.companyId, req.company!.id)));

    const [row] = await db.select().from(sources).where(eq(sources.id, source.id)).limit(1);
    res.json({ source: toPublicSource(row!) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Per-company OAuth app credentials (user-provided client id/secret for drives)
// ---------------------------------------------------------------------------

const DRIVE_PROVIDERS = ['google_drive', 'onedrive'] as const;
const oauthProviderSchema = z.enum(DRIVE_PROVIDERS);
const oauthCredsSchema = z.object({
  clientId: z.string().trim().min(1, 'Zadejte Client ID'),
  // Optional on edit: empty keeps the stored secret.
  clientSecret: z.string().trim().optional(),
});

function redirectUriFor(provider: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/api/oauth/${provider}/callback`;
}

/** GET /oauth-credentials → per-provider config (never returns the secret). */
router.get('/oauth-credentials', async (req, res, next) => {
  try {
    const rows = await db
      .select({ provider: oauthCredentials.provider, clientId: oauthCredentials.clientId })
      .from(oauthCredentials)
      .where(eq(oauthCredentials.companyId, req.company!.id));
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    res.json({
      providers: DRIVE_PROVIDERS.map((provider) => ({
        provider,
        configured: byProvider.has(provider),
        clientId: byProvider.get(provider)?.clientId ?? null,
        redirectUri: redirectUriFor(provider),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /oauth-credentials/:provider → save client id + secret (admin only). */
router.put('/oauth-credentials/:provider', requireAdminRole, sourceWriteLimiter, async (req, res, next) => {
  try {
    const provider = oauthProviderSchema.parse(String(req.params.provider));
    const body = oauthCredsSchema.parse(req.body);

    const [existing] = await db
      .select({ id: oauthCredentials.id })
      .from(oauthCredentials)
      .where(and(eq(oauthCredentials.companyId, req.company!.id), eq(oauthCredentials.provider, provider)))
      .limit(1);

    if (!existing && !body.clientSecret) {
      throw new AppError(ErrorCodes.BAD_REQUEST, 'Zadejte Client Secret', 400);
    }

    if (existing) {
      await db
        .update(oauthCredentials)
        .set({
          clientId: body.clientId,
          ...(body.clientSecret ? { clientSecretEnc: encryptSecret(body.clientSecret) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(oauthCredentials.id, existing.id));
    } else {
      await db.insert(oauthCredentials).values({
        id: generateId('oac'),
        companyId: req.company!.id,
        provider,
        clientId: body.clientId,
        clientSecretEnc: encryptSecret(body.clientSecret!),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /oauth-credentials/:provider (admin only). */
router.delete('/oauth-credentials/:provider', requireAdminRole, async (req, res, next) => {
  try {
    const provider = oauthProviderSchema.parse(String(req.params.provider));
    await db
      .delete(oauthCredentials)
      .where(and(eq(oauthCredentials.companyId, req.company!.id), eq(oauthCredentials.provider, provider)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
