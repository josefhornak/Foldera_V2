/**
 * Near-instant collection-email ingestion.
 *
 * The 5-minute `poll-sources` schedule still walks every source, but for
 * collection-email mailboxes we additionally watch each maildir `new/` directory
 * with the OS file watcher (inotify on Linux). The moment Postfix delivers a
 * message, `onMessage(sourceId)` fires and we enqueue an immediate poll — so a
 * forwarded invoice is processed in seconds, matching Foldera V1's behaviour,
 * instead of waiting up to 5 minutes.
 *
 * Sources can be created/removed at any time, so a lightweight reconcile loop
 * re-arms watchers against the current enabled collection-email sources.
 */

import { watch, type FSWatcher } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';

import env from '../../config/env.js';
import { db } from '../../db/client.js';
import { sources, SOURCE_TYPE } from '../../db/schema/index.js';
import { toError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/** How often to re-scan for new/removed mailboxes to (un)watch. */
const RECONCILE_INTERVAL_MS = 60_000;
/** Coalesce the burst of fs events Postfix emits while delivering one message. */
const DEBOUNCE_MS = 1_500;

interface WatchEntry {
  watcher: FSWatcher;
  debounce?: NodeJS.Timeout;
}

/**
 * Start watching collection-email maildirs. Returns a stop function that closes
 * all watchers and the reconcile timer.
 */
export function startMaildirWatchers(onMessage: (sourceId: string) => void): () => void {
  const watched = new Map<string, WatchEntry>();

  async function reconcile(): Promise<void> {
    let rows: { id: string; config: unknown }[] = [];
    try {
      rows = await db
        .select({ id: sources.id, config: sources.config })
        .from(sources)
        .where(and(eq(sources.type, SOURCE_TYPE.COLLECTION_EMAIL), eq(sources.enabled, true)));
    } catch (error) {
      logger.warn({ error: toError(error).message }, '[maildir-watch] reconcile query failed');
      return;
    }

    const wanted = new Set<string>();
    for (const row of rows) {
      const cfg = row.config as { domain?: string; localPart?: string } | null;
      if (!cfg?.domain || !cfg?.localPart) continue;
      wanted.add(row.id);
      if (watched.has(row.id)) continue;

      const newDir = path.join(env.MAILDIR_BASE, cfg.domain, cfg.localPart, 'new');
      try {
        await access(newDir); // not provisioned yet → retry on the next reconcile
      } catch {
        continue;
      }

      try {
        const watcher = watch(newDir, () => {
          const entry = watched.get(row.id);
          if (!entry) return;
          if (entry.debounce) clearTimeout(entry.debounce);
          entry.debounce = setTimeout(() => onMessage(row.id), DEBOUNCE_MS);
        });
        watcher.on('error', (error) => {
          logger.warn({ sourceId: row.id, error: String(error) }, '[maildir-watch] watcher error');
          try {
            watcher.close();
          } catch {
            /* already closed */
          }
          watched.delete(row.id);
        });
        watched.set(row.id, { watcher });
        logger.info({ sourceId: row.id, newDir }, '[maildir-watch] watching mailbox');
      } catch (error) {
        logger.warn(
          { sourceId: row.id, error: toError(error).message },
          '[maildir-watch] failed to arm watcher'
        );
      }
    }

    // Drop watchers for sources that are gone or disabled.
    for (const [id, entry] of watched) {
      if (wanted.has(id)) continue;
      if (entry.debounce) clearTimeout(entry.debounce);
      try {
        entry.watcher.close();
      } catch {
        /* already closed */
      }
      watched.delete(id);
    }
  }

  void reconcile();
  const timer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    for (const entry of watched.values()) {
      if (entry.debounce) clearTimeout(entry.debounce);
      try {
        entry.watcher.close();
      } catch {
        /* already closed */
      }
    }
    watched.clear();
  };
}
