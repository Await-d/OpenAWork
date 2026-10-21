// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { CHAT_LATEST_RESTORE_TOLERANCE_PX } from '../../../../components/conversation-runtime/scroll/scroll-constants.js';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { useSessionViewCache } from './use-session-view-cache.js';

const MESSAGE_FIXTURE: ChatMessage = { content: 'hello', id: 'm-1', role: 'user' };

/** jsdom 不做布局：三个只读几何量必须显式定义才能被测量代码读到。 */
function createScrollRegion(input: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): HTMLDivElement {
  const region = document.createElement('div');
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: input.clientHeight });
  Object.defineProperty(region, 'scrollHeight', { configurable: true, value: input.scrollHeight });
  Object.defineProperty(region, 'scrollTop', {
    configurable: true,
    value: input.scrollTop,
    writable: true,
  });
  return region;
}

describe('useSessionViewCache', () => {
  it('round-trip 保留 streamingSnapshot 里的 upstreamSummary', () => {
    const { result } = renderHook(() => useSessionViewCache());

    result.current.save('session-1', [], null, {
      recoveredStream: {
        messageId: 'm-1',
        parts: [],
        startedAt: 100,
        text: 'hello',
        thinkingBlocks: [],
        toolCalls: [],
        upstreamRoute: {
          modelId: 'gpt-5.4',
          providerId: 'openai-fast',
        },
        usage: null,
        upstreamSummary: {
          stopReason: 'cancelled',
          textDeltaCount: 4,
          reasoningDeltaCount: 1,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: false,
          stalled: false,
        },
      },
      rightPanelState: {
        planTasks: [],
        agentEvents: [],
        planHistory: [],
        dagNodes: [],
        dagEdges: [],
        toolCalls: [],
        upstreamSummaries: [],
        compactions: [],
        currentGoal: '',
      },
    });

    const restored = result.current.restore('session-1');
    expect(restored?.streamingSnapshot?.recoveredStream.upstreamSummary).toEqual({
      stopReason: 'cancelled',
      textDeltaCount: 4,
      reasoningDeltaCount: 1,
      toolCallDeltaCount: 0,
      sawDone: false,
      sawError: false,
      stalled: false,
    });
    expect(restored?.streamingSnapshot?.recoveredStream.upstreamRoute).toEqual({
      modelId: 'gpt-5.4',
      providerId: 'openai-fast',
    });
  });

  it('停在最新处（末条消息贴视口底、仅剩 spacer）记录的距离落在贴底容差内', () => {
    const { result } = renderHook(() => useSessionViewCache());

    // 总高 2000 − 视口 600 − 位置 1320 = 80：恰好是底部 spacer 的阅读位。
    result.current.save(
      'session-1',
      [MESSAGE_FIXTURE],
      createScrollRegion({ clientHeight: 600, scrollHeight: 2000, scrollTop: 1320 }),
    );

    const restored = result.current.restore('session-1');
    expect(restored?.distanceFromBottom).toBe(80);
    // 该距离必须被判定为「在最新处」：否则切回会话会按旧布局的绝对位置恢复，
    // 落在中部并把跟随挂起（「切换会话后停在第一条消息处」的成因）。
    expect(restored!.distanceFromBottom).toBeLessThanOrEqual(CHAT_LATEST_RESTORE_TOLERANCE_PX);
  });

  it('停在历史中部记录的距离超出贴底容差，恢复阅读位置而不是贴底', () => {
    const { result } = renderHook(() => useSessionViewCache());

    // 总高 2000 − 视口 600 − 位置 400 = 1000：用户明确翻到了历史里。
    result.current.save(
      'session-1',
      [MESSAGE_FIXTURE],
      createScrollRegion({ clientHeight: 600, scrollHeight: 2000, scrollTop: 400 }),
    );

    const restored = result.current.restore('session-1');
    expect(restored!.distanceFromBottom).toBeGreaterThan(CHAT_LATEST_RESTORE_TOLERANCE_PX);
  });

  it('总量为负（内容比视口短）时距离按 0 记录，不会被钳成负数', () => {
    const { result } = renderHook(() => useSessionViewCache());

    result.current.save(
      'session-1',
      [MESSAGE_FIXTURE],
      createScrollRegion({ clientHeight: 800, scrollHeight: 300, scrollTop: 0 }),
    );

    expect(result.current.restore('session-1')?.distanceFromBottom).toBe(0);
  });

  it('拿不到滚动区时按 0 记录：切回该会话应当停在最新处', () => {
    const { result } = renderHook(() => useSessionViewCache());

    result.current.save('session-1', [MESSAGE_FIXTURE], null);

    expect(result.current.restore('session-1')?.distanceFromBottom).toBe(0);
  });
});
