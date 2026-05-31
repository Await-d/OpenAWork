// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecoverableRetryController } from './use-recoverable-retry.js';

describe('useRecoverableRetryController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('会调度重试并在触发后清空 nextRetryAt', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const { result } = renderHook(() => useRecoverableRetryController());

    let retryAtMs: number | null = null;
    act(() => {
      retryAtMs = result.current.scheduleRetry({
        computeDelay: () => 2000,
        onRetry,
        retryable: true,
      });
    });

    expect(retryAtMs).not.toBeNull();
    expect(result.current.nextRetryAtMs).toBe(retryAtMs);
    expect(result.current.getAttempt()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result.current.nextRetryAtMs).toBeNull();
  });

  it('非 retryable 时会清空已存在的调度', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const { result } = renderHook(() => useRecoverableRetryController());

    act(() => {
      result.current.scheduleRetry({
        computeDelay: () => 2000,
        onRetry,
        retryable: true,
      });
    });

    act(() => {
      result.current.scheduleRetry({
        computeDelay: () => 2000,
        onRetry,
        retryable: false,
      });
    });

    expect(result.current.nextRetryAtMs).toBeNull();
    expect(result.current.getAttempt()).toBe(0);
  });
});
