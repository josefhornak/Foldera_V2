/**
 * AES-256-GCM encryption for stored credentials (IMAP passwords, OAuth
 * refresh tokens, ABRA Flexi passwords). Key comes from APP_ENCRYPTION_KEY
 * (32 bytes hex). Format: base64(iv | authTag | ciphertext).
 */
import crypto from 'node:crypto';

import env from '../config/env.js';
import { AppError, ErrorCodes } from './errors.js';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  if (!env.APP_ENCRYPTION_KEY) {
    throw new AppError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      'APP_ENCRYPTION_KEY is not configured — cannot store credentials',
      500
    );
  }
  return Buffer.from(env.APP_ENCRYPTION_KEY, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
