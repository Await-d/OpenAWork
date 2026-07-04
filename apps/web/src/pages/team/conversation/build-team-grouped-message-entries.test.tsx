import { describe, expect, it, vi } from 'vitest';
import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../../components/conversation-runtime/messages/support.js';
import { buildTeamGroupedMessageEntries } from './build-team-grouped-message-entries.js';
import type { ResolveInlinePermissionActionsFn } from '../../../components/chat/session/ChatPageSections.js';

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

  it('恢复态 assistant trace 中存在待审批工具调用时，也会切回 chat 风格渲染', () => {
    const renderMarker: ResolveInlinePermissionActionsFn = vi.fn(() => ({
      items: [
        {
          id: 'once',
          label: '允许一次',
          onClick: () => undefined,
        },
      ],
    }));
    const groups = buildTeamGroupedMessageEntries({
      messages: [
        {
          id: 'assistant-trace-permission',
          role: 'assistant',
          content: createAssistantTraceContent({
            text: '需要你确认后继续执行。',
            toolCalls: [
              {
                toolCallId: 'tool-1',
                toolName: 'bash',
                input: { command: 'pwd' },
                pendingPermissionRequestId: 'perm-1',
                status: 'paused',
              },
            ],
          }),
        },
      ],
      roleLayer: 'executor',
      resolveInlinePermissionActions: renderMarker,
      visibleStreaming: false,
      streamBuffer: '',
      streamingSegments: [],
      buildEntryActions: () => [],
    });

    const assistantEntry = groups[0]?.entries[0];
    expect(assistantEntry).toBeTruthy();
    // renderContent 在统一 chat 风格渲染下不应抛错，并会消费审批解析器。
    expect(() => assistantEntry?.renderContent(assistantEntry.message)).not.toThrow();
  });
});
