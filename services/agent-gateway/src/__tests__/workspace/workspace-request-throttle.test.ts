/**
 * Regression: `/workspace/files/search` had no request budget, so an
 * authenticated client could force one full workspace `readdir` walk (a cache
 * miss costs ~0.6–1s on a ~4.4k-file workspace) per request. The throttle
 * allows up to `limit` requests per key within a sliding window, reports a
 * positive `retryAfterMs` on rejection without consuming budget, and keeps its
 * key map bounded.
 */

import { describe, expect, it } from 'vitest';
import { createWorkspaceRequestThrottle } from '../../workspace/workspace-request-throttle.js';

function makeClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const KEY = 'user-1::/workspace/demo';

describe('createWorkspaceRequestThrottle', () => {
  it('窗口内允许到 limit 次，第 limit+1 次被拒绝且 retryAfterMs 为正', () => {
    const clock = makeClock();
    const throttle = createWorkspaceRequestThrottle({
      limit: 3,
      windowMs: 60_000,
      now: clock.now,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(throttle.tryConsume(KEY)).toEqual({ allowed: true });
    }

    const rejected = throttle.tryConsume(KEY);
    expect(rejected.allowed).toBe(false);
    const retryAfterMs = rejected.allowed ? 0 : rejected.retryAfterMs;
    expect(retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('窗口滑过后重新允许请求', () => {
    const clock = makeClock();
    const throttle = createWorkspaceRequestThrottle({
      limit: 2,
      windowMs: 1_000,
      now: clock.now,
    });

    expect(throttle.tryConsume(KEY).allowed).toBe(true);
    expect(throttle.tryConsume(KEY).allowed).toBe(true);
    expect(throttle.tryConsume(KEY).allowed).toBe(false);

    clock.advance(1_001);
    expect(throttle.tryConsume(KEY)).toEqual({ allowed: true });
  });

  it('不同 key 各自独立计数，互不影响', () => {
    const clock = makeClock();
    const throttle = createWorkspaceRequestThrottle({
      limit: 2,
      windowMs: 60_000,
      now: clock.now,
    });
    const otherKey = 'user-2::/workspace/demo';

    expect(throttle.tryConsume(KEY).allowed).toBe(true);
    expect(throttle.tryConsume(KEY).allowed).toBe(true);
    expect(throttle.tryConsume(KEY).allowed).toBe(false);
    expect(throttle.tryConsume(otherKey).allowed).toBe(true);
  });

  it('空闲 key 过一个窗口后被回收，map 占用不会无限增长', () => {
    const clock = makeClock();
    const throttle = createWorkspaceRequestThrottle({
      limit: 5,
      windowMs: 1_000,
      now: clock.now,
    });

    for (let index = 0; index < 10; index += 1) {
      expect(throttle.tryConsume(`user-${index}::/workspace/demo`).allowed).toBe(true);
    }
    expect(throttle.size()).toBe(10);

    clock.advance(1_001);
    expect(throttle.tryConsume('user-fresh::/workspace/demo').allowed).toBe(true);
    expect(throttle.size()).toBe(1);
  });

  it('超过 maxEntries 时淘汰最久未活跃的 key，规模受上限约束', () => {
    const clock = makeClock();
    const throttle = createWorkspaceRequestThrottle({
      limit: 5,
      windowMs: 60_000,
      maxEntries: 3,
      now: clock.now,
    });

    for (let index = 0; index < 50; index += 1) {
      expect(throttle.tryConsume(`user-${index}::/workspace/demo`).allowed).toBe(true);
      clock.advance(1);
    }

    expect(throttle.size()).toBeLessThanOrEqual(3);
  });

  it('reset 清空全部计数', () => {
    const clock = makeClock();
    const throttle = createWorkspaceRequestThrottle({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });

    expect(throttle.tryConsume(KEY).allowed).toBe(true);
    expect(throttle.tryConsume(KEY).allowed).toBe(false);

    throttle.reset();

    expect(throttle.size()).toBe(0);
    expect(throttle.tryConsume(KEY).allowed).toBe(true);
  });
});
