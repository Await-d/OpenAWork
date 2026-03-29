// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSequentialPolling } from './sequential-polling.js';

describe('startSequentialPolling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the current request to finish before scheduling the next poll', async () => {
    vi.useFakeTimers();

    const pendingRuns: Array<() => void> = [];
    const run = vi.fn((signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return new Promise<void>((resolve) => {
        pendingRuns.push(resolve);
      });
    });

    const polling = startSequentialPolling({ intervalMs: 3000, run });

    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12000);
    expect(run).toHaveBeenCalledTimes(1);

    pendingRuns[0]?.();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(2999);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);

    polling.cancel();
  });

  it('aborts the in-flight request and stops future polls when cancelled', async () => {
    vi.useFakeTimers();

    const signals: AbortSignal[] = [];
    const pendingRuns: Array<() => void> = [];
    const run = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => {
        pendingRuns.push(resolve);
      });
    });

    const polling = startSequentialPolling({ intervalMs: 3000, run });

    expect(run).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    polling.cancel();

    expect(signals[0]?.aborted).toBe(true);

    pendingRuns[0]?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(12000);

    expect(run).toHaveBeenCalledTimes(1);
  });
});
