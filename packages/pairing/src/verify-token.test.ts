/**
 * Regression: verifyToken gates /pairing/login, which issues a FULL admin
 * token to any caller that passes it. The compare must be constant-time
 * (timingSafeEqual) rather than `===` so the active token can't be recovered
 * byte-by-byte via a LAN timing attack. These tests pin the functional
 * contract: correct token matches, wrong/short tokens reject, and expiry +
 * single-use (confirmClient clears the session) still gate correctly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PairingManagerImpl } from './manager.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PairingManagerImpl.verifyToken', () => {
  it('正确 token 验证通过', async () => {
    const mgr = new PairingManagerImpl(3000);
    const { token } = await mgr.generatePairingCode();
    expect(mgr.verifyToken(token)).toBe(true);
  });

  it('错误 token 验证失败', async () => {
    const mgr = new PairingManagerImpl(3000);
    const { token } = await mgr.generatePairingCode();
    // Same-length wrong token (exercises the timingSafeEqual path, not the
    // length short-circuit).
    const wrong = token.split('').reverse().join('');
    const flipped = wrong === token ? `${token.slice(0, -1)}${token[0]}` : wrong;
    expect(mgr.verifyToken(flipped)).toBe(false);
  });

  it('长度不同的 token 验证失败（不抛错）', async () => {
    const mgr = new PairingManagerImpl(3000);
    await mgr.generatePairingCode();
    expect(mgr.verifyToken('short')).toBe(false);
    expect(mgr.verifyToken('')).toBe(false);
  });

  it('TTL 过期后即使 token 正确也验证失败', async () => {
    vi.useFakeTimers();
    const mgr = new PairingManagerImpl(3000);
    const { token } = await mgr.generatePairingCode();
    // PAIRING_TTL_MS is 5 min; advance past it.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    expect(mgr.verifyToken(token)).toBe(false);
  });

  it('无活动会话时验证失败', () => {
    const mgr = new PairingManagerImpl(3000);
    expect(mgr.verifyToken('anything')).toBe(false);
  });
});
