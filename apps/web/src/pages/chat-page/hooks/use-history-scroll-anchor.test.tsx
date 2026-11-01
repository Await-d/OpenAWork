import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HistoryPageResult,
  LoadEarlierHistory,
} from '../conversation/snapshot/session-history-pager.js';
import { useHistoryScrollAnchor } from './use-history-scroll-anchor.js';

function renderHistoryAnchor(loadEarlierHistory: LoadEarlierHistory, localLength = 20) {
  const armHistoryAnchor = vi.fn();
  const hook = renderHook(
    ({ sessionId }: { sessionId: string }) => {
      const [visibleMessageCount, setVisibleMessageCount] = useState(20);
      const controller = useHistoryScrollAnchor({
        armHistoryAnchor,
        armHistoryAnchorImplRef: { current: null },
        currentSessionId: sessionId,
        firstVisibleMessageId: 'first',
        firstVisibleMessageIdRef: { current: 'first' },
        historyAnchorRestoreCancelRef: { current: null },
        lastAnchorMessageIdRef: { current: null },
        setLastAnchorMessageId: vi.fn(),
        loadEarlierHistory,
        pendingHistoryAnchor: null,
        sanitizedHistoricalMessagesLength: localLength,
        scrollRegionRef: { current: null },
        setPendingHistoryAnchor: vi.fn(),
        setPendingMessageScroll: vi.fn(),
        setVisibleMessageCount,
        visibleMessageCount,
      });
      return { ...controller, visibleMessageCount };
    },
    { initialProps: { sessionId: 'a' } },
  );
  return { hook, armHistoryAnchor };
}

afterEach(cleanup);

describe('useHistoryScrollAnchor pagination', () => {
  it('还有本地隐藏消息时只扩窗', () => {
    const load = vi.fn<LoadEarlierHistory>();
    const { hook, armHistoryAnchor } = renderHistoryAnchor(load, 50);
    act(() => {
      hook.result.current.handleLoadEarlierMessages();
    });
    expect(load).not.toHaveBeenCalled();
    expect(armHistoryAnchor).toHaveBeenCalledOnce();
    expect(hook.result.current.visibleMessageCount).toBe(40);
  });

  it('连续触发只加载一次，完成后只扩窗一次', async () => {
    let resolve: ((value: HistoryPageResult | null) => void) | undefined;
    const load = vi.fn<LoadEarlierHistory>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { hook } = renderHistoryAnchor(load);
    act(() => {
      hook.result.current.handleLoadEarlierMessages();
      hook.result.current.handleLoadEarlierMessages();
    });
    expect(load).toHaveBeenCalledOnce();
    await act(async () => {
      resolve?.({ messages: [], more: true });
    });
    expect(hook.result.current.visibleMessageCount).toBe(40);
  });

  it('切换会话后旧请求不再扩窗', async () => {
    let resolve: ((value: HistoryPageResult | null) => void) | undefined;
    const load = vi.fn<LoadEarlierHistory>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { hook } = renderHistoryAnchor(load);
    act(() => {
      hook.result.current.handleLoadEarlierMessages();
    });
    hook.rerender({ sessionId: 'b' });
    await act(async () => {
      resolve?.({ messages: [], more: false });
    });
    expect(hook.result.current.visibleMessageCount).toBe(20);
  });
});
