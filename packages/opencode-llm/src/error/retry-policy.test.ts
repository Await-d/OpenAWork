import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Exit } from 'effect';
import {
  computeRetryDelay,
  createRetrySchedule,
  withRetry,
  withRetryStats,
  DEFAULT_RETRY_POLICY,
  type RetryPolicyConfig,
} from './retry-policy.js';
import { InvalidRequestReason, LLMError, RateLimitReason } from '../schema/index.js';

describe('computeRetryDelay', () => {
  it('应该计算指数退避延迟', () => {
    const config: RetryPolicyConfig = {
      ...DEFAULT_RETRY_POLICY,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      jitterFactor: 0,
    };

    expect(computeRetryDelay(1, config)).toBe(1000);
    expect(computeRetryDelay(2, config)).toBe(2000);
    expect(computeRetryDelay(3, config)).toBe(4000);
  });

  it('应该限制最大延迟', () => {
    const config: RetryPolicyConfig = {
      ...DEFAULT_RETRY_POLICY,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 5000,
      jitterFactor: 0,
    };

    expect(computeRetryDelay(10, config)).toBe(5000);
  });

  it('应该添加抖动', () => {
    const config: RetryPolicyConfig = {
      ...DEFAULT_RETRY_POLICY,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      jitterFactor: 0.2,
    };

    const delays = Array.from({ length: 10 }, () => computeRetryDelay(1, config));

    // 抖动应该产生不同的值
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);

    // 所有延迟应该在合理范围内 (1000 ± 200)
    delays.forEach((delay) => {
      expect(delay).toBeGreaterThanOrEqual(800);
      expect(delay).toBeLessThanOrEqual(1200);
    });
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('首次成功应该不重试', async () => {
    const fn = vi.fn(() => Effect.succeed('success'));
    const effect = withRetry(fn(), { maxAttempts: 3 });

    const exitPromise = Effect.runPromiseExit(effect);
    await vi.runAllTimersAsync();
    const exit = await exitPromise;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe('success');
    }
  });

  it('可重试错误应该重试', async () => {
    let attemptCount = 0;
    const fn = vi.fn(() => {
      attemptCount++;
      if (attemptCount < 3) {
        return Effect.fail(
          new LLMError({
            module: 'test',
            method: 'retry',
            reason: new RateLimitReason({
              message: 'Rate limit exceeded',
            }),
          }),
        );
      }
      return Effect.succeed('success');
    });

    const effect = withRetry(Effect.suspend(fn), {
      maxAttempts: 5,
      initialDelayMs: 100,
      jitterFactor: 0,
    });

    const exitPromise = Effect.runPromiseExit(effect);
    await vi.runAllTimersAsync();
    const exit = await exitPromise;

    expect(fn).toHaveBeenCalledTimes(3);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe('success');
    }
  });

  it('不可重试错误应该立即失败', async () => {
    const error = new LLMError({
      module: 'test',
      method: 'noretry',
      reason: new InvalidRequestReason({ message: 'Invalid request' }),
    });

    const fn = vi.fn(() => Effect.fail(error));
    const effect = withRetry(Effect.suspend(fn), {
      maxAttempts: 5,
      shouldRetry: () => false,
    });

    const exitPromise = Effect.runPromiseExit(effect);
    await vi.runAllTimersAsync();
    const exit = await exitPromise;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('耗尽重试次数应该失败', async () => {
    const error = new LLMError({
      module: 'test',
      method: 'exhausted',
      reason: new RateLimitReason({
        message: 'Rate limit',
      }),
    });

    const fn = vi.fn(() => Effect.fail(error));
    const effect = withRetry(Effect.suspend(fn), {
      maxAttempts: 3,
      initialDelayMs: 100,
      jitterFactor: 0,
    });

    const exitPromise = Effect.runPromiseExit(effect);
    await vi.runAllTimersAsync();
    const exit = await exitPromise;

    expect(fn).toHaveBeenCalledTimes(3);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('withRetryStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('应该返回重试统计信息', async () => {
    let attemptCount = 0;
    const fn = vi.fn(() => {
      attemptCount++;
      if (attemptCount < 2) {
        return Effect.fail(
          new LLMError({
            module: 'test',
            method: 'stats',
            reason: new RateLimitReason({
              message: 'Rate limit',
            }),
          }),
        );
      }
      return Effect.succeed('success');
    });

    const effect = withRetryStats(Effect.suspend(fn), {
      maxAttempts: 3,
      initialDelayMs: 1000,
      jitterFactor: 0,
    });

    const exitPromise = Effect.runPromiseExit(effect);
    await vi.runAllTimersAsync();
    const exit = await exitPromise;

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { result, stats } = exit.value;
      expect(result).toBe('success');
      expect(stats.attempts).toBe(2);
      expect(stats.totalDelayMs).toBeGreaterThan(0);
    }
  });
});
