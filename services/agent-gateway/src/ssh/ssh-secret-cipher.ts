import { sshCredentialKeys, SshCredentialKeyError } from './ssh-credential-key.js';
/**
 * Lightweight AES-256-GCM helper used to encrypt SSH credentials at rest.
 *
 * New credentials use a persisted random key independent of JWT rotation.
 * The previous JWT-derived key is retained only for reading legacy credentials. `null` / empty
 * input is preserved through the round-trip so callers don't have to special
 * case the missing-credential path.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc.v2.';
const LEGACY_PREFIX = 'enc.v1.';

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext.length === 0) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, sshCredentialKeys().key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (payload == null || payload.length === 0) return null;
  if (!payload.startsWith(PREFIX) && !payload.startsWith(LEGACY_PREFIX)) {
    // 兼容旧明文：回放时直接把现有值视为明文，下一次写入会自动加密。
    return payload;
  }
  try {
    const buf = Buffer.from(payload.slice(PREFIX.length), 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES)
      throw new SshCredentialKeyError('SSH 凭证密文已损坏，请重新保存凭证。');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(
      ALGO,
      payload.startsWith(LEGACY_PREFIX) ? sshCredentialKeys().legacyKey : sshCredentialKeys().key,
      iv,
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    if (error instanceof SshCredentialKeyError) throw error;
    throw new SshCredentialKeyError(
      'SSH 凭证解密失败，请恢复 ssh-credential-key.json 或重新保存凭证。',
    );
  }
}
