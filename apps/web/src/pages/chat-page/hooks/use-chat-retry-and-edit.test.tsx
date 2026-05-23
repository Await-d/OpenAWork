// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChatRetryAndEdit } from './use-chat-retry-and-edit.js';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import type { HistoryEditPrompt, RetryPrompt } from './use-chat-message-actions.js';

const baseMessage = (id: string): ChatMessage =>
  ({ id, role: 'user', content: `msg-${id}` }) as unknown as ChatMessage;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('useChatRetryAndEdit', () => {
  it('trimMessagesFromSource 会截断到源消息之前', () => {
    const { result } = renderHook(() =>
      useChatRetryAndEdit({
        gatewayUrl: 'https://gw.test',
        token: 'tok',
        currentSessionId: 's1',
        messages: [baseMessage('m1'), baseMessage('m2'), baseMessage('m3')],
        setMessages: vi.fn(),
        resetStreamState: vi.fn(),
        setStreamError: vi.fn(),
        retryPrompt: null,
        setRetryPrompt: vi.fn(),
        historyEditPrompt: null,
        sendMessage: vi.fn(),
        createBranchSessionFromMessage: vi.fn(),
      }),
    );

    expect(
      result.current.trimMessagesFromSource([baseMessage('a'), baseMessage('b')], 'b'),
    ).toHaveLength(1);
  });

  it('handleRetryInNewSession 在无 inputParts 时会创建分支后重发', async () => {
    const sendMessage = vi.fn(async () => true);
    const createBranchSessionFromMessage = vi.fn(async () => 'branch-1');
    const retryPrompt: RetryPrompt = {
      sourceMessageId: 'm2',
      text: 'retry text',
    };

    const { result } = renderHook(() =>
      useChatRetryAndEdit({
        gatewayUrl: 'https://gw.test',
        token: 'tok',
        currentSessionId: 's1',
        messages: [baseMessage('m1'), baseMessage('m2')],
        setMessages: vi.fn(),
        resetStreamState: vi.fn(),
        setStreamError: vi.fn(),
        retryPrompt,
        setRetryPrompt: vi.fn(),
        historyEditPrompt: null,
        sendMessage,
        createBranchSessionFromMessage,
      }),
    );

    await act(async () => {
      await result.current.handleRetryInNewSession();
    });

    expect(createBranchSessionFromMessage).toHaveBeenCalledWith('retry text', 'm2');
    expect(sendMessage).toHaveBeenCalledWith('retry text', { forcedSessionId: 'branch-1' });
  });
});
