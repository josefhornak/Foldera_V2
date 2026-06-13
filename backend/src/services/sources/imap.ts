/**
 * IMAP source poller — watches a collection mailbox for invoice attachments.
 *
 * Cursor semantics:
 * - `lastUid`: highest processed UID in the watched mailbox
 * - `uidValidity`: UIDVALIDITY the lastUid belongs to; when the server reports
 *   a different UIDVALIDITY the UID space was reset → start over (lastUid = 0)
 * - First run (lastUid = 0): only messages from the last 7 days are considered
 *   to avoid flooding the pipeline with the whole mailbox history.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import type { ImapSourceConfig, Source, SourceCursor } from '../../db/schema/sources.schema.js';
import { SOURCE_TYPE } from '../../db/schema/sources.schema.js';
import type { IncomingFile, PollResult } from '../../types/contracts.js';
import { decryptSecret } from '../../utils/crypto.js';
import { AppError, ErrorCodes, toError } from '../../utils/errors.js';
import { assertPublicHost } from '../../utils/urlValidation.js';
import { logger } from '../../utils/logger.js';
import { filterInvoiceAttachments, resolveMimeType } from './attachmentFilter.js';
import { uniqueTempFileName } from './common.js';

const DEFAULT_FOLDER = 'INBOX';
const FIRST_RUN_LOOKBACK_DAYS = 7;
/** Upper bound of messages handled in a single poll run */
const MAX_MESSAGES_PER_POLL = 100;
/** Skip attachments larger than this — bounds disk/CPU from a hostile mailbox. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Plaintext password */
  password: string;
  folder?: string;
}

function createClient(cfg: ImapConnectionConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  });
}

async function closeClient(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

/**
 * Poll an IMAP source for new messages and download invoice-candidate
 * attachments into `tmpDir`.
 */
export async function pollImapSource(source: Source, tmpDir: string): Promise<PollResult> {
  if (source.type !== SOURCE_TYPE.IMAP) {
    throw new AppError(ErrorCodes.BAD_REQUEST, 'Source is not an IMAP source', 400);
  }
  const config = source.config as ImapSourceConfig;
  const folder = config.folder || DEFAULT_FOLDER;
  const password = decryptSecret(config.passwordEnc);

  // SSRF guard: never connect to an internal address, even for a stored source.
  await assertPublicHost(config.host, 'IMAP');

  const client = createClient({ ...config, password, folder });
  const files: IncomingFile[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox = client.mailbox;
      if (typeof mailbox === 'boolean') {
        throw new AppError(ErrorCodes.SERVICE_UNAVAILABLE, `Failed to open mailbox "${folder}"`, 502);
      }

      const uidValidity = mailbox.uidValidity.toString();
      let lastUid = source.cursor.lastUid ?? 0;
      if (source.cursor.uidValidity && source.cursor.uidValidity !== uidValidity) {
        logger.warn(
          { sourceId: source.id, previous: source.cursor.uidValidity, current: uidValidity },
          '[IMAP] UIDVALIDITY changed — resetting cursor'
        );
        lastUid = 0;
      }

      // Determine which UIDs to process
      let uids: number[];
      if (lastUid === 0) {
        // First run (or UID space reset): only look back a bounded window
        const since = new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const found: unknown = await client.search({ since }, { uid: true });
        uids = Array.isArray(found) ? found : [];
      } else {
        const found: unknown = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        uids = Array.isArray(found) ? found : [];
      }
      // Servers return the last message for "<n>:*" even when n > uidNext — filter defensively
      uids = uids
        .filter((uid) => uid > lastUid)
        .sort((a, b) => a - b)
        .slice(0, MAX_MESSAGES_PER_POLL);

      let maxUid = lastUid;
      for (const uid of uids) {
        const message = await client.fetchOne(
          String(uid),
          { source: true, internalDate: true },
          { uid: true }
        );
        maxUid = Math.max(maxUid, uid);
        if (!message || !message.source) {
          logger.warn({ sourceId: source.id, uid }, '[IMAP] Message has no source — skipping');
          continue;
        }

        const parsed = await simpleParser(message.source);
        const candidates = filterInvoiceAttachments(parsed.attachments);
        if (candidates.length === 0) {
          // Email without usable attachments (plain body, logos only, …) → skip
          continue;
        }

        const messageRef = parsed.messageId ?? String(uid);
        const internalDate = message.internalDate;
        const receivedAt =
          internalDate instanceof Date
            ? internalDate
            : internalDate
              ? new Date(internalDate)
              : (parsed.date ?? new Date());

        for (const [index, attachment] of candidates.entries()) {
          if (!attachment.content || attachment.content.length > MAX_ATTACHMENT_BYTES) {
            logger.warn(
              { sourceId: source.id, uid, size: attachment.content?.length ?? 0 },
              '[IMAP] Attachment too large — skipping'
            );
            continue;
          }
          const mimeType =
            resolveMimeType(attachment.contentType, attachment.filename) ?? attachment.contentType;
          const fileName = attachment.filename || `attachment-${uid}-${index}`;
          const filePath = path.join(tmpDir, uniqueTempFileName(fileName));
          await fs.writeFile(filePath, attachment.content);

          files.push({
            externalRef: `${messageRef}:${index}`,
            fileName,
            mimeType,
            filePath,
            receivedAt,
          });
        }
      }

      const cursor: SourceCursor = { lastUid: maxUid, uidValidity };
      logger.info(
        { sourceId: source.id, folder, messages: uids.length, files: files.length, lastUid: maxUid },
        '[IMAP] Poll completed'
      );
      return { files, cursor };
    } finally {
      lock.release();
    }
  } finally {
    await closeClient(client);
  }
}

/**
 * Test an IMAP connection (connect + open folder), without fetching messages.
 */
export async function testImapConnection(
  cfg: ImapConnectionConfig
): Promise<{ ok: boolean; error?: string }> {
  try {
    // SSRF guard runs before any connection attempt (covers /imap/test + create).
    await assertPublicHost(cfg.host, 'IMAP');
  } catch (err) {
    return { ok: false, error: toError(err).message };
  }
  const client = createClient(cfg);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.folder || DEFAULT_FOLDER, { readOnly: true });
    lock.release();
    await closeClient(client);
    return { ok: true };
  } catch (err: unknown) {
    client.close();
    return { ok: false, error: toError(err).message };
  }
}
