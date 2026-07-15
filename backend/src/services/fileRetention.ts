/**
 * Retention policy for original document files.
 *
 * We store other people's invoices, so we keep them for as long as the product
 * needs them and not a day longer:
 *
 * - documents the user must still act on (failed export/extraction, held for
 *   review, still processing) keep their file until they are exported or
 *   deleted — the user has to see what they are fixing, and a resend has to
 *   re-attach the original in ABRA Flexi;
 * - everything else (exported, skipped) keeps its file for
 *   `FILE_RETENTION_DAYS` after processing, so a fresh document can still be
 *   previewed, and is then swept;
 * - deleting a document drops its file immediately (see the documents route).
 */
import { and, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';

import env from '../config/env.js';
import { db } from '../db/client.js';
import { documents, FILE_RETAINED_STATUSES } from '../db/schema/index.js';
import { logger } from '../utils/logger.js';
import { toError } from '../utils/errors.js';
import { listStoredKeys, removeStored, storedFileMtimeMs } from './storage.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An orphan is a file no row points at — a crash between storing the file and
 * recording its key. Only swept once comfortably older than any in-flight job,
 * so a file being written right now is never mistaken for one.
 */
const ORPHAN_MIN_AGE_MS = DAY_MS;

/** Drop files of settled documents past their retention window. */
async function sweepSettled(): Promise<number> {
  const cutoff = new Date(Date.now() - env.FILE_RETENTION_DAYS * DAY_MS);
  const expired = await db
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(
      and(
        isNotNull(documents.storageKey),
        notInArray(documents.status, [...FILE_RETAINED_STATUSES]),
        sql`coalesce(${documents.processedAt}, ${documents.createdAt}) <= ${cutoff}`
      )
    );

  for (const row of expired) {
    await removeStored(row.storageKey);
    await db.update(documents).set({ storageKey: null }).where(eq(documents.id, row.id));
  }
  return expired.length;
}

/** Drop files on disk that no document references. */
async function sweepOrphans(): Promise<number> {
  const keys = await listStoredKeys();
  if (keys.length === 0) return 0;

  const known = new Set(
    (
      await db
        .select({ storageKey: documents.storageKey })
        .from(documents)
        .where(inArray(documents.storageKey, keys))
    ).map((r) => r.storageKey)
  );

  const now = Date.now();
  let removed = 0;
  for (const key of keys) {
    if (known.has(key)) continue;
    const mtimeMs = await storedFileMtimeMs(key);
    if (mtimeMs === null || now - mtimeMs < ORPHAN_MIN_AGE_MS) continue;
    await removeStored(key);
    removed++;
  }
  return removed;
}

/** One retention pass. Safe to run concurrently — every delete is idempotent. */
export async function sweepExpiredFiles(): Promise<void> {
  try {
    const [settled, orphans] = [await sweepSettled(), await sweepOrphans()];
    if (settled > 0 || orphans > 0) {
      logger.info({ settled, orphans }, '[Retention] Swept expired document files');
    }
  } catch (error) {
    logger.error({ error: toError(error).message }, '[Retention] Sweep failed');
  }
}

/**
 * Run the sweep on a timer for the lifetime of the worker. Returns a stop
 * function. The first pass runs immediately so a restart clears any backlog.
 */
export function startFileRetentionSweep(): () => void {
  void sweepExpiredFiles();
  const timer = setInterval(
    () => void sweepExpiredFiles(),
    env.FILE_SWEEP_INTERVAL_MIN * 60 * 1000
  );
  timer.unref();
  return () => clearInterval(timer);
}
