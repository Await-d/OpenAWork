import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { buildTeamGroupedMessageEntries } from './build-team-grouped-message-entries.js';

describe('buildTeamGroupedMessageEntries', () => {
  it('在流式期间追加 team 风格的虚拟 assistant 消息，并按层级身份单独分组', () => {
    const messages: ChatMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        agentId: 'interaction-agent',
        content: '接待层已收到需求。',
      },
    ];

    const groups = buildTeamGroupedMessageEntries({
      messages,
      roleLayer: 'pm1',
      visibleStreaming: true,
      streamBuffer: '规划层正在拆解任务。',
      streamingSegments: [{ id: 'seg-1', type: 'text', text: '规划层正在拆解任务。' }],
      buildEntryActions: () => [],
    });

    expect(groups).toHaveLength(2);

    const streamingGroup = groups[1];
    expect(streamingGroup?.key).toBe('team-streaming-assistant');
    expect(streamingGroup?.entries).toHaveLength(1);

    const streamingEntry = streamingGroup?.entries[0];
    expect(streamingEntry?.message.id).toBe('team-streaming-assistant');
    expect(streamingEntry?.message.role).toBe('assistant');
    expect(streamingEntry?.message.status).toBe('streaming');
    expect(streamingEntry?.message.agentId).toBe('pm1');
    expect(streamingEntry?.presentationMode).toBe('team');
    expect(streamingEntry?.groupIdentityKey).toBe('pm1');
    expect(streamingEntry?.identityOverride?.displayName).toBe('PM1 规划层');
    expect(streamingEntry?.identityOverride?.initials).toBe('划');
    expect(streamingEntry?.actions).toEqual([]);
  });

  it('流式消息没有 streamBuffer 时，使用默认占位文案并回退到 roleLayer 身份', () => {
    const groups = buildTeamGroupedMessageEntries({
      messages: [],
      roleLayer: 'executor',
      visibleStreaming: true,
      streamBuffer: '   ',
      streamingSegments: [],
      buildEntryActions: () => [],
    });

    expect(groups).toHaveLength(1);
    const streamingEntry = groups[0]?.entries[0];
    expect(streamingEntry?.message.content).toBe('团队正在处理中…');
    expect(streamingEntry?.message.agentId).toBe('executor');
    expect(streamingEntry?.groupIdentityKey).toBe('executor');
    expect(streamingEntry?.identityOverride?.displayName).toBe('执行层');
  });
});
