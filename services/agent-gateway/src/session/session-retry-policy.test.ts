import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeSessionRecoveryRetryDelayMs,
  waitForSessionRecoveryRetry,
} from './session-retry-policy.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('session recovery retry policy', () => {
  it('uses exponential delays for consecutive recovery attempts', () => {
    expect(computeSessionRecoveryRetryDelayMs(1)).toBe(2_000);
    expect(computeSessionRecoveryRetryDelayMs(2)).toBe(4_000);
    expect(computeSessionRecoveryRetryDelayMs(3)).toBe(8_000);
  });

  it('resolves after the computed delay', async () => {
    vi.useFakeTimers();
    const pending = waitForSessionRecoveryRetry(2, new AbortController().signal);

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('cancels the wait when the stream is aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForSessionRecoveryRetry(1, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
