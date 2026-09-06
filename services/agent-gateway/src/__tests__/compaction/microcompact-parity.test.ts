import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MICROCOMPACT_CONFIG,
  microcompactMessages,
} from '../../compaction/microcompact.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';

function toolResult(id: string, content: string): UnifiedMessage {
  return {
    role: 'tool',
    toolCallId: id,
    toolName: 'read_file',
    content,
  };
}

describe('microcompact parity baseline', () => {
  it('计数触发不会用更长引用扩大短工具结果', () => {
    // Given
    const messages = [
      toolResult('tool-1', 'old result one '.repeat(10)),
      toolResult('tool-2', 'old result two '.repeat(10)),
      toolResult('tool-3', 'recent result '.repeat(10)),
    ];

    // When
    const result = microcompactMessages(messages, {
      enabled: true,
      triggerThreshold: 1,
      keepRecent: 1,
      timeGapThresholdMinutes: 60,
    });

    // Then
    expect(result).toMatchObject({ applied: false, clearedCount: 0, trigger: 'count' });
    expect(messages.map((message) => message.content)).toEqual([
      'old result one '.repeat(10),
      'old result two '.repeat(10),
      'recent result '.repeat(10),
    ]);
    expect(result.messages).toEqual(messages);
    expect(result.messages[2]?.content).toBe('recent result '.repeat(10));
  });
});

describe('microcompact reference time policy', () => {
  it('默认关闭时间触发，并以 60 分钟和最近 5 个结果作为策略参数', () => {
    // Given
    const messages = Array.from({ length: 6 }, (_, index) =>
      toolResult(`tool-${index}`, `tool result ${index} `.repeat(10)),
    );

    // When
    const result = microcompactMessages(messages, undefined, {
      lastAssistantTimestamp: Date.now() - 61 * 60_000,
    });

    // Then
    expect(DEFAULT_MICROCOMPACT_CONFIG.timeBasedEnabled).toBe(false);
    expect(DEFAULT_MICROCOMPACT_CONFIG.timeGapThresholdMinutes).toBe(60);
    expect(DEFAULT_MICROCOMPACT_CONFIG.keepRecent).toBe(8);
    expect(DEFAULT_MICROCOMPACT_CONFIG.timeBasedKeepRecent).toBe(5);
    expect(result).toMatchObject({ applied: false, clearedCount: 0, trigger: 'none' });
  });

  it('启用后到达 60 分钟但短结果不因引用更长而膨胀', () => {
    // Given
    const messages = Array.from({ length: 8 }, (_, index) =>
      toolResult(`tool-${index}`, `tool result ${index} `.repeat(10)),
    );

    // When
    const result = microcompactMessages(
      messages,
      {
        enabled: true,
        triggerThreshold: 100,
        timeBasedKeepRecent: 5,
        timeBasedEnabled: true,
        timeGapThresholdMinutes: 60,
      },
      { lastAssistantTimestamp: Date.now() - 61 * 60_000 },
    );

    // Then
    expect(result).toMatchObject({ applied: false, clearedCount: 0, trigger: 'time' });
    expect(result.messages).toEqual(messages);
  });

  it('将不膨胀的时间压缩结果交给确定性上游且不改持久化源消息', () => {
    // Given
    const persistedMessages = Array.from({ length: 8 }, (_, index) =>
      toolResult(`tool-${index}`, `persisted output ${index} `.repeat(10)),
    );
    const persistedContents = persistedMessages.map((message) => message.content);
    const compacted = microcompactMessages(
      persistedMessages,
      {
        enabled: true,
        triggerThreshold: 100,
        timeBasedKeepRecent: 5,
        timeBasedEnabled: true,
        timeGapThresholdMinutes: 60,
      },
      { lastAssistantTimestamp: Date.now() - 61 * 60_000 },
    );
    const deterministicUpstream = (messages: UnifiedMessage[]): UnifiedMessage[] => messages;

    // When
    const capturedUpstreamInput = deterministicUpstream(compacted.messages);

    // Then
    expect(capturedUpstreamInput.map((message) => message.content)).toEqual(persistedContents);
    expect(persistedMessages.map((message) => message.content)).toEqual(persistedContents);
  });
});
