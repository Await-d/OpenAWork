/**
 * Regression: `/auth/login` previously compared the password hash with NO
 * attempt limiting, so an attacker reaching the LAN-exposed gateway could
 * brute-force credentials at full speed. The LoginRateLimiter locks a key
 * (email+ip) out for a cooldown once a failure threshold is hit, and a
 * successful login clears the counter. State is bounded by an opportunistic
 * sweep so a key-varying flood can't grow it without limit.
 */

import { describe, expect, it } from 'vitest';
import { LoginRateLimiter, buildLoginRateLimitKey } from '../../infra/login-rate-limiter.js';

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const KEY = buildLoginRateLimitKey('user@example.com', '127.0.0.1');

describe('LoginRateLimiter', () => {
  it('在达到 maxFailures 前允许尝试，达到后锁定并返回 retryAfter', () => {
    const clock = makeClock();
    const limiter = new LoginRateLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      lockoutMs: 60_000,
      now: clock.now,
    });

    // 3 failures trips the lockout.
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check(KEY).allowed).toBe(true);
      limiter.recordFailure(KEY);
    }

    const status = limiter.check(KEY);
    expect(status.allowed).toBe(false);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    expect(status.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('锁定在 lockoutMs 之后解除', () => {
    const clock = makeClock();
    const limiter = new LoginRateLimiter({
      maxFailures: 2,
      windowMs: 60_000,
      lockoutMs: 60_000,
      now: clock.now,
    });

    limiter.recordFailure(KEY);
    limiter.recordFailure(KEY);
    expect(limiter.check(KEY).allowed).toBe(false);

    clock.advance(60_001);
    expect(limiter.check(KEY).allowed).toBe(true);
  });

  it('窗口外的旧失败不计入阈值', () => {
    const clock = makeClock();
    const limiter = new LoginRateLimiter({
      maxFailures: 3,
      windowMs: 10_000,
      lockoutMs: 60_000,
      now: clock.now,
    });

    limiter.recordFailure(KEY); // t=0
    limiter.recordFailure(KEY); // t=0
    clock.advance(10_001); // both now outside the window
    limiter.recordFailure(KEY); // only this one is in-window
    // Still under threshold because the first two expired.
    expect(limiter.check(KEY).allowed).toBe(true);
  });

  it('成功登录清空该 key 的失败计数', () => {
    const clock = makeClock();
    const limiter = new LoginRateLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      lockoutMs: 60_000,
      now: clock.now,
    });

    limiter.recordFailure(KEY);
    limiter.recordFailure(KEY);
    limiter.recordSuccess(KEY);
    // Counter reset → a fresh failure run starts from zero.
    limiter.recordFailure(KEY);
    limiter.recordFailure(KEY);
    expect(limiter.check(KEY).allowed).toBe(true);
  });

  it('不同 key（不同 email/ip）独立计数，互不影响', () => {
    const clock = makeClock();
    const limiter = new LoginRateLimiter({
      maxFailures: 2,
      windowMs: 60_000,
      lockoutMs: 60_000,
      now: clock.now,
    });
    const other = buildLoginRateLimitKey('other@example.com', '10.0.0.9');

    limiter.recordFailure(KEY);
    limiter.recordFailure(KEY);
    expect(limiter.check(KEY).allowed).toBe(false);
    // A different key is unaffected.
    expect(limiter.check(other).allowed).toBe(true);
  });

  it('maxEntries 上限下 sweep 控制 map 规模', () => {
    const clock = makeClock();
    const limiter = new LoginRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      lockoutMs: 60_000,
      maxEntries: 50,
      now: clock.now,
    });

    // Flood with distinct keys, each one in-window failure.
    for (let i = 0; i < 200; i += 1) {
      limiter.recordFailure(buildLoginRateLimitKey(`u${i}@x.com`, '1.2.3.4'));
    }
    // Sweep keeps it bounded at/under the cap.
    expect(limiter.size()).toBeLessThanOrEqual(50);
  });
});
