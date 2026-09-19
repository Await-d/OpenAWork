import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachRetryVerdict } from './attach-stream-eligibility.js';
import {
  MAX_ATTACH_RETRY_ATTEMPTS,
  MAX_ATTACH_RETRY_DEFERS,
  useStreamAttachRetry,
} from './use-stream-attach-retry.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useStreamAttachRetry', () => {
  it('doubles the delay across consecutive attach failures', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
    });
    expect(result.current.attachRetryProgress).toContain('0.1s');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(1);

    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
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
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
      result.current.cancelAttachRetry();
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
    });

    expect(result.current.attachRetryProgress).toContain('0.1s');
  });

  it("'defer' / false 不消耗重试次数并在同一延迟重新排期", async () => {
    vi.useFakeTimers();
    let verdict: AttachRetryVerdict | boolean = false;
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({
        sessionId: 'session-1',
        delayMs: 100,
        beforeRetry: () => verdict,
      });
    });
    expect(result.current.attachRetryProgress).toContain('0.1s');
    expect(result.current.attachRetryScheduledSessionId).toBe('session-1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(0);
    expect(result.current.attachRetryProgress).toContain('0.1s');
    expect(result.current.attachRetryScheduledSessionId).toBe('session-1');

    verdict = 'defer';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(0);
    expect(result.current.attachRetryScheduledSessionId).toBe('session-1');

    verdict = 'proceed';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(1);
    expect(result.current.attachRetryProgress).toBeNull();
    expect(result.current.attachRetryScheduledSessionId).toBeNull();
    expect(result.current.attachRetryExhausted).toBe(false);
  });

  it("'abort' 立即取消排期且不触发 nonce", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({
        sessionId: 'session-1',
        delayMs: 100,
        beforeRetry: () => 'abort',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(0);
    expect(result.current.attachRetryProgress).toBeNull();
    expect(result.current.attachRetryScheduledSessionId).toBeNull();
  });

  it('defer 次数超过上限后按 abort 取消', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({
        sessionId: 'session-1',
        delayMs: 50,
        beforeRetry: () => 'defer',
      });
    });

    for (let deferIndex = 0; deferIndex < MAX_ATTACH_RETRY_DEFERS; deferIndex += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(result.current.attachRetryScheduledSessionId).toBe('session-1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(result.current.attachRetryScheduledSessionId).toBeNull();
    expect(result.current.attachRetryProgress).toBeNull();
    expect(result.current.attachRetryNonce).toBe(0);
  });

  it('超过最大尝试次数后置 attachRetryExhausted 并停止排期', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      for (let attempt = 0; attempt < MAX_ATTACH_RETRY_ATTEMPTS; attempt += 1) {
        result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
      }
    });
    expect(result.current.attachRetryExhausted).toBe(false);

    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
    });
    expect(result.current.attachRetryExhausted).toBe(true);
    expect(result.current.attachRetryProgress).toBeNull();
    expect(result.current.attachRetryScheduledSessionId).toBeNull();

    act(() => {
      result.current.cancelAttachRetry();
    });
    expect(result.current.attachRetryExhausted).toBe(false);
  });

  it('cancelAttachRetry 清空 attachRetryScheduledSessionId', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
    });
    expect(result.current.attachRetryScheduledSessionId).toBe('session-1');

    act(() => {
      result.current.cancelAttachRetry();
    });
    expect(result.current.attachRetryScheduledSessionId).toBeNull();
    expect(result.current.attachRetryProgress).toBeNull();
  });
});
