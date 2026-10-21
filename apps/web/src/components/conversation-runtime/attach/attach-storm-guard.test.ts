import { describe, expect, it } from 'vitest';
import { evaluateAttachStormGuard } from './attach-storm-guard.js';

const BASE = {
  maxAttempts: 10,
  windowMs: 60_000,
};

describe('evaluateAttachStormGuard', () => {
  it('首次 attach 开启新窗口', () => {
    expect(
      evaluateAttachStormGuard({
        ...BASE,
        attemptsInWindow: 0,
        now: 1_000,
        windowStartedAt: 0,
      }),
    ).toEqual({ allowed: true, attemptsInWindow: 1, windowStartedAt: 1_000 });
  });

  it('同一窗口内累加，超过上限即熔断', () => {
    let result = evaluateAttachStormGuard({
      ...BASE,
      attemptsInWindow: 0,
      now: 1_000,
      windowStartedAt: 0,
    });

    for (let index = 1; index < 10; index += 1) {
      result = evaluateAttachStormGuard({
        ...BASE,
        attemptsInWindow: result.attemptsInWindow,
        now: 1_000 + index * 5_000,
        windowStartedAt: result.windowStartedAt,
      });
      expect(result.allowed).toBe(true);
    }

    result = evaluateAttachStormGuard({
      ...BASE,
      attemptsInWindow: result.attemptsInWindow,
      now: 1_000 + 50_000,
      windowStartedAt: result.windowStartedAt,
    });

    expect(result).toEqual({
      allowed: false,
      attemptsInWindow: 11,
      windowStartedAt: 1_000,
    });
  });

  it('窗口过期后重新计数', () => {
    expect(
      evaluateAttachStormGuard({
        ...BASE,
        attemptsInWindow: 10,
        now: 120_000,
        windowStartedAt: 1_000,
      }),
    ).toEqual({ allowed: true, attemptsInWindow: 1, windowStartedAt: 120_000 });
  });

  it('单轮间隔较长也不会让计数清零（旧实现的漏洞）', () => {
    // 间隔 30s：旧实现会把它当成正常节奏重置，导致无限循环。
    const result = evaluateAttachStormGuard({
      ...BASE,
      attemptsInWindow: 10,
      now: 31_000,
      windowStartedAt: 1_000,
    });

    expect(result.allowed).toBe(false);
    expect(result.attemptsInWindow).toBe(11);
  });
});
