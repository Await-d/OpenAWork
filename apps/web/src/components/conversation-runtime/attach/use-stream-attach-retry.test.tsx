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
  it('silent 重试不展示进度横幅，但仍然排期并放行重试', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100, silent: true });
    });
    // 工具执行期间的等待必须完全无 UI 反馈：retryProgress 会渲染成错误条横幅。
    expect(result.current.attachRetryProgress).toBeNull();
    // 但重试本身照常排期。
    expect(result.current.attachRetryScheduledSessionId).toBe('session-1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(1);
  });

  it('退避只做一次指数：由调用方给出的 delayMs 决定，本层不再翻倍', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    // 调用方（run-session-attach-effect）传入的 delayMs 本身已按连续失败次数递增。
    // 旧实现在此处又乘 `2 ** (attempt - 1)`，得到 `base(n) × 2^k` 的双指数——
    // 第 6 档 25.6ms 恰好配 `2⁰`，正是用户看到的「约 25.6s 后重试」。
    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
    });
    expect(result.current.attachRetryProgress).toContain('0.1s');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.attachRetryNonce).toBe(1);

    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 200 });
    });
    // 200ms 原样使用，而不是再翻倍成 400ms。
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

  it('静默重试不计入耗尽次数：工具执行期间的等待不受 8 次上限约束', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    // bash 执行期间服务端不产生任何 run event，attach 会反复「打开 → 0 事件 → EOF」。
    // 这是正常等待，不能消耗失败预算，否则一次跑得久的命令就会把重试计数耗尽并弹出
    // 「实时流长时间没有新输出」这类故障提示——而连接其实一直是健康的。
    act(() => {
      for (let attempt = 0; attempt < MAX_ATTACH_RETRY_ATTEMPTS * 3; attempt += 1) {
        result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100, silent: true });
      }
    });

    expect(result.current.attachRetryExhausted).toBe(false);
    expect(result.current.attachRetryScheduledSessionId).toBe('session-1');
  });

  it('静默重试不占用失败预算，随后真正的断线仍从起步延迟开始', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamAttachRetry());

    act(() => {
      for (let attempt = 0; attempt < MAX_ATTACH_RETRY_ATTEMPTS; attempt += 1) {
        result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100, silent: true });
      }
    });

    // 真正的传输中断：应按「第一次失败」的起步延迟处理，而不是接着往上数。
    act(() => {
      result.current.scheduleAttachRetry({ sessionId: 'session-1', delayMs: 100 });
    });
    expect(result.current.attachRetryProgress).toContain('0.1s');
    expect(result.current.attachRetryExhausted).toBe(false);
  });

  it('非静默重试仍然受 8 次上限约束', () => {
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
