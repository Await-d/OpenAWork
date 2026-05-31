/**
 * Password hashing with salt + a memory-hard KDF (scrypt), plus transparent
 * verification of the legacy unsalted SHA-256 hashes already in the DB.
 *
 * Background: every credential path (`/auth/login`, `/auth/register`,
 * `/auth/admin-set-password`, the seeded admin in `index.ts`) historically
 * stored `sha256(password)` with NO salt — so identical passwords collide,
 * the hashes are trivially rainbow-table / GPU brute-forceable, and the login
 * compare used a non-constant-time `!==`. Since the gateway is reachable over
 * the LAN, an attacker who reads the DB (or the compare timing) gets cheap
 * offline cracking. This module:
 *
 *   1. Hashes new passwords with `scrypt` (built into `node:crypto`, so no new
 *      dependency) over a random 16-byte salt, stored as
 *      `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`.
 *   2. Verifies in CONSTANT time via `timingSafeEqual`.
 *   3. Still verifies a legacy bare-64-hex SHA-256 hash, flagging
 *      `needsUpgrade` so the caller can transparently re-hash on the next
 *      successful login — existing users keep working, and their stored hash
 *      silently migrates to scrypt without a forced reset.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt cost parameters. N must be a power of two; (N=16384, r=8, p=1) is the
// commonly recommended interactive-login baseline and keeps a single hash well
// under ~100ms on typical hardware.
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const SCRYPT_PREFIX = 'scrypt';
const LEGACY_SHA256_RE = /^[0-9a-f]{64}$/;

export interface PasswordVerifyResult {
  /** True when the password matches the stored hash. */
  valid: boolean;
  /**
   * True when `valid` but the stored hash is in the legacy SHA-256 format and
   * should be re-hashed with the current scheme. Always false when invalid.
   */
  needsUpgrade: boolean;
}

/** Hash a plaintext password with scrypt over a fresh random salt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // scrypt needs maxmem >= 128*N*r; the default 32MB is too small for N=16384.
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return [
    SCRYPT_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  // Both must be equal-length hex for timingSafeEqual; bail (still in roughly
  // constant time relative to the comparison itself) on a length mismatch.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function verifyScrypt(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (!saltHex || !hashHex) return false;
  let derivedHex: string;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const keylen = hashHex.length / 2;
    derivedHex = scryptSync(password, salt, keylen, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    }).toString('hex');
  } catch {
    return false;
  }
  return constantTimeHexEqual(derivedHex, hashHex);
}

/**
 * Verify a password against a stored hash (scrypt or legacy SHA-256). Returns
 * `valid` plus `needsUpgrade` (true only when a legacy hash matched, so the
 * caller can re-hash with {@link hashPassword}).
 */
export function verifyPassword(password: string, stored: string): PasswordVerifyResult {
  if (stored.startsWith(`${SCRYPT_PREFIX}$`)) {
    return { valid: verifyScrypt(password, stored), needsUpgrade: false };
  }
  if (LEGACY_SHA256_RE.test(stored)) {
    const legacyHash = createHash('sha256').update(password).digest('hex');
    const valid = constantTimeHexEqual(legacyHash, stored);
    return { valid, needsUpgrade: valid };
  }
  // Unknown / malformed stored hash — never matches.
  return { valid: false, needsUpgrade: false };
}

/** True when a stored hash is in the legacy unsalted SHA-256 format. */
export function isLegacyPasswordHash(stored: string): boolean {
  return LEGACY_SHA256_RE.test(stored);
}
