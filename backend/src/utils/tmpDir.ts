/**
 * Shared temp directory for in-flight document files. Both the API server
 * (manual uploads) and the worker (source pollers + pipeline) use it — in
 * production the two containers share it as a volume (see
 * docker-compose.production.yml).
 *
 * Files here are ephemeral: once the pipeline is done it either hands the file
 * to `services/storage.ts` (which moves it into the retained store under a
 * `storageKey`) or drops it. Nothing should read from here afterwards.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TMP_DIR = path.join(os.tmpdir(), 'foldera-v2');

export async function ensureTmpDir(): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  return TMP_DIR;
}
