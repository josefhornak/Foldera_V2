/**
 * Storage of original document files.
 *
 * Documents are kept only as long as they are useful: briefly for everything
 * (so a freshly processed document can still be previewed), and until
 * resolution for anything the user must still act on — see
 * `FILE_RETAINED_STATUSES` and `sweepExpiredFiles`.
 *
 * Files live on the volume the API and worker already share (see
 * docker-compose.production.yml). Everything goes through this module so the
 * backing store can be swapped (S3, object storage) without touching callers:
 * a `storageKey` is an opaque handle, never a path the rest of the code builds
 * or interprets.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { TMP_DIR } from '../utils/tmpDir.js';

/** Retained originals live beside — but distinct from — in-flight temp files. */
const FILES_DIR = path.join(TMP_DIR, 'files');

/**
 * Keys are flat, opaque and self-generated (`<docId>.<ext>`). Validated on every
 * read so a key that ever reaches us from a request body or a stale DB row can
 * never escape FILES_DIR via `..` or an absolute path.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]{1,12})?$/;

export async function ensureFilesDir(): Promise<string> {
  await fs.mkdir(FILES_DIR, { recursive: true });
  return FILES_DIR;
}

/** Absolute path of a stored file. Throws on a malformed key rather than guessing. */
export function resolveStoredPath(storageKey: string): string {
  if (!KEY_PATTERN.test(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  return path.join(FILES_DIR, storageKey);
}

/**
 * Take ownership of a processed file: move it out of the temp dir into the
 * store and return its key. Falls back to copy+unlink when the temp dir and the
 * store are not on the same filesystem. Returns null when the file is already
 * gone — retention is best-effort and must never fail a document.
 */
export async function persistOriginal(
  tmpPath: string,
  documentId: string,
  fileName: string
): Promise<string | null> {
  const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const storageKey = `${documentId}${ext.length > 1 && ext.length <= 12 ? ext : ''}`;
  const target = resolveStoredPath(storageKey);

  await ensureFilesDir();
  try {
    await fs.rename(tmpPath, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.copyFile(tmpPath, target);
      await fs.rm(tmpPath, { force: true });
    } else if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    } else {
      throw err;
    }
  }
  return storageKey;
}

/** True when the stored file is still on disk (it may have been swept already). */
export async function storedFileExists(storageKey: string | null): Promise<boolean> {
  if (!storageKey) return false;
  try {
    await fs.access(resolveStoredPath(storageKey));
    return true;
  } catch {
    return false;
  }
}

/** Every key currently on disk. Used to hunt down files no row points at. */
export async function listStoredKeys(): Promise<string[]> {
  try {
    return await fs.readdir(FILES_DIR);
  } catch {
    return [];
  }
}

/** Last-modified time of a stored file, or null when it is gone. */
export async function storedFileMtimeMs(storageKey: string): Promise<number | null> {
  try {
    return (await fs.stat(resolveStoredPath(storageKey))).mtimeMs;
  } catch {
    return null;
  }
}

/** Delete a stored file. Never throws — a missing file is the desired end state. */
export async function removeStored(storageKey: string | null): Promise<void> {
  if (!storageKey) return;
  try {
    await fs.rm(resolveStoredPath(storageKey), { force: true });
  } catch {
    // Malformed key or unreadable store — nothing we can do, and nothing to leak.
  }
}
