import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, sha256Hex } from './crypto.js';

describe('crypto utils', () => {
  it('round-trips a secret through AES-256-GCM', () => {
    const secret = 'imap-password-with-diacritics-příliš-žluťoučký';
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it('produces unique ciphertexts for the same plaintext (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('fails to decrypt tampered ciphertext', () => {
    const encrypted = encryptSecret('secret');
    const raw = Buffer.from(encrypted, 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(() => decryptSecret(raw.toString('base64'))).toThrow();
  });

  it('computes stable sha256 hex digests', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
