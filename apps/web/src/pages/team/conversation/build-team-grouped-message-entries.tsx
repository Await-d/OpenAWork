import type { ReactNode } from 'react';
import type {
  ChatRenderAction,
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../../components/chat/message/chat-message-group-list.js';
import { renderChatMessageContentWithOptions } from '../../../components/chat/session/ChatPageSections.js';
import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';
import { parseAssistantEventContent } from '../../../components/conversation-runtime/messages/support.js';
import { groupChatRenderEntries } from '../../../components/conversation-runtime/messages/group-render-entries.js';
import {
  getRoleLayerIdentity,
  getRoleLayerIdentityFromAgentId,
} from '../runtime/data/role-layer-identity.js';
import { TeamAssistantProcessOutline } from './extras/TeamAssistantProcessOutline.js';
import { TeamAssistantReplyCard } from './extras/TeamAssistantReplyCard.js';

export function buildTeamGroupedMessageEntries(input: {
  buildEntryActions: (message: ChatMessage) => ChatRenderAction[];
  messages: ChatMessage[];
  roleLayer: string | null;
  streamBuffer: string;
  streamingSegments: ChatMessagePart[];
  visibleStreaming: boolean;
}): ChatRenderGroup[] {
  const entries: ChatRenderEntry[] = input.messages.map((message) => {
    const useChatStyleRender =
      message.role !== 'assistant' || parseAssistantEventContent(message.content) !== null;
    const messageIdentity =
      message.role === 'assistant'
        ? message.agentId
          ? getRoleLayerIdentityFromAgentId(message.agentId)
          : getRoleLayerIdentity(input.roleLayer)
        : null;

    return {
      message,
      renderContent: (m) =>
        useChatStyleRender ? (
          renderChatMessageContentWithOptions(m)
        ) : (
          <TeamAssistantReplyCard
            message={m}
            processContent={<TeamAssistantProcessOutline message={m} />}
          />
        ),
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
            presentationMode: 'team' as const,
          }
        : {}),
      actions: input.buildEntryActions(message),
    };
  });

  if (input.visibleStreaming) {
    const streamingMessage: ChatMessage = {
      id: 'team-streaming-assistant',
      role: 'assistant',
      content: input.streamBuffer.trim().length > 0 ? input.streamBuffer : '团队正在处理中…',
      ...(input.streamingSegments.length > 0 ? { parts: input.streamingSegments } : {}),
      ...(input.roleLayer ? { agentId: input.roleLayer } : {}),
      status: 'streaming',
    };
    const streamingIdentity = streamingMessage.agentId
      ? getRoleLayerIdentityFromAgentId(streamingMessage.agentId)
      : getRoleLayerIdentity(input.roleLayer);
    entries.push({
      message: streamingMessage,
      renderContent: (m): ReactNode => (
        <TeamAssistantReplyCard
          message={m}
          processContent={<TeamAssistantProcessOutline message={m} />}
        />
      ),
      groupIdentityKey:
        streamingMessage.agentId?.trim() ||
        (input.roleLayer ? `layer:${input.roleLayer}` : 'layer:fallback'),
      identityOverride: {
        color: streamingIdentity.color,
        displayName: streamingIdentity.label,
        icon: streamingIdentity.icon,
        initials: streamingIdentity.initials,
      },
      presentationMode: 'team',
      actions: [],
    });
  }

  return groupChatRenderEntries(entries);
}
