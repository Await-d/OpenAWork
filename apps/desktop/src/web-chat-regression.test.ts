import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../web/src/pages/chat-page/support.js';
import { recoverActiveAssistantStream } from '../../web/src/pages/chat-page/stream-recovery.js';
import { mergeStreamingEntryIntoHistoricalEntries } from '../../web/src/pages/chat-page/chat-render-merge.js';
import type { ChatRenderEntry } from '../../web/src/components/chat/chat-message-group-list.js';

function createAssistantEntry(id: string, content: string): ChatRenderEntry {
  return {
    message: {
      id,
      role: 'assistant',
      content,
      status: 'completed',
    },
    renderContent: () => null,
  };
}

describe('web chat streaming recovery regressions', () => {
  it('recovers the original assistant message id and existing tool calls for an active stream', () => {
    const toolCallId = 'tool-call-1';
    const messages: ChatMessage[] = [
      {
        id: 'assistant-existing',
        role: 'assistant',
        content: createAssistantTraceContent({
          text: '正在处理',
          toolCalls: [
            {
              input: { path: 'src/app.ts' },
              status: 'paused',
              toolCallId,
              toolName: 'read_file',
            },
          ],
        }),
        status: 'completed',
      },
    ];

    const runEvents: RunEvent[] = [
      {
        type: 'text_delta',
        delta: '正在处理更多内容',
        occurredAt: 100,
        runId: 'run-1',
      },
      {
        type: 'tool_result',
        isError: false,
        occurredAt: 120,
        output: { ok: true },
        runId: 'run-1',
        toolCallId,
        toolName: 'read_file',
      },
    ];

    const recovered = recoverActiveAssistantStream({
      activeStreamStartedAt: 50,
      hasActiveStream: true,
      messages,
      runEvents,
      sessionStateStatus: 'running',
    });

    expect(recovered).not.toBeNull();
    expect(recovered?.messageId).toBe('assistant-existing');
    expect(recovered?.toolCalls).toHaveLength(1);
    expect(recovered?.toolCalls[0]?.toolCallId).toBe(toolCallId);
    expect(recovered?.toolCalls[0]?.status).toBe('paused');
  });

  it('replaces the matched historical assistant entry instead of appending a new one', () => {
    const historicalEntries = [
      createAssistantEntry('assistant-existing', '旧内容'),
      createAssistantEntry('assistant-other', '其他内容'),
    ];
    const streamingEntry = createAssistantEntry('assistant-existing', '恢复中的新内容');

    const mergedEntries = mergeStreamingEntryIntoHistoricalEntries(
      historicalEntries,
      streamingEntry,
      'assistant-existing',
    );

    expect(mergedEntries).toHaveLength(2);
    expect(mergedEntries[0]).toBe(streamingEntry);
    expect(mergedEntries[1]).toBe(historicalEntries[1]);
  });

  it('only appends a streaming entry when no historical assistant message matches', () => {
    const historicalEntries = [createAssistantEntry('assistant-existing', '旧内容')];
    const streamingEntry = createAssistantEntry('assistant-new', '恢复中的新内容');

    const mergedEntries = mergeStreamingEntryIntoHistoricalEntries(
      historicalEntries,
      streamingEntry,
      'assistant-new',
    );

    expect(mergedEntries).toHaveLength(2);
    expect(mergedEntries[0]).toBe(historicalEntries[0]);
    expect(mergedEntries[1]).toBe(streamingEntry);
  });
});
