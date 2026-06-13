import { Queue } from 'bullmq';

import { createRedisConnection } from './connection.js';

export const QUEUE_NAMES = {
  POLL_SOURCES: 'poll-sources',
  PROCESS_DOCUMENT: 'process-document',
  EXPORT_RETRY: 'export-retry',
  MONTHLY_INVOICES: 'monthly-invoices',
} as const;

export interface PollSourcesJobData {
  /** Specific source to poll, or undefined = all enabled sources */
  sourceId?: string;
}

export interface ProcessDocumentJobData {
  companyId: string;
  /** Null for manual uploads — the file did not come from a polled source */
  sourceId: string | null;
  file: {
    externalRef: string;
    fileName: string;
    mimeType: string;
    filePath: string;
    receivedAt: string;
    /** For e-mail sources: temp path to the original message (.eml), if captured. */
    originalEmailPath?: string;
  };
}

export interface ExportRetryJobData {
  documentId: string;
  companyId: string;
}

let pollQueue: Queue<PollSourcesJobData> | null = null;
let processQueue: Queue<ProcessDocumentJobData> | null = null;
let retryQueue: Queue<ExportRetryJobData> | null = null;
let invoicesQueue: Queue | null = null;

export function getInvoicesQueue(): Queue {
  if (!invoicesQueue) {
    invoicesQueue = new Queue(QUEUE_NAMES.MONTHLY_INVOICES, { connection: createRedisConnection() });
  }
  return invoicesQueue;
}

export function getPollQueue(): Queue<PollSourcesJobData> {
  if (!pollQueue) {
    pollQueue = new Queue(QUEUE_NAMES.POLL_SOURCES, { connection: createRedisConnection() });
  }
  return pollQueue;
}

export function getProcessQueue(): Queue<ProcessDocumentJobData> {
  if (!processQueue) {
    processQueue = new Queue(QUEUE_NAMES.PROCESS_DOCUMENT, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return processQueue;
}

export function getRetryQueue(): Queue<ExportRetryJobData> {
  if (!retryQueue) {
    retryQueue = new Queue(QUEUE_NAMES.EXPORT_RETRY, {
      connection: createRedisConnection(),
      defaultJobOptions: { attempts: 1, removeOnComplete: { count: 1000 } },
    });
  }
  return retryQueue;
}

export async function enqueueProcessDocument(data: ProcessDocumentJobData): Promise<void> {
  await getProcessQueue().add('process', data);
}

export async function enqueueExportRetry(data: ExportRetryJobData): Promise<void> {
  await getRetryQueue().add('retry', data);
}

export async function enqueuePollSource(sourceId: string): Promise<void> {
  await getPollQueue().add('poll-one', { sourceId });
}
