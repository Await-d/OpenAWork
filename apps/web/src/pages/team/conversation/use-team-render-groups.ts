import { useMemo } from 'react';
import type { SubagentNotice } from '@openAwork/shared';
import type {
  ChatRenderAction,
  ChatRenderGroup,
} from '../../../components/chat/message/chat-message-group-list.js';
import type { ResolveInlinePermissionActionsFn } from '../../../components/chat/session/ChatPageSections.js';
import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';
import {
  appendRenderEntryToMessageGroups,
  groupChatRenderEntries,
} from '../../../components/conversation-runtime/messages/group-render-entries.js';
import {
  buildSubagentNoticeGroups,
  mergeNoticeGroupsIntoRenderGroups,
} from '../../../components/conversation-runtime/messages/subagent-notice-groups.js';
import {
  buildTeamMessageEntries,
  buildTeamStreamingMessageEntry,
} from './build-team-message-entries.js';

export interface UseTeamRenderGroupsInput {
  buildEntryActions: (message: ChatMessage) => ChatRenderAction[];
  messages: ChatMessage[];
  roleLayer: string | null;
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  streamBuffer: string;
  streamingSegments: ChatMessagePart[];
  subagentNotices?: SubagentNotice[];
  visibleStreaming: boolean;
}

/**
 * team 对话消息组装配（流式友好）。
 *
 * 关键不变量：历史 entry / 分组在流式期间保持**引用稳定**（依赖里没有
 * streamBuffer / streamingSegments），token 帧只重建流式占位 entry 并把尾部组
 * 复制一份 —— 消息列表仅尾部组重渲染，`ChatGroupBlock` / `MessageRow` 的
 * React.memo 才能对其余组命中。
 *
 * 通知组的并入（`mergeNoticeGroupsIntoRenderGroups`）仍在每帧执行：通知数量
 * 很少，仅「通知落在组条目跨度内」的组会被拆出新的分段对象。
 */
export function useTeamRenderGroups(input: UseTeamRenderGroupsInput): ChatRenderGroup[] {
  const {
    buildEntryActions,
    messages,
    roleLayer,
    resolveInlinePermissionActions,
    streamBuffer,
    streamingSegments,
    subagentNotices,
    visibleStreaming,
  } = input;

  const historicalEntries = useMemo(
    () =>
      buildTeamMessageEntries({
        messages,
        roleLayer,
        resolveInlinePermissionActions,
        buildEntryActions,
        visibleStreaming,
      }),
    [buildEntryActions, messages, resolveInlinePermissionActions, roleLayer, visibleStreaming],
  );

  const historicalGroups = useMemo(
    () => groupChatRenderEntries(historicalEntries),
    [historicalEntries],
  );

  const streamingEntry = useMemo(
    () =>
      visibleStreaming
        ? buildTeamStreamingMessageEntry({
            streamBuffer,
            streamingSegments,
            roleLayer,
            resolveInlinePermissionActions,
          })
        : null,
    [resolveInlinePermissionActions, roleLayer, streamBuffer, streamingSegments, visibleStreaming],
  );

  return useMemo(() => {
    const messageGroups =
      streamingEntry === null
        ? historicalGroups
        : appendRenderEntryToMessageGroups(historicalGroups, streamingEntry);
    return mergeNoticeGroupsIntoRenderGroups({
      messageGroups,
      noticeGroups: buildSubagentNoticeGroups(subagentNotices ?? []),
    });
  }, [historicalGroups, streamingEntry, subagentNotices]);
}
