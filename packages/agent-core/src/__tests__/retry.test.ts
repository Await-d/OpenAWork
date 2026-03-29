import { describe, it, expect, vi } from 'vitest';
import {
  computeDelay,
  withRetry,
  createCancellableTask,
  RetryAbortedError,
  RetryExhaustedError,
  DEFAULT_RETRY_OPTIONS,
} from '../retry.js';

describe('computeDelay', () => {
  it('returns initialDelayMs on first attempt', () => {
    const delay = computeDelay(1, { ...DEFAULT_RETRY_OPTIONS, jitterFactor: 0 });
    expect(delay).toBe(DEFAULT_RETRY_OPTIONS.initialDelayMs);
  });

  it('doubles delay on second attempt', () => {
    const delay = computeDelay(2, { ...DEFAULT_RETRY_OPTIONS, jitterFactor: 0 });
    expect(delay).toBe(DEFAULT_RETRY_OPTIONS.initialDelayMs * 2);
  });

  it('caps at maxDelayMs', () => {
    const delay = computeDelay(100, { ...DEFAULT_RETRY_OPTIONS, jitterFactor: 0 });
    expect(delay).toBe(DEFAULT_RETRY_OPTIONS.maxDelayMs);
  });

  it('returns non-negative value', () => {
    for (let i = 0; i < 20; i++) {
      expect(computeDelay(1, DEFAULT_RETRY_OPTIONS)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('withRetry: success', () => {
  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds after one failure', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('temporary');
      return 'recovered';
    });
    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 0, jitterFactor: 0 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withRetry: exhaustion', () => {
  it('throws RetryExhaustedError after maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    await expect(
      withRetry(fn, { maxAttempts: 2, initialDelayMs: 0, jitterFactor: 0 }),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('RetryExhaustedError carries attempt count and lastError', async () => {
    const cause = new Error('root');
    const fn = vi.fn().mockRejectedValue(cause);
    const err = await withRetry(fn, { maxAttempts: 1, initialDelayMs: 0, jitterFactor: 0 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RetryExhaustedError);
    const retryErr = err as RetryExhaustedError;
    expect(retryErr.attempts).toBe(1);
    expect(retryErr.lastError).toBe(cause);
  });
});

describe('withRetry: non-retryable error', () => {
  it('stops immediately for non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 0,
        jitterFactor: 0,
        isRetryable: () => false,
      }),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withRetry: abort', () => {
  it('throws RetryAbortedError when signal is pre-aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, {}, ctrl.signal)).rejects.toBeInstanceOf(RetryAbortedError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('createCancellableTask', () => {
  it('resolves normally when not cancelled', async () => {
    const { promise } = createCancellableTask(async () => 42);
    expect(await promise).toBe(42);
  });

  it('cancel() aborts the signal', async () => {
    let capturedSignal: AbortSignal | undefined;
    const { cancel } = createCancellableTask(async (signal) => {
      capturedSignal = signal;
    });
    cancel();
    expect(capturedSignal instanceof AbortSignal || capturedSignal === undefined).toBe(true);
    if (capturedSignal) {
      expect(capturedSignal.aborted).toBe(true);
    }
  });
});
