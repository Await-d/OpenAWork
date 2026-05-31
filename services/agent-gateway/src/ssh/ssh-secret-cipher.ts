/**
 * Lightweight AES-256-GCM helper used to encrypt SSH credentials at rest.
 *
 * The key is derived from `JWT_SECRET` (already required to be ≥32 chars in
 * deployment) so we don't introduce a new must-rotate secret. `null` / empty
 * input is preserved through the round-trip so callers don't have to special
 * case the missing-credential path.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc.v1.';

function deriveKey(): Buffer {
  const secret = globalThis.process?.env?.['JWT_SECRET'] ?? 'change-me-in-production-min-32-chars';
  return createHash('sha256').update(`ssh-cred:${secret}`).digest();
}

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext.length === 0) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (payload == null || payload.length === 0) return null;
  if (!payload.startsWith(PREFIX)) {
    // 兼容旧明文：回放时直接把现有值视为明文，下一次写入会自动加密。
    return payload;
  }
  try {
    const buf = Buffer.from(payload.slice(PREFIX.length), 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES) return null;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGO, deriveKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // 损坏 / 密钥变更：返回 null 让上层走"无凭证"分支，而不是 5xx。
    return null;
  }
}
