// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../../components/conversation-runtime/messages/support.js';
import type { ChatRenderGroup } from '../../../components/chat/message/chat-message-group-list.js';
import type { ResolveInlinePermissionActionsFn } from '../../../components/chat/session/ChatPageSections.js';
import { TEAM_STREAMING_MESSAGE_ID } from './build-team-message-entries.js';
import { useTeamRenderGroups, type UseTeamRenderGroupsInput } from './use-team-render-groups.js';

afterEach(() => {
  cleanup();
});

/**
 * 取回消息组：协议已改为判别联合（`kind`），访问 `.entries` 前必须窄化。
 * 实际不是消息组时直接让测试失败（而不是静默跳过断言）。
 */
function requireMessageGroup(
  group: ChatRenderGroup | undefined,
): ChatRenderGroup & { kind: 'messages' } {
  if (group?.kind !== 'messages') {
    throw new Error(`期望消息组，实际为 ${String(group?.kind)}`);
  }
  return group;
}

function renderGroups(initialProps: UseTeamRenderGroupsInput) {
  return renderHook((props: UseTeamRenderGroupsInput) => useTeamRenderGroups(props), {
    initialProps,
  });
}

describe('useTeamRenderGroups', () => {
  it('对重复 message id 只生成一个渲染 entry，并避免覆盖流式占位 id', () => {
    const { result } = renderGroups({
      messages: [
        {
          id: 'same-id',
          role: 'user',
          content: '重复消息',
        },
        {
          id: 'same-id',
          role: 'user',
          content: '重复消息',
        },
        {
          id: TEAM_STREAMING_MESSAGE_ID,
          role: 'assistant',
          content: '旧的流式快照',
        },
      ],
      roleLayer: 'executor',
      visibleStreaming: true,
      streamBuffer: '当前流式内容',
      streamingSegments: [],
      buildEntryActions: () => [],
    });

    const entries = result.current.flatMap((group) => requireMessageGroup(group).entries);
    expect(entries.map((entry) => entry.message.id)).toEqual([
      'same-id',
      TEAM_STREAMING_MESSAGE_ID,
    ]);
    expect(
      entries.find((entry) => entry.message.id === TEAM_STREAMING_MESSAGE_ID)?.message.content,
    ).toBe('当前流式内容');
  });

  it('流式期间追加 team 风格的虚拟 assistant 消息，并按层级身份单独分组', () => {
    const { result } = renderGroups({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          agentId: 'interaction-agent',
          content: '接待层已收到需求。',
        },
      ],
      roleLayer: 'pm1',
      visibleStreaming: true,
      streamBuffer: '规划层正在拆解任务。',
      streamingSegments: [{ id: 'seg-1', type: 'text', text: '规划层正在拆解任务。' }],
      buildEntryActions: () => [],
    });

    expect(result.current).toHaveLength(2);

    const streamingGroup = result.current[1];
    expect(streamingGroup?.key).toBe(TEAM_STREAMING_MESSAGE_ID);
    expect(requireMessageGroup(streamingGroup).entries).toHaveLength(1);

    const streamingEntry = requireMessageGroup(streamingGroup).entries[0];
    expect(streamingEntry?.message.id).toBe(TEAM_STREAMING_MESSAGE_ID);
    expect(streamingEntry?.message.role).toBe('assistant');
    expect(streamingEntry?.message.status).toBe('streaming');
    expect(streamingEntry?.message.agentId).toBe('pm1');
    expect(streamingEntry?.groupIdentityKey).toBe('pm1');
    expect(streamingEntry?.identityOverride?.displayName).toBe('PM1 规划层');
    expect(streamingEntry?.identityOverride?.initials).toBe('划');
    expect(streamingEntry?.actions).toEqual([]);
  });

  it('流式消息没有 streamBuffer 时，使用默认占位文案并回退到 roleLayer 身份', () => {
    const { result } = renderGroups({
      messages: [],
      roleLayer: 'executor',
      visibleStreaming: true,
      streamBuffer: '   ',
      streamingSegments: [],
      buildEntryActions: () => [],
    });

    expect(result.current).toHaveLength(1);
    const streamingEntry = requireMessageGroup(result.current[0]).entries[0];
    expect(streamingEntry?.message.content).toBe('团队正在处理中…');
    expect(streamingEntry?.message.agentId).toBe('executor');
    expect(streamingEntry?.groupIdentityKey).toBe('executor');
    expect(streamingEntry?.identityOverride?.displayName).toBe('执行层');
  });

  it('恢复态 assistant trace 中存在待审批工具调用时，renderContent 可正常构造', () => {
    const renderMarker: ResolveInlinePermissionActionsFn = vi.fn(() => ({
      items: [
        {
          id: 'once',
          label: '允许一次',
          onClick: () => undefined,
        },
      ],
    }));
    const { result } = renderGroups({
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

    const assistantEntry = requireMessageGroup(result.current[0]).entries[0];
    expect(assistantEntry).toBeTruthy();
    // renderContent 在统一 chat 风格渲染下不应抛错，并会消费审批解析器。
    expect(() => assistantEntry?.renderContent(assistantEntry.message)).not.toThrow();
  });

  it('流式帧只重建尾部组，其余组引用保持稳定', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '开始' },
      { id: 'a2', role: 'assistant', agentId: 'pm1', content: '第一轮' },
      { id: 'a3', role: 'assistant', agentId: 'pm1', content: '第二轮' },
    ];
    const buildEntryActions = () => [];
    const baseProps: UseTeamRenderGroupsInput = {
      messages,
      roleLayer: 'pm1',
      visibleStreaming: true,
      streamBuffer: '流式 A',
      streamingSegments: [],
      buildEntryActions,
    };
    const { result, rerender } = renderGroups(baseProps);
    const initialGroups = result.current;

    expect(initialGroups).toHaveLength(2);
    expect(requireMessageGroup(initialGroups[1]).entries).toHaveLength(3);
    expect(requireMessageGroup(initialGroups[1]).entries[2]?.message.content).toBe('流式 A');

    rerender({ ...baseProps, streamBuffer: '流式 AB' });

    expect(result.current[0]).toBe(initialGroups[0]);
    expect(result.current[1]).not.toBe(initialGroups[1]);
    const tailEntries = requireMessageGroup(result.current[1]).entries;
    expect(tailEntries).toHaveLength(3);
    expect(tailEntries[2]?.message.content).toBe('流式 AB');
  });

  it('流式结束后移除占位 entry，尾部组回到历史内容', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '开始' },
      { id: 'a2', role: 'assistant', agentId: 'pm1', content: '第一轮' },
    ];
    const buildEntryActions = () => [];
    const baseProps: UseTeamRenderGroupsInput = {
      messages,
      roleLayer: 'pm1',
      visibleStreaming: true,
      streamBuffer: '流式 A',
      streamingSegments: [],
      buildEntryActions,
    };
    const { result, rerender } = renderGroups(baseProps);
    expect(requireMessageGroup(result.current[1]).entries).toHaveLength(2);

    rerender({ ...baseProps, visibleStreaming: false, streamBuffer: '' });

    expect(result.current[1]).toBeDefined();
    const entries = requireMessageGroup(result.current[1]).entries;
    expect(entries.map((entry) => entry.message.id)).toEqual(['a2']);
  });
});
