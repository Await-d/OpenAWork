// @vitest-environment jsdom
/**
 * useChatSessionLifecycle v0.1 骨架测试
 *
 * 覆盖：
 * 1. 初始 state（默认值 + 来自 routeSessionId 的种子值）
 * 2. ref 的初始指向（active / loaded / view / route）
 * 3. setMessages 同步镜像到 messagesRef.current
 * 4. setCurrentSessionId 与镜像 ref 在路由稳定后保持一致
 * 5. activateSessionView 推进 epoch + 写入 view ref
 * 6. isCurrentSessionView / isCurrentSessionRequest 守卫语义正确
 * 7. handleToggleMessageRating 在缺少 token / sessionId / 非 assistant 时安全跳过
 * 8. handleToggleMessageRating set / unset 正确调用网关并更新 ratings
 * 9. requestCurrentSessionRefresh 触发后 sessionReloadNonce 自增
 *
 * 参考：use-chat-conversation-state.test.tsx 的渲染风格 + fetch stub。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useChatSessionLifecycle } from './use-chat-session-lifecycle.js';
import { requestCurrentSessionRefresh } from '../../../utils/session/session-list-events.js';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';

const SESSION_ID = 'session-test-001';
const TOKEN = 'tok-fake';
const GATEWAY = 'https://gw.test';
const DEFAULT_VISIBLE = 20;

beforeEach(() => {
  // 默认 stub fetch — 多数测试不需要它,有需要时单独覆盖。
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeAssistantMessage(id: string, content = 'hi'): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    rawContent: content,
    createdAtMs: 1700000000000,
  } as unknown as ChatMessage;
}

describe('useChatSessionLifecycle — 初始值', () => {
  it('routeSessionId 为 undefined 时返回空白状态', () => {
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        routeSessionId: undefined,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaultVisibleMessageCount: DEFAULT_VISIBLE,
      }),
    );

    expect(result.current.currentSessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.messageRatings).toEqual({});
    expect(result.current.sessionReloadNonce).toBe(0);
    expect(result.current.hasPendingFollowContent).toBe(false);
    expect(result.current.isSessionLoading).toBe(false);
    expect(result.current.visibleMessageCount).toBe(DEFAULT_VISIBLE);
    expect(result.current.serverTotalTurnCount).toBeNull();
  });

  it('routeSessionId 存在时种子到 currentSessionId / activeSessionRef / view ref', () => {
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        routeSessionId: SESSION_ID,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaultVisibleMessageCount: DEFAULT_VISIBLE,
      }),
    );

    expect(result.current.currentSessionId).toBe(SESSION_ID);
    expect(result.current.activeSessionRef.current).toBe(SESSION_ID);
    expect(result.current.currentSessionViewRef.current).toEqual({
      epoch: 0,
      sessionId: SESSION_ID,
    });
    expect(result.current.previousRouteSessionIdRef.current).toBe(SESSION_ID);
    expect(result.current.currentLoadedSessionIdRef.current).toBe(SESSION_ID);
    expect(result.current.pendingBootstrapSessionRef.current).toBeNull();
    expect(result.current.pendingSessionNormalizeTimeoutRef.current).toBeNull();
    expect(result.current.sessionViewEpochRef.current).toBe(0);
  });
});

describe('useChatSessionLifecycle — messagesRef 镜像', () => {
  it('每次 setMessages 后 messagesRef.current 同步指向最新数组', () => {
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        routeSessionId: undefined,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaultVisibleMessageCount: DEFAULT_VISIBLE,
      }),
    );

    expect(result.current.messagesRef.current).toEqual([]);

    const next = [makeAssistantMessage('m1'), makeAssistantMessage('m2')];
    act(() => {
      result.current.setMessages(next);
    });

    expect(result.current.messagesRef.current).toBe(result.current.messages);
    expect(result.current.messagesRef.current.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('useChatSessionLifecycle — view guard', () => {
  it('activateSessionView 默认 +1 epoch 并写入 view ref', () => {
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        routeSessionId: undefined,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaultVisibleMessageCount: DEFAULT_VISIBLE,
      }),
    );

    let nextEpoch = 0;
    act(() => {
      nextEpoch = result.current.activateSessionView('session-A');
    });
    expect(nextEpoch).toBe(1);
    expect(result.current.currentSessionViewRef.current).toEqual({
      epoch: 1,
      sessionId: 'session-A',
    });
    expect(result.current.activeSessionRef.current).toBe('session-A');

    act(() => {
      result.current.activateSessionView('session-A', { incrementEpoch: false });
    });
    expect(result.current.currentSessionViewRef.current.epoch).toBe(1); // 未自增
  });

  it('isCurrentSessionView / isCurrentSessionRequest 严格按 (sessionId, epoch) 比对', () => {
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        routeSessionId: undefined,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaultVisibleMessageCount: DEFAULT_VISIBLE,
      }),
    );

    let epoch = 0;
    act(() => {
      epoch = result.current.activateSessionView('session-X');
    });
    expect(result.current.isCurrentSessionView('session-X', epoch)).toBe(true);
    expect(result.current.isCurrentSessionRequest('session-X', epoch)).toBe(true);

    expect(result.current.isCurrentSessionView('session-Y', epoch)).toBe(false);
    expect(result.current.isCurrentSessionView('session-X', epoch + 1)).toBe(false);
  });
});

describe('useChatSessionLifecycle — handleToggleMessageRating', () => {
  it('缺 token / sessionId / 非 assistant / 无 rawContent 时直接返回', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      (props: { token: string | null; sessionId: string | undefined }) =>
        useChatSessionLifecycle({
          routeSessionId: props.sessionId,
          gatewayUrl: GATEWAY,
          token: props.token,
          defaultVisibleMessageCount: DEFAULT_VISIBLE,
        }),
      {
        initialProps: { token: null as string | null, sessionId: undefined as string | undefined },
      },
    );

    await act(async () => {
      await result.current.handleToggleMessageRating(
        makeAssistantMessage('m1'),
        'positive' as never,
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // 即使 token 给上,但没有 sessionId 也跳过
    rerender({ token: TOKEN, sessionId: undefined });
    await act(async () => {
      await result.current.handleToggleMessageRating(
        makeAssistantMessage('m2'),
        'positive' as never,
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // 非 assistant 消息也跳过
    rerender({ token: TOKEN, sessionId: SESSION_ID });
    await act(async () => {
      await result.current.handleToggleMessageRating(
        { ...makeAssistantMessage('m3'), role: 'user' } as unknown as ChatMessage,
        'positive' as never,
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('设置新 rating 时调用 setMessageRating 并写入 ratings 表', async () => {
    const fetchMock = vi.fn(async () => {
      const payload = {
        rating: { messageId: 'm1', rating: 'positive', updatedAtMs: 1700000000000 },
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        routeSessionId: SESSION_ID,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaultVisibleMessageCount: DEFAULT_VISIBLE,
      }),
    );

    await act(async () => {
      await result.current.handleToggleMessageRating(
        makeAssistantMessage('m1'),
        'positive' as never,
      );
    });

    expect(fetchMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.messageRatings.m1).toBeDefined();
    });
    expect(result.current.messageRatings.m1?.rating).toBe('positive');
  });
});

describe('useChatSessionLifecycle — sessionListEvents 订阅', () => {
  it('对当前活跃会话发起 refresh 时 sessionReloadNonce 自增', async () => {
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        routeSessionId: SESSION_ID,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaultVisibleMessageCount: DEFAULT_VISIBLE,
      }),
    );

    expect(result.current.sessionReloadNonce).toBe(0);

    act(() => {
      requestCurrentSessionRefresh(SESSION_ID);
    });

    await waitFor(() => {
      expect(result.current.sessionReloadNonce).toBe(1);
    });

    // 不同 session 的 refresh 不会触发 nonce
    act(() => {
      requestCurrentSessionRefresh('different-session');
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(result.current.sessionReloadNonce).toBe(1);
  });
});
