import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RetryAbortedError,
  RetryExhaustedError,
  computeDelay,
  withRetry,
  DEFAULT_RETRY_OPTIONS,
} from './retry.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withRetry', () => {
  it('首次成功直接返回，不重试', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withRetry(fn, { maxAttempts: 3 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('不可重试错误原样抛出，不包成 RetryExhaustedError，也不重试', async () => {
    const boom = new Error('fatal');
    const fn = vi.fn(async () => {
      throw boom;
    });
    await expect(
      withRetry(fn, { maxAttempts: 5, isRetryable: () => false, initialDelayMs: 0 }),
    ).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('可重试错误耗尽后抛 RetryExhaustedError，并保留 lastError', async () => {
    vi.useFakeTimers();
    const boom = new Error('transient');
    const fn = vi.fn(async () => {
      throw boom;
    });
    const promise = withRetry(fn, {
      maxAttempts: 3,
      isRetryable: () => true,
      initialDelayMs: 10,
      jitterFactor: 0,
    });
    const settled = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await settled;
    expect(fn).toHaveBeenCalledTimes(3);
    await promise.catch((err: unknown) => {
      expect(err).toBeInstanceOf(RetryExhaustedError);
      expect((err as RetryExhaustedError).attempts).toBe(3);
      expect((err as RetryExhaustedError).lastError).toBe(boom);
    });
  });

  it('已 aborted 的 signal 立即抛 RetryAbortedError，不调用 fn', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => 'never');
    await expect(withRetry(fn, { maxAttempts: 3 }, controller.signal)).rejects.toBeInstanceOf(
      RetryAbortedError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('重试退避期间 abort 会以 RetryAbortedError 中断', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      throw new Error('transient');
    });
    const promise = withRetry(
      fn,
      { maxAttempts: 5, isRetryable: () => true, initialDelayMs: 1000, jitterFactor: 0 },
      controller.signal,
    );
    const settled = expect(promise).rejects.toBeInstanceOf(RetryAbortedError);
    // 第一次失败后进入 sleep(1000)，此时 abort
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    await settled;
  });
});

describe('computeDelay', () => {
  it('指数增长并封顶 maxDelayMs', () => {
    const opts = {
      ...DEFAULT_RETRY_OPTIONS,
      initialDelayMs: 1000,
      maxDelayMs: 4000,
      jitterFactor: 0,
    };
    expect(computeDelay(1, opts)).toBe(1000);
    expect(computeDelay(2, opts)).toBe(2000);
    expect(computeDelay(3, opts)).toBe(4000);
    expect(computeDelay(10, opts)).toBe(4000);
  });
});
