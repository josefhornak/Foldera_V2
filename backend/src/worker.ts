/**
 * Background worker process — runs separately from the API server.
 *
 * - poll-sources: repeatable job (every SOURCE_POLL_INTERVAL_MIN) walks all
 *   enabled sources, downloads new files to a temp dir and enqueues
 *   process-document jobs. Manual per-source polls arrive on the same queue.
 * - process-document: full pipeline (extract → ABRA Flexi → cleanup).
 * - export-retry: re-export from stored extraction after an ABRA failure.
 */

import { Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import env from './config/env.js';
import { db } from './db/client.js';
import { sources, SOURCE_STATUS } from './db/schema/index.js';
import { pollSource } from './services/sources/index.js';
import { startMaildirWatchers } from './services/sources/maildirWatcher.js';
import { runMonthlyInvoicing } from './services/invoicing.js';
import { runTrialEndNotifications } from './services/notifications.js';
import { createRedisConnection } from './queue/connection.js';
import { processIncomingFile, retryExport } from './queue/pipeline.js';
import {
  getPollQueue,
  getInvoicesQueue,
  enqueueProcessDocument,
  enqueuePollSource,
  QUEUE_NAMES,
  type ExportRetryJobData,
  type PollSourcesJobData,
  type ProcessDocumentJobData,
} from './queue/queues.js';
import { toError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { ensureTmpDir, TMP_DIR } from './utils/tmpDir.js';


async function pollOneSource(sourceId: string): Promise<void> {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source || !source.enabled) return;
  if (source.status === SOURCE_STATUS.PENDING_AUTH) return;

  const log = logger.child({ sourceId: source.id, type: source.type, companyId: source.companyId });
  try {
    const result = await pollSource(source, TMP_DIR);

    for (const file of result.files) {
      await enqueueProcessDocument({
        companyId: source.companyId,
        sourceId: source.id,
        file: {
          externalRef: file.externalRef,
          fileName: file.fileName,
          mimeType: file.mimeType,
          filePath: file.filePath,
          receivedAt: file.receivedAt.toISOString(),
          originalEmailPath: file.originalEmailPath,
        },
      });
    }

    await db
      .update(sources)
      .set({
        cursor: result.cursor,
        status: SOURCE_STATUS.OK,
        lastError: null,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(sources.id, source.id), eq(sources.companyId, source.companyId)));

    if (result.files.length > 0) {
      log.info({ count: result.files.length }, '[Worker] New files queued for processing');
    }
  } catch (error) {
    const message = toError(error).message;
    log.error({ error: message }, '[Worker] Source poll failed');
    await db
      .update(sources)
      .set({ status: SOURCE_STATUS.ERROR, lastError: message, updatedAt: new Date() })
      .where(and(eq(sources.id, source.id), eq(sources.companyId, source.companyId)));
  }
}

async function pollAllSources(): Promise<void> {
  const rows = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.enabled, true));
  for (const row of rows) {
    await pollOneSource(row.id);
  }
}

async function main(): Promise<void> {
  await ensureTmpDir();

  const pollWorker = new Worker<PollSourcesJobData>(
    QUEUE_NAMES.POLL_SOURCES,
    async (job) => {
      if (job.data.sourceId) await pollOneSource(job.data.sourceId);
      else await pollAllSources();
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  const processWorker = new Worker<ProcessDocumentJobData>(
    QUEUE_NAMES.PROCESS_DOCUMENT,
    async (job) => {
      await processIncomingFile(job.data);
    },
    { connection: createRedisConnection(), concurrency: env.WORKER_PROCESS_CONCURRENCY }
  );

  const retryWorker = new Worker<ExportRetryJobData>(
    QUEUE_NAMES.EXPORT_RETRY,
    async (job) => {
      await retryExport(job.data.documentId, job.data.companyId);
    },
    { connection: createRedisConnection(), concurrency: env.WORKER_RETRY_CONCURRENCY }
  );

  const invoicesWorker = new Worker(
    QUEUE_NAMES.MONTHLY_INVOICES,
    async () => {
      // Isolated so a failure in the trial sweep can never block invoicing.
      try {
        await runTrialEndNotifications();
      } catch (error) {
        logger.error({ error: toError(error).message }, '[Worker] Trial-end sweep failed');
      }
      await runMonthlyInvoicing();
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  for (const w of [pollWorker, processWorker, retryWorker, invoicesWorker]) {
    w.on('failed', (job, err) => {
      logger.error({ queue: w.name, jobId: job?.id, error: err.message }, '[Worker] Job failed');
    });
  }

  // Repeatable schedule: poll all sources every N minutes
  await getPollQueue().upsertJobScheduler(
    'poll-all-sources',
    { every: env.SOURCE_POLL_INTERVAL_MIN * 60 * 1000 },
    { name: 'poll-all', data: {} }
  );

  // Daily: issue the prior month's subscription invoices (idempotent per period).
  await getInvoicesQueue().upsertJobScheduler(
    'monthly-invoices',
    { pattern: '0 6 * * *' },
    { name: 'invoice-run', data: {} }
  );

  // Near-instant collection-email ingestion: watch each mailbox's maildir and
  // enqueue a poll the moment Postfix delivers a message (the 5-min schedule
  // remains the fallback / handles Drive sources).
  const stopMaildirWatchers = startMaildirWatchers((sourceId) => {
    void enqueuePollSource(sourceId);
  });

  logger.info(
    { pollIntervalMin: env.SOURCE_POLL_INTERVAL_MIN, tmpDir: TMP_DIR },
    'Foldera V2 worker started'
  );

  const shutdown = async () => {
    logger.info('Worker shutting down…');
    stopMaildirWatchers();
    await Promise.all([pollWorker.close(), processWorker.close(), retryWorker.close(), invoicesWorker.close()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error({ error: toError(error).message }, 'Worker failed to start');
  process.exit(1);
});
