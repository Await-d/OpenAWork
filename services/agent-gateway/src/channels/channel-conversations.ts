import { sqliteAll } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { extractMessageText } from '../session/session-message-store.js';
import type { ChannelInstance } from './types.js';

interface ChannelConversationSessionRow {
  id: string;
  title: string | null;
  state_status: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface ChannelConversationSummary {
  id: string;
  chatId: string;
  chatName: string | null;
  title: string;
  stateStatus: string;
  messageCount: number;
  lastMessagePreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export function parseChannelChatId(title: string | null, channelId: string): string | null {
  const prefix = `channel:${channelId}:chat:`;
  if (!title?.startsWith(prefix)) {
    return null;
  }

  const chatId = title.slice(prefix.length);
  return chatId.length > 0 ? chatId : null;
}

function getChannelChatName(channel: ChannelInstance, chatId: string): string | null {
  return (
    channel.subscriptions?.find((subscription) => subscription.chatId === chatId)?.name ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readChannelMetadataId(metadata: Record<string, unknown>): string | null {
  if (metadata['source'] !== 'channel') {
    return null;
  }

  const channelMetadata = metadata['channel'];
  if (!isRecord(channelMetadata)) {
    return null;
  }

  const channelId = channelMetadata['id'];
  return typeof channelId === 'string' && channelId.length > 0 ? channelId : null;
}

function isChannelSession(row: ChannelConversationSessionRow, channelId: string): boolean {
  const chatId = parseChannelChatId(row.title, channelId);
  if (!chatId) {
    return false;
  }

  return readChannelMetadataId(parseSessionMetadataJson(row.metadata_json)) === channelId;
}

function buildLastMessagePreview(input: { sessionId: string; userId: string }): {
  messageCount: number;
  preview: string | null;
} {
  const messages = listSessionMessagesV2({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const latestMessage = messages[messages.length - 1];
  const preview = extractMessageText(latestMessage);

  return {
    messageCount: messages.length,
    preview: preview.length > 0 ? preview : null,
  };
}

export function listChannelConversations(input: {
  channel: ChannelInstance;
  limit: number;
  offset: number;
  userId: string;
}): ChannelConversationSummary[] {
  const rows = sqliteAll<ChannelConversationSessionRow>(
    `SELECT id, title, state_status, metadata_json, created_at, updated_at
     FROM sessions
     WHERE user_id = ? AND title LIKE ?
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`,
    [input.userId, `channel:${input.channel.id}:chat:%`, input.limit, input.offset],
  );

  return rows.flatMap((row) => {
    if (!isChannelSession(row, input.channel.id)) {
      return [];
    }

    const chatId = parseChannelChatId(row.title, input.channel.id);
    if (!chatId) {
      return [];
    }

    const lastMessage = buildLastMessagePreview({
      sessionId: row.id,
      userId: input.userId,
    });

    return [
      {
        id: row.id,
        chatId,
        chatName: getChannelChatName(input.channel, chatId),
        title: row.title ?? '',
        stateStatus: row.state_status,
        messageCount: lastMessage.messageCount,
        lastMessagePreview: lastMessage.preview,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    ];
  });
}
