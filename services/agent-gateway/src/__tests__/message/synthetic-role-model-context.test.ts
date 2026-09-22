import { describe, expect, it } from 'vitest';
import { toModelMessages, type UnifiedMessage } from '../../message/message-to-model-messages.js';
import { unifiedConversationToNativeMessages } from '../../v2-runtime/upstream/native-message-bridge.js';
import type { MessageID, MessageWithParts, PartID } from '../../message/message-v2-schema.js';

function asMessageId(value: string): MessageID {
  return value as MessageID;
}

function asPartId(value: string): PartID {
  return value as PartID;
}

function subagentNoticeMessage(text: string): MessageWithParts {
  const messageID = asMessageId('message-synthetic-1');
  return {
    info: {
      id: messageID,
      sessionID: 'session-1',
      role: 'synthetic',
      time: { created: 1 },
      description: '子代理已完成',
      metadata: { source: 'subagent', childID: 'child-1' },
    },
    parts: [
      {
        id: asPartId('part-synthetic-1'),
        sessionID: 'session-1',
        messageID,
        type: 'text',
        text,
        synthetic: true,
      },
    ],
  };
}

describe('synthetic role model context (D-1)', () => {
  it('keeps a synthetic message in the model context', () => {
    expect(toModelMessages([subagentNoticeMessage('子代理 worker-01 已完成任务。')])).toEqual([
      {
        role: 'synthetic',
        content: '子代理 worker-01 已完成任务。',
        syntheticKind: 'subagent-notice',
      },
    ]);
  });

  it('renders the synthetic message upstream as a user turn', () => {
    const native = unifiedConversationToNativeMessages(
      toModelMessages([subagentNoticeMessage('子代理 worker-01 已完成任务。')]),
    );

    expect(native).toHaveLength(1);
    expect(native[0]?.role).toBe('user');
    expect(native[0]?.content).toEqual([{ type: 'text', text: '子代理 worker-01 已完成任务。' }]);
  });

  it('never silently drops a conversation role when bridging upstream', () => {
    const unified: UnifiedMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user request' },
      { role: 'synthetic', content: 'subagent notice', syntheticKind: 'subagent-notice' },
      { role: 'assistant', content: 'assistant reply' },
      { role: 'tool', toolCallId: 'call-1', toolName: 'read', content: 'tool output' },
    ];

    // `system` is intentionally pulled out into SystemPart by
    // `extractNativeSystemFromUnifiedMessages`; every other role must land.
    expect(unifiedConversationToNativeMessages(unified).map((message) => message.role)).toEqual([
      'user',
      'user',
      'assistant',
      'tool',
    ]);
  });
});
