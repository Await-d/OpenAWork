// @vitest-environment jsdom
/**
 * useChatRetryAndEdit v0.1 骨架测试
 *
 * 覆盖：
 * 1. trimMessagesFromSource：本地截断到源消息之前
 * 2. truncateSessionMessagesInPlace：缺 token 时返回空数组、有 token 时调用网关
 * 3. handleRetryInCurrentSession：缺 retryPrompt / sessionId / token 时安全返回
 * 4. handleRetryInCurrentSession：本地命中源消息时用本地截断 + 调 sendMessage + 清空 retryPrompt
 * 5. handleEditResendInCurrentSession：截断 + sendMessage（带 editedInputParts）
 * 6. handleRetryInNewSession：有 inputParts 走 createBranch、无 inputParts 走 createBranch + sendMessage(forcedSessionId)
 *
 * 参考：use-chat-conversation-state.test.tsx 的 fetch stub 风格。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChatRetryAndEdit } from './use-chat-retry-and-edit.js';
import type { RetryPrompt } from './use-chat-message-actions.js';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';

const TOKEN = 'tok-fake';
const GATEWAY = 'https://gw.test';
const SESSION_ID = 'session-test-001';

function makeMessage(id: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return {
    id,
    role,
    content: `content-${id}`,
    createdAtMs: 1700000000000,
  } as unknown as ChatMessage;
}

function makeOptions(overrides?: Partial<Parameters<typeof useChatRetryAndEdit>[0]>) {
  return {
    gatewayUrl: GATEWAY,
    token: TOKEN,
    currentSessionId: SESSION_ID,
    messages: [makeMessage('m1'), makeMessage('m2', 'assistant'), makeMessage('m3')],
    setMessages: vi.fn() as never,
    resetStreamState: vi.fn(),
    setStreamError: vi.fn() as never,
    retryPrompt: null as RetryPrompt | null,
    setRetryPrompt: vi.fn() as never,
    historyEditPrompt: null,
    sendMessage: vi.fn(async () => undefined) as never,
    createBranchSessionFromMessage: vi.fn(async () => 'branch-session-id') as never,
    ...(overrides ?? {}),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useChatRetryAndEdit — 工具回调', () => {
  it('trimMessagesFromSource 截断到源消息之前', () => {
    const { result } = renderHook(() => useChatRetryAndEdit(makeOptions()));

    const list = [makeMessage('a'), makeMessage('b'), makeMessage('c')];
    expect(result.current.trimMessagesFromSource(list, 'b').map((m) => m.id)).toEqual(['a']);
    // 不存在的源 → 原样返回
    expect(result.current.trimMessagesFromSource(list, 'zzz').map((m) => m.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('truncateSessionMessagesInPlace 缺 token 时返回空数组且不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChatRetryAndEdit(makeOptions({ token: null })));

    let out: unknown;
    await act(async () => {
      out = await result.current.truncateSessionMessagesInPlace(SESSION_ID, 'm1');
    });
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('truncateSessionMessagesInPlace 有 token 时调用网关', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChatRetryAndEdit(makeOptions()));

    await act(async () => {
      await result.current.truncateSessionMessagesInPlace(SESSION_ID, 'm1', 'some text');
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('useChatRetryAndEdit — handleRetryInCurrentSession', () => {
  it('缺 retryPrompt 时安全返回不调用 sendMessage', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useChatRetryAndEdit(makeOptions({ retryPrompt: null, sendMessage: sendMessage as never })),
    );

    await act(async () => {
      await result.current.handleRetryInCurrentSession();
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('本地命中源消息时本地截断 + sendMessage + 清空 retryPrompt', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const setMessages = vi.fn();
    const setRetryPrompt = vi.fn();
    const retryPrompt: RetryPrompt = { sourceMessageId: 'm3', text: 'retry text' };

    const { result } = renderHook(() =>
      useChatRetryAndEdit(
        makeOptions({
          retryPrompt,
          sendMessage: sendMessage as never,
          setMessages: setMessages as never,
          setRetryPrompt: setRetryPrompt as never,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleRetryInCurrentSession();
    });

    // m3 是本地第三条 → 截断到 [m1, m2]
    expect(setMessages).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'm1' }),
      expect.objectContaining({ id: 'm2' }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith('retry text', {});
    expect(setRetryPrompt).toHaveBeenCalledWith(null);
  });
});

describe('useChatRetryAndEdit — handleEditResendInCurrentSession', () => {
  it('截断后用 editedInputParts 调 sendMessage', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const setMessages = vi.fn();

    const { result } = renderHook(() =>
      useChatRetryAndEdit(
        makeOptions({
          sendMessage: sendMessage as never,
          setMessages: setMessages as never,
        }),
      ),
    );

    const editedParts = [{ type: 'input_image', image_url: 'data:...' }] as never;
    await act(async () => {
      await result.current.handleEditResendInCurrentSession('edited text', 'm3', editedParts);
    });

    expect(setMessages).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'm1' }),
      expect.objectContaining({ id: 'm2' }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith('edited text', { existingInputParts: editedParts });
  });
});

describe('useChatRetryAndEdit — handleRetryInNewSession', () => {
  it('无 inputParts 时 createBranch + sendMessage(forcedSessionId)', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const createBranch = vi.fn(async () => 'branch-1');
    const setRetryPrompt = vi.fn();
    const retryPrompt: RetryPrompt = { sourceMessageId: 'm1', text: 'branch text' };

    const { result } = renderHook(() =>
      useChatRetryAndEdit(
        makeOptions({
          retryPrompt,
          sendMessage: sendMessage as never,
          createBranchSessionFromMessage: createBranch as never,
          setRetryPrompt: setRetryPrompt as never,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleRetryInNewSession();
    });

    expect(createBranch).toHaveBeenCalledWith('branch text', 'm1');
    expect(sendMessage).toHaveBeenCalledWith('branch text', { forcedSessionId: 'branch-1' });
    expect(setRetryPrompt).toHaveBeenCalledWith(null);
  });

  it('有 inputParts 时只走 createBranch（不额外 sendMessage）', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const createBranch = vi.fn(async () => 'branch-2');
    const inputParts = [{ type: 'input_image', image_url: 'data:...' }] as never;
    const retryPrompt: RetryPrompt = {
      sourceMessageId: 'm1',
      text: 'branch text',
      inputParts,
    };

    const { result } = renderHook(() =>
      useChatRetryAndEdit(
        makeOptions({
          retryPrompt,
          sendMessage: sendMessage as never,
          createBranchSessionFromMessage: createBranch as never,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleRetryInNewSession();
    });

    expect(createBranch).toHaveBeenCalledWith('branch text', 'm1', inputParts);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
