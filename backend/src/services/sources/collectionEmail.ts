/**
 * Collection-email source — an app-provisioned mailbox on the host Postfix.
 *
 * Provisioning (API process): generate a unique local part, register the
 * address in Postfix's `virtual_mailboxes` map and create the maildir. The
 * host's postfix-watcher then runs `postmap` and fixes ownership/permissions.
 *
 * Ingestion (worker process): `pollCollectionEmailSource` reads the maildir's
 * `new/` directory, extracts invoice-candidate attachments and removes the
 * processed message (files are ephemeral — only extracted metadata is kept).
 *
 * No credentials are stored: delivery is local, so there is nothing to encrypt.
 */
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { simpleParser } from 'mailparser';

import env from '../../config/env.js';
import {
  SOURCE_TYPE,
  type CollectionEmailSourceConfig,
  type Source,
} from '../../db/schema/sources.schema.js';
import type { IncomingFile, PollResult } from '../../types/contracts.js';
import { AppError, ErrorCodes, toError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { filterInvoiceAttachments, resolveMimeType } from './attachmentFilter.js';
import { uniqueTempFileName } from './common.js';

/** Upper bound of messages handled in a single poll run */
const MAX_MESSAGES_PER_POLL = 100;

/** Serialises writes to the shared Postfix map within this process. */
let writeChain: Promise<void> = Promise.resolve();
function withMapLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  // keep the chain alive regardless of individual outcomes
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Normalise a company name into an email local part: strip diacritics,
 * lowercase, keep [a-z0-9-], collapse and trim hyphens.
 */
export function slugifyLocalPart(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
  return base || 'firma';
}

/** True when the host Postfix map and maildir base are present and writable. */
export async function isCollectionEmailAvailable(): Promise<boolean> {
  try {
    await fs.access(env.POSTFIX_VIRTUAL_MAILBOXES_FILE, fsConstants.W_OK);
    await fs.access(env.MAILDIR_BASE, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function maildirPath(domain: string, localPart: string): string {
  return path.join(env.MAILDIR_BASE, domain, localPart);
}

async function readMapLines(): Promise<string[]> {
  try {
    const content = await fs.readFile(env.POSTFIX_VIRTUAL_MAILBOXES_FILE, 'utf8');
    return content.split('\n').filter((l) => l.trim().length > 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Write the map IN PLACE (no temp+rename). The host postfix-watcher arms an
 * inotify watch on this file's inode; replacing the inode via rename would
 * silently detach that watch, so postmap would never run. An in-place truncate
 * keeps the inode and fires modify/close_write, which triggers postmap.
 */
async function writeMapLines(lines: string[]): Promise<void> {
  await fs.writeFile(env.POSTFIX_VIRTUAL_MAILBOXES_FILE, lines.join('\n') + '\n');
}

/** All local parts already registered for `domain` (across V1 + V2). */
function localPartsForDomain(lines: string[], domain: string): Set<string> {
  const taken = new Set<string>();
  const suffix = `@${domain}`;
  for (const line of lines) {
    const addr = line.split(/\s+/)[0];
    if (addr?.endsWith(suffix)) taken.add(addr.slice(0, -suffix.length));
  }
  return taken;
}

/**
 * Provision a new collection mailbox for `companyName` on the host Postfix.
 * Returns the generated address. Idempotency is not required — each call mints
 * a fresh, unique local part.
 */
export async function provisionCollectionMailbox(
  companyName: string
): Promise<CollectionEmailSourceConfig> {
  if (!(await isCollectionEmailAvailable())) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      'Sběrný e-mail není v tomto prostředí dostupný',
      503
    );
  }
  const domain = env.COLLECTION_EMAIL_DOMAIN;

  return withMapLock(async () => {
    const lines = await readMapLines();
    const taken = localPartsForDomain(lines, domain);

    const base = slugifyLocalPart(companyName);
    let localPart = base;
    for (let i = 2; taken.has(localPart); i++) localPart = `${base}-${i}`;

    const address = `${localPart}@${domain}`;
    // `address  domain/localPart/` — trailing slash = maildir format
    await writeMapLines([...lines, `${address} ${domain}/${localPart}/`]);

    // Create the maildir; the postfix-watcher fixes ownership/permissions.
    const dir = maildirPath(domain, localPart);
    for (const sub of ['tmp', 'new', 'cur']) {
      await fs.mkdir(path.join(dir, sub), { recursive: true, mode: 0o770 });
    }

    logger.info({ address }, '[collection-email] Provisioned mailbox');
    return { address, localPart, domain };
  });
}

/** Remove a collection mailbox from Postfix and delete its maildir. */
export async function deprovisionCollectionMailbox(config: CollectionEmailSourceConfig): Promise<void> {
  if (!(await isCollectionEmailAvailable())) return;
  await withMapLock(async () => {
    const lines = await readMapLines();
    const prefix = `${config.address} `;
    const next = lines.filter((l) => !l.startsWith(prefix));
    if (next.length !== lines.length) await writeMapLines(next);
  });
  try {
    await fs.rm(maildirPath(config.domain, config.localPart), { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      { address: config.address, error: toError(err).message },
      '[collection-email] Failed to remove maildir'
    );
  }
}

/**
 * Poll a collection-email source: read messages from the maildir `new/`,
 * extract invoice-candidate attachments and remove processed messages.
 */
export async function pollCollectionEmailSource(source: Source, tmpDir: string): Promise<PollResult> {
  if (source.type !== SOURCE_TYPE.COLLECTION_EMAIL) {
    throw new AppError(ErrorCodes.BAD_REQUEST, 'Source is not a collection-email source', 400);
  }
  const config = source.config as CollectionEmailSourceConfig;
  const dir = maildirPath(config.domain, config.localPart);
  const newDir = path.join(dir, 'new');
  const curDir = path.join(dir, 'cur');

  const files: IncomingFile[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(newDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // maildir vanished (e.g. mailbox not yet delivered to) — nothing to do
      return { files, cursor: {} };
    }
    throw err;
  }
  entries.sort().splice(MAX_MESSAGES_PER_POLL);

  for (const entry of entries) {
    const msgPath = path.join(newDir, entry);
    try {
      const stat = await fs.stat(msgPath);
      if (!stat.isFile()) continue;
      const raw = await fs.readFile(msgPath);
      const parsed = await simpleParser(raw);
      const candidates = filterInvoiceAttachments(parsed.attachments);

      const messageRef = parsed.messageId ?? entry;
      const receivedAt = parsed.date ?? stat.mtime;

      for (const [index, attachment] of candidates.entries()) {
        const mimeType =
          resolveMimeType(attachment.contentType, attachment.filename) ?? attachment.contentType;
        const fileName = attachment.filename || `attachment-${index}`;
        const filePath = path.join(tmpDir, uniqueTempFileName(fileName));
        await fs.writeFile(filePath, attachment.content);
        files.push({ externalRef: `${messageRef}:${index}`, fileName, mimeType, filePath, receivedAt });
      }

      // Message handled (with or without usable attachments) — delete it so it
      // is not reprocessed. There is no cursor for maildir sources.
      await fs.rm(msgPath, { force: true });
    } catch (err) {
      // Move unparseable messages aside so they don't loop forever.
      logger.warn(
        { sourceId: source.id, entry, error: toError(err).message },
        '[collection-email] Failed to process message — moving to cur/'
      );
      await fs.mkdir(curDir, { recursive: true }).catch(() => {});
      await fs.rename(msgPath, path.join(curDir, entry)).catch(() => {});
    }
  }

  logger.info(
    { sourceId: source.id, address: config.address, files: files.length },
    '[collection-email] Poll completed'
  );
  return { files, cursor: {} };
}
