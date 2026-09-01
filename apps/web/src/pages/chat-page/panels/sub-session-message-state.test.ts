import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { mergeOptimisticUserMessage } from './sub-session-message-state.js';

describe('mergeOptimisticUserMessage', () => {
  it('服务端已持久化相同请求时只保留服务端消息', () => {
    const serverMessage: ChatMessage = {
      id: 'server-user-1',
      role: 'user',
      content: 'same request',
      createdAt: 60_000,
      status: 'completed',
    };
    const optimisticMessage: ChatMessage = {
      id: 'child-user-1',
      role: 'user',
      content: 'same request',
      createdAt: 1_000,
      status: 'completed',
    };

    const merged = mergeOptimisticUserMessage([serverMessage], optimisticMessage);

    expect(merged).toEqual([serverMessage]);
  });

  it('服务端尚未返回请求时保留本地 optimistic 消息', () => {
    const optimisticMessage: ChatMessage = {
      id: 'child-user-1',
      role: 'user',
      content: 'pending request',
      createdAt: 1_000,
      status: 'completed',
    };

    const merged = mergeOptimisticUserMessage([], optimisticMessage);

    expect(merged).toEqual([optimisticMessage]);
  });
});
