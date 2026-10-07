import type {
  ChatRenderAction,
  ChatRenderEntry,
} from '../../../components/chat/message/chat-message-group-list.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from '../../../components/chat/session/ChatPageSections.js';
import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';
import {
  getRoleLayerIdentity,
  getRoleLayerIdentityFromAgentId,
} from '../runtime/data/role-layer-identity.js';
import type { ResolveInlinePermissionActionsFn } from '../../../components/chat/session/ChatPageSections.js';

export const TEAM_STREAMING_MESSAGE_ID = 'team-streaming-assistant';

export interface BuildTeamMessageEntriesInput {
  buildEntryActions: (message: ChatMessage) => ChatRenderAction[];
  messages: ChatMessage[];
  roleLayer: string | null;
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  visibleStreaming: boolean;
}

/**
 * 历史消息 → 渲染 entry（不含流式占位消息）。
 *
 * 与 `buildTeamStreamingMessageEntry` 拆开是为了让本结果在流式期间保持**引用
 * 稳定**：token 帧只重建流式 entry，历史 entry / 分组前缀才能整段复用
 * （见 `useTeamRenderGroups`）。依赖里不要引入 streamBuffer / streamingSegments。
 */
export function buildTeamMessageEntries(input: BuildTeamMessageEntriesInput): ChatRenderEntry[] {
  const seenMessageIds = new Set<string>();
  const messages = input.messages.filter((message) => {
    if (seenMessageIds.has(message.id)) {
      return false;
    }
    if (input.visibleStreaming && message.id === TEAM_STREAMING_MESSAGE_ID) {
      return false;
    }
    seenMessageIds.add(message.id);
    return true;
  });

  return messages.map((message) => {
    const messageIdentity =
      message.role === 'assistant'
        ? message.agentId
          ? getRoleLayerIdentityFromAgentId(message.agentId)
          : getRoleLayerIdentity(input.roleLayer)
        : null;

    return {
      message,
      renderContent: (m) =>
        renderChatMessageContentWithOptions(m, {
          presentationMode: 'team',
          resolveInlinePermissionActions: input.resolveInlinePermissionActions,
        }),
      ...(message.role === 'assistant'
        ? {
            groupIdentityKey:
              message.agentId?.trim() ||
              (input.roleLayer ? `layer:${input.roleLayer}` : 'layer:fallback'),
            identityOverride: {
              color: messageIdentity?.color,
              displayName: messageIdentity?.label ?? '团队',
              icon: messageIdentity?.icon,
              initials: messageIdentity?.initials,
            },
          }
        : {}),
      actions: input.buildEntryActions(message),
    };
  });
}

export interface BuildTeamStreamingMessageEntryInput {
  roleLayer: string | null;
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  streamBuffer: string;
  streamingSegments: ChatMessagePart[];
}

/**
 * 流式占位消息 → 渲染 entry。每个流式帧重建属预期行为（内容在变），
 * 该 entry 不得被任何跨帧缓存复用。
 */
export function buildTeamStreamingMessageEntry(
  input: BuildTeamStreamingMessageEntryInput,
): ChatRenderEntry {
  const streamingMessage: ChatMessage = {
    id: TEAM_STREAMING_MESSAGE_ID,
    role: 'assistant',
    content: input.streamBuffer.trim().length > 0 ? input.streamBuffer : '团队正在处理中…',
    ...(input.streamingSegments.length > 0 ? { parts: input.streamingSegments } : {}),
    ...(input.roleLayer ? { agentId: input.roleLayer } : {}),
    status: 'streaming',
  };
  const streamingIdentity = streamingMessage.agentId
    ? getRoleLayerIdentityFromAgentId(streamingMessage.agentId)
    : getRoleLayerIdentity(input.roleLayer);
  return {
    message: streamingMessage,
    renderContent: (m) =>
      renderStreamingChatMessageContentWithOptions(m, {
        presentationMode: 'team',
        resolveInlinePermissionActions: input.resolveInlinePermissionActions,
      }),
    groupIdentityKey:
      streamingMessage.agentId?.trim() ||
      (input.roleLayer ? `layer:${input.roleLayer}` : 'layer:fallback'),
    identityOverride: {
      color: streamingIdentity.color,
      displayName: streamingIdentity.label,
      icon: streamingIdentity.icon,
      initials: streamingIdentity.initials,
    },
    actions: [],
  };
}
