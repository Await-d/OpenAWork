/**
 * Regression: every credential path historically stored unsalted sha256(pw).
 * The password-hash module hashes new passwords with salted scrypt + verifies
 * in constant time, while still verifying legacy SHA-256 hashes and flagging
 * them for transparent on-login upgrade so existing users keep working.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, isLegacyPasswordHash } from '../../infra/password-hash.js';

describe('password-hash', () => {
  it('hashPassword 产出带盐 scrypt 格式，且能被 verifyPassword 验证', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    const result = verifyPassword('correct horse battery staple', hash);
    expect(result.valid).toBe(true);
    expect(result.needsUpgrade).toBe(false);
  });

  it('相同密码两次哈希因随机盐而不同（无碰撞）', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
    // 但都能各自验证通过
    expect(verifyPassword('same-password', a).valid).toBe(true);
    expect(verifyPassword('same-password', b).valid).toBe(true);
  });

  it('错误密码验证失败', () => {
    const hash = hashPassword('right');
    expect(verifyPassword('wrong', hash).valid).toBe(false);
  });

  it('legacy 无盐 SHA-256 哈希仍可验证，并标记 needsUpgrade', () => {
    const legacy = createHash('sha256').update('legacy-pw').digest('hex');
    const result = verifyPassword('legacy-pw', legacy);
    expect(result.valid).toBe(true);
    expect(result.needsUpgrade).toBe(true);
  });

  it('legacy 哈希下错误密码失败且不标记升级', () => {
    const legacy = createHash('sha256').update('legacy-pw').digest('hex');
    const result = verifyPassword('nope', legacy);
    expect(result.valid).toBe(false);
    expect(result.needsUpgrade).toBe(false);
  });

  it('isLegacyPasswordHash 仅对 64-hex 为真，对 scrypt 格式为假', () => {
    const legacy = createHash('sha256').update('x').digest('hex');
    expect(isLegacyPasswordHash(legacy)).toBe(true);
    expect(isLegacyPasswordHash(hashPassword('x'))).toBe(false);
  });

  it('畸形 / 未知格式的 stored hash 永不匹配', () => {
    expect(verifyPassword('x', 'not-a-real-hash').valid).toBe(false);
    expect(verifyPassword('x', 'scrypt$bad$format').valid).toBe(false);
    expect(verifyPassword('x', '').valid).toBe(false);
  });
});
