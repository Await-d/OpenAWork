import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listForSession = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createArtifactsClient: () => ({ listForSession }),
}));

const { useSessionContentArtifacts } = await import('./use-session-content-artifacts.js');

function makePayload(count: number) {
  return { contentArtifacts: Array.from({ length: count }, (_, index) => ({ id: `a${index}` })) };
}

const BASE = {
  gatewayUrl: 'http://localhost:3000',
  reloadKey: 0,
  token: 'token-1',
};

const FLUSH_DEBOUNCE_MS = 800;

describe('useSessionContentArtifacts', () => {
  beforeEach(() => {
    listForSession.mockReset();
    listForSession.mockResolvedValue(makePayload(0));
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次进入会话立即拉一次，不排去抖补拉', async () => {
    const { result } = renderHook(() =>
      useSessionContentArtifacts({ ...BASE, currentSessionId: 's1', messageCount: 12 }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(listForSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS * 3);
    });
    expect(listForSession).toHaveBeenCalledTimes(1);
  });

  it('流式输出期间只在静默后补拉一次，而不是每条消息一次', async () => {
    const { rerender } = renderHook(
      ({ messageCount }: { messageCount: number }) =>
        useSessionContentArtifacts({ ...BASE, currentSessionId: 's1', messageCount }),
      { initialProps: { messageCount: 1 } },
    );

    await waitFor(() => expect(listForSession).toHaveBeenCalledTimes(1));

    // 模拟连续落 5 条消息
    for (const count of [2, 3, 4, 5, 6]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      rerender({ messageCount: count });
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS * 3);
    });

    // 首次 1 次 + 流式静默后 1 次
    expect(listForSession).toHaveBeenCalledTimes(2);
  });

  it('切换会话（无缓存：消息数 12 → 0 → 20）不产生去抖补拉', async () => {
    const { rerender } = renderHook(
      ({ sessionId, messageCount }: { sessionId: string; messageCount: number }) =>
        useSessionContentArtifacts({ ...BASE, currentSessionId: sessionId, messageCount }),
      { initialProps: { sessionId: 's1', messageCount: 12 } },
    );

    await waitFor(() => expect(listForSession).toHaveBeenCalledTimes(1));

    // 切换中转：消息清空
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    rerender({ sessionId: 's2', messageCount: 0 });

    // 快照填充
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    rerender({ sessionId: 's2', messageCount: 20 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS * 3);
    });

    // 只有「进入 s2 的立即拉取」，两跳跳变都不触发补拉
    expect(listForSession).toHaveBeenCalledTimes(2);
    expect(listForSession).toHaveBeenLastCalledWith(
      'token-1',
      's2',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('切换会话（有缓存：消息数直接 12 → 20）后的流式消息仍能补拉', async () => {
    const { rerender } = renderHook(
      ({ sessionId, messageCount }: { sessionId: string; messageCount: number }) =>
        useSessionContentArtifacts({ ...BASE, currentSessionId: sessionId, messageCount }),
      { initialProps: { sessionId: 's1', messageCount: 12 } },
    );

    await waitFor(() => expect(listForSession).toHaveBeenCalledTimes(1));

    // 有缓存：直接替换为目标会话消息
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    rerender({ sessionId: 's2', messageCount: 20 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS * 3);
    });
    expect(listForSession).toHaveBeenCalledTimes(2);

    // s2 的流式消息必须能正常补拉
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    rerender({ sessionId: 's2', messageCount: 21 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS * 3);
    });

    expect(listForSession).toHaveBeenCalledTimes(3);
    expect(listForSession).toHaveBeenLastCalledWith(
      'token-1',
      's2',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('软重载信号立即重新拉取，不受去抖影响', async () => {
    const { rerender } = renderHook(
      ({ reloadKey }: { reloadKey: number }) =>
        useSessionContentArtifacts({
          ...BASE,
          reloadKey,
          currentSessionId: 's1',
          messageCount: 12,
        }),
      { initialProps: { reloadKey: 0 } },
    );

    await waitFor(() => expect(listForSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    rerender({ reloadKey: 1 });

    await waitFor(() => expect(listForSession).toHaveBeenCalledTimes(2));
  });
});
