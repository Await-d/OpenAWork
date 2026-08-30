import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStreamAttachRetry } from './use-stream-attach-retry.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useStreamAttachRetry', () => {
  it('doubles the delay across consecutive attach failures', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({ delayMs: 100 });
    });
    expect(result.current.attachRetryProgress).toContain('0.1s');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(1);

    act(() => {
      result.current.scheduleAttachRetry({ delayMs: 100 });
    });
    expect(result.current.attachRetryProgress).toContain('0.2s');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(result.current.attachRetryNonce).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.attachRetryNonce).toBe(2);
  });

  it('resets the backoff after a successful attach cancels the retry', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({ delayMs: 100 });
      result.current.cancelAttachRetry();
      result.current.scheduleAttachRetry({ delayMs: 100 });
    });

    expect(result.current.attachRetryProgress).toContain('0.1s');
  });
});
