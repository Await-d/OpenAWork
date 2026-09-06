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

  it('同一请求存在多个服务端副本时只保留一个实时消息并维持最早位置', () => {
    const userEntry = createEntry({
      id: 'user-1',
      role: 'user',
      content: '继续处理',
      createdAt: 1_000,
    });
    const firstPersistedEntry = createEntry({
      id: 'server-assistant-1',
      role: 'assistant',
      content: '正在处理',
      clientRequestId: 'request-1',
      createdAt: 1_100,
      status: 'completed',
    });
    const laterEventEntry = createEntry({
      id: 'assistant-event-1',
      role: 'assistant',
      content: '事件卡片',
      createdAt: 1_200,
      status: 'completed',
    });
    const duplicatePersistedEntry = createEntry({
      id: 'server-assistant-duplicate',
      role: 'assistant',
      content: '正在处理（重复快照）',
      clientRequestId: 'request-1',
      createdAt: 1_100,
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-1',
      role: 'assistant',
      content: '正在处理，实时内容',
      clientRequestId: 'request-1',
      createdAt: 1_100,
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [userEntry, firstPersistedEntry, laterEventEntry, duplicatePersistedEntry],
        streamingEntry,
        'local-stream-1',
        'request-1',
      ),
    ).toEqual([userEntry, streamingEntry, laterEventEntry]);
  });

  it('消息 ID 变化但共享工具 part 时不重复渲染实时消息', () => {
    const persistedAssistantEntry = createEntry({
      id: 'server-assistant-1',
      role: 'assistant',
      content: '{}',
      parts: [
        { id: 'text-1', type: 'text', text: '开始' },
        {
          id: 'tool-1',
          type: 'tool',
          toolCallId: 'tool-1',
          toolName: 'read',
          input: {},
          status: 'running',
        },
      ],
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-1',
      role: 'assistant',
      content: '{}',
      parts: [
        { id: 'text-1', type: 'text', text: '开始' },
        {
          id: 'tool-1',
          type: 'tool',
          toolCallId: 'tool-1',
          toolName: 'read',
          input: {},
          status: 'completed',
          output: '完成',
        },
      ],
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [persistedAssistantEntry],
        streamingEntry,
        'local-stream-1',
        null,
      ),
    ).toEqual([streamingEntry]);
  });

  it('工具轮之后的实时消息插入到同请求派生轮之后且早于后续事件', () => {
    const toolRoundEntry = createEntry({
      id: 'tool-round-assistant-1',
      role: 'assistant',
      content: '工具执行完成',
      clientRequestId: 'request-1:assistant:1',
      createdAt: 1_100,
      status: 'completed',
    });
    const laterEventEntry = createEntry({
      id: 'assistant-event-1',
      role: 'assistant',
      content: '后续事件卡片',
      createdAt: 1_300,
      status: 'completed',
    });
    const streamingEntry = createEntry({
      id: 'local-stream-1',
      role: 'assistant',
      content: '工具后的最终回答',
      clientRequestId: 'request-1',
      createdAt: 1_200,
      status: 'streaming',
    });

    expect(
      mergeStreamingEntryIntoHistoricalEntries(
        [toolRoundEntry, laterEventEntry],
        streamingEntry,
        'local-stream-1',
        'request-1',
      ),
    ).toEqual([toolRoundEntry, streamingEntry, laterEventEntry]);
  });
});
