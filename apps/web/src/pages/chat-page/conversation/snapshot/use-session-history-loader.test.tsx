import { act, cleanup, renderHook } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubagentNotice } from '@openAwork/shared';
import type { SessionMessagesPage } from '@openAwork/web-client';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { useSessionHistoryLoader } from './use-session-history-loader.js';

const { listMessages } = vi.hoisted(() => ({ listMessages: vi.fn() }));
vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({ listMessages }),
}));

function renderHistory() {
  const view = { current: { sessionId: 'a' as string | null, epoch: 1 } };
  const setServerTotalTurnCount = vi.fn();
  const hook = renderHook(
    ({ sessionId, reloadKey }: { sessionId: string; reloadKey?: number }) => {
      const [messages, setMessages] = useState<ChatMessage[]>([
        { id: 'recent', role: 'user', content: 'recent', createdAt: 100 },
      ]);
      const [notices, setNotices] = useState<SubagentNotice[]>([]);
      const messagesRef = useRef(messages);
      useEffect(() => {
        messagesRef.current = messages;
      }, [messages]);
      const loader = useSessionHistoryLoader({
        gatewayUrl: 'http://localhost:3000',
        token: 'token',
        currentSessionId: sessionId,
        reloadKey,
        currentSessionViewRef: view,
        messagesRef,
        isCurrentSessionView: (id, epoch) =>
          view.current.sessionId === id && view.current.epoch === epoch,
        setMessages,
        setSubagentNotices: setNotices,
        setServerTotalTurnCount,
      });
      return { ...loader, messages, notices };
    },
    { initialProps: { sessionId: 'a' } as { sessionId: string; reloadKey?: number } },
  );
  return { hook, view, setServerTotalTurnCount };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useSessionHistoryLoader', () => {
  it('通过公共客户端读取限量消息、前插且耗尽后才清历史计数', async () => {
    listMessages.mockResolvedValueOnce({
      messages: [
        { id: 'old', role: 'user', content: [{ type: 'text', text: 'old' }], createdAt: 10 },
      ],
      more: true,
      nextCursor: 'cursor',
    });
    const { hook, setServerTotalTurnCount } = renderHistory();
    const recent = hook.result.current.messages[0];
    await act(async () => {
      await hook.result.current.loadEarlierHistory();
    });
    expect(listMessages).toHaveBeenCalledWith('token', 'a', { before: undefined, limit: 50 });
    expect(hook.result.current.messages.map((message) => message.id)).toEqual(['old', 'recent']);
    expect(hook.result.current.messages[1]).toBe(recent);
    expect(hook.result.current.hasMoreHistory).toBe(true);
    expect(setServerTotalTurnCount).not.toHaveBeenCalled();
    listMessages.mockResolvedValueOnce({ messages: [], more: false });
    await act(async () => {
      await hook.result.current.loadEarlierHistory();
    });
    expect(listMessages).toHaveBeenLastCalledWith('token', 'a', { before: 'cursor', limit: 50 });
    expect(hook.result.current.hasMoreHistory).toBe(false);
    expect(setServerTotalTurnCount).toHaveBeenCalledWith(null);
  });

  it('A→B→A 后旧分页不发布也不报告加载成功', async () => {
    let resolve: ((page: SessionMessagesPage) => void) | undefined;
    listMessages.mockImplementationOnce(
      () =>
        new Promise<SessionMessagesPage>((done) => {
          resolve = done;
        }),
    );
    const { hook, view, setServerTotalTurnCount } = renderHistory();
    let pending: ReturnType<typeof hook.result.current.loadEarlierHistory> | undefined;
    act(() => {
      pending = hook.result.current.loadEarlierHistory();
    });
    view.current = { sessionId: 'b', epoch: 2 };
    hook.rerender({ sessionId: 'b' });
    view.current = { sessionId: 'a', epoch: 3 };
    hook.rerender({ sessionId: 'a' });
    await act(async () => {
      resolve?.({
        messages: [
          { id: 'old', role: 'user', content: [{ type: 'text', text: 'old' }], createdAt: 10 },
        ],
        more: false,
      });
      expect(await pending).toBeNull();
    });
    expect(hook.result.current.messages.map((message) => message.id)).toEqual(['recent']);
    expect(setServerTotalTurnCount).not.toHaveBeenCalled();
  });

  it('同会话重载后重置已耗尽游标，从最新页重新加载', async () => {
    listMessages.mockResolvedValue({ messages: [], more: false });
    const { hook } = renderHistory();
    await act(async () => {
      await hook.result.current.loadEarlierHistory();
    });
    expect(hook.result.current.hasMoreHistory).toBe(false);
    hook.rerender({ sessionId: 'a', reloadKey: 1 });
    expect(hook.result.current.hasMoreHistory).toBeNull();
    await act(async () => {
      await hook.result.current.loadEarlierHistory();
    });
    expect(listMessages).toHaveBeenCalledTimes(2);
    expect(listMessages).toHaveBeenLastCalledWith('token', 'a', { before: undefined, limit: 50 });
  });

  it('卸载后使在途结果失效', async () => {
    let resolve: ((page: SessionMessagesPage) => void) | undefined;
    listMessages.mockImplementationOnce(
      () =>
        new Promise<SessionMessagesPage>((done) => {
          resolve = done;
        }),
    );
    const { hook, setServerTotalTurnCount } = renderHistory();
    const pending = hook.result.current.loadEarlierHistory();
    hook.unmount();
    resolve?.({ messages: [], more: false });
    expect(await pending).toBeNull();
    expect(setServerTotalTurnCount).not.toHaveBeenCalled();
  });
});
