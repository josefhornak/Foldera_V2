import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureFilesDir,
  listStoredKeys,
  persistOriginal,
  removeStored,
  resolveStoredPath,
  storedFileExists,
} from './storage.js';

const FILES_DIR = path.join(os.tmpdir(), 'foldera-v2', 'files');
const created: string[] = [];

async function makeTempFile(name: string, content = 'faktura'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  created.push(dir);
  return filePath;
}

afterEach(async () => {
  for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  for (const key of await listStoredKeys()) {
    if (key.startsWith('doc_test')) await removeStored(key);
  }
});

describe('resolveStoredPath', () => {
  it('resolves a well-formed key inside the store', () => {
    expect(resolveStoredPath('doc_abc123.pdf')).toBe(path.join(FILES_DIR, 'doc_abc123.pdf'));
  });

  // A key must never be able to address anything outside the store, however it
  // reached us (stale row, crafted request).
  it.each(['../../etc/passwd', '/etc/passwd', 'doc/../../x.pdf', 'a b.pdf', '', '.'])(
    'rejects the unsafe key %j',
    (key) => {
      expect(() => resolveStoredPath(key)).toThrow(/Invalid storage key/);
    }
  );
});

describe('persistOriginal', () => {
  it('moves the file into the store and keeps its extension', async () => {
    const tmpPath = await makeTempFile('upload-x.PDF', 'obsah faktury');

    const key = await persistOriginal(tmpPath, 'doc_test1', 'faktura-2026.PDF');

    expect(key).toBe('doc_test1.pdf');
    expect(await storedFileExists(key)).toBe(true);
    await expect(fs.readFile(resolveStoredPath(key!), 'utf8')).resolves.toBe('obsah faktury');
    // The temp copy is gone — the store now owns the file.
    await expect(fs.access(tmpPath)).rejects.toThrow();
  });

  it('drops an unusable extension rather than building a broken key', async () => {
    const tmpPath = await makeTempFile('weird');

    const key = await persistOriginal(tmpPath, 'doc_test2', 'faktura.thisisnotanextension');

    expect(key).toBe('doc_test2');
    expect(await storedFileExists(key)).toBe(true);
  });

  it('returns null when the file is already gone', async () => {
    await ensureFilesDir();
    const key = await persistOriginal(path.join(os.tmpdir(), 'does-not-exist-9f3a'), 'doc_test3', 'x.pdf');

    expect(key).toBeNull();
  });
});

describe('removeStored', () => {
  it('deletes a stored file', async () => {
    const tmpPath = await makeTempFile('upload.pdf');
    const key = await persistOriginal(tmpPath, 'doc_test4', 'f.pdf');

    await removeStored(key);

    expect(await storedFileExists(key)).toBe(false);
  });

  // A missing file is the desired end state, and a bad key is not worth an
  // exception on a cleanup path — neither may throw.
  it.each([null, 'doc_test_missing.pdf', '../escape'])('is a no-op for %j', async (key) => {
    await expect(removeStored(key)).resolves.toBeUndefined();
  });
});

describe('storedFileExists', () => {
  it('is false for a null key and for a malformed one', async () => {
    expect(await storedFileExists(null)).toBe(false);
    expect(await storedFileExists('../escape')).toBe(false);
  });
});
