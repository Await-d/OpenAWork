import type { ChatRenderEntry } from '../../../../components/chat/message/chat-message-group-list.js';
import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../../../components/conversation-runtime/messages/support.js';
import { describe, expect, it } from 'vitest';

import { mergeStreamingEntryIntoHistoricalEntries } from './chat-render-merge.js';

function createEntry(message: ChatMessage): ChatRenderEntry {
  return {
    message,
    renderContent: () => null,
  };
}

describe('mergeStreamingEntryIntoHistoricalEntries', () => {
  it('服务端已持久化同一请求而本地流继续时只渲染本地流消息', () => {
    const userEntry = createEntry({
      id: 'user-1',
      role: 'user',
      content: '请解释这个问题',
    });
    const persistedAssistantEntry = createEntry({
      id: 'server-assistant-1',
      role: 'assistant',
      content: '这是正在生成的回答',
      clientRequestId: 'request-1',
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-1',
      role: 'assistant',
      content: '这是正在生成的回答，后续内容仍在继续。',
      clientRequestId: 'request-1',
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [userEntry, persistedAssistantEntry],
        streamingEntry,
        'local-stream-1',
        'request-1',
      ),
    ).toEqual([userEntry, streamingEntry]);
  });

  it('思考中的结构化消息按请求 ID 识别同一轮', () => {
    const persistedAssistantEntry = createEntry({
      id: 'server-assistant-1',
      role: 'assistant',
      content: createAssistantTraceContent({
        reasoningBlocks: ['先检查现有状态'],
        text: '这是正在生成的回答',
        toolCalls: [],
      }),
      clientRequestId: 'request-1',
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-1',
      role: 'assistant',
      content: createAssistantTraceContent({
        reasoningBlocks: ['先检查现有状态', '再继续处理'],
        text: '这是正在生成的回答，后续内容仍在继续。',
        toolCalls: [],
      }),
      clientRequestId: 'request-1',
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [persistedAssistantEntry],
        streamingEntry,
        'local-stream-1',
        'request-1',
      ),
    ).toEqual([streamingEntry]);
  });

  it('同一请求且内容相同时仍保留流式消息状态', () => {
    const persistedAssistantEntry = createEntry({
      id: 'server-assistant-1',
      role: 'assistant',
      content: '这是正在生成的回答',
      clientRequestId: 'request-1',
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-1',
      role: 'assistant',
      content: '这是正在生成的回答',
      clientRequestId: 'request-1',
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [persistedAssistantEntry],
        streamingEntry,
        'local-stream-1',
        'request-1',
      ),
    ).toEqual([streamingEntry]);
  });

  it('不同请求即使回复互为前缀也分别渲染', () => {
    const previousAssistantEntry = createEntry({
      id: 'assistant-1',
      role: 'assistant',
      content: '这是正在生成的回答',
      clientRequestId: 'request-1',
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-2',
      role: 'assistant',
      content: '这是正在生成的回答，后续内容仍在继续。',
      clientRequestId: 'request-2',
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [previousAssistantEntry],
        streamingEntry,
        'local-stream-2',
        'request-2',
      ),
    ).toEqual([previousAssistantEntry, streamingEntry]);
  });

  it('工具轮的派生请求 ID 不合并到当前流', () => {
    const toolRoundEntry = createEntry({
      id: 'tool-round-assistant-1',
      role: 'assistant',
      content: '正在处理请求',
      clientRequestId: 'request-1:assistant:1',
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-1',
      role: 'assistant',
      content: '正在处理请求',
      clientRequestId: 'request-1',
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [toolRoundEntry],
        streamingEntry,
        'local-stream-1',
        'request-1',
      ),
    ).toEqual([toolRoundEntry, streamingEntry]);
  });
});
