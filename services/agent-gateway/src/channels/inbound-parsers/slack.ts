import type { ChannelMessage, ChannelParseContext } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseBooleanConfig,
  parseSimpleEnvelope,
  readString,
  readTimestamp,
  stripLeadingMentions,
} from '../inbound-utils.js';

function resolveSlackBotUserId(context?: ChannelParseContext): string {
  return context?.botId?.trim() || context?.channel?.config['botUserId']?.trim() || '';
}

function shouldRequireSlackMention(context?: ChannelParseContext): boolean {
  return parseBooleanConfig(context?.channel?.config['requireMentionInGroup']);
}

function isSlackGroupConversation(message: Record<string, unknown>): boolean {
  const channelType = readString(message, 'channel_type');
  if (channelType) {
    return channelType !== 'im';
  }
  const channelId = readString(message, 'channel');
  return channelId.length > 0 && !channelId.startsWith('D');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSlackBotMentioned(content: string, botUserId: string): boolean {
  return botUserId.length > 0 && new RegExp(`<@${escapeRegExp(botUserId)}>`, 'i').test(content);
}

export function parseSlackInboundMessage(
  raw: unknown,
  context?: ChannelParseContext,
): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw, context);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const message =
    isRecord(data) && isRecord(data['message']) ? data['message'] : isRecord(data) ? data : null;
  if (!message) {
    return null;
  }

  if (readString(message, 'subtype') === 'bot_message' || readString(message, 'bot_id')) {
    return null;
  }

  const chatId = readString(message, 'channel');
  const rawContent = readString(message, 'text');
  if (!chatId || !rawContent) {
    return null;
  }

  if (
    shouldRequireSlackMention(context) &&
    isSlackGroupConversation(message) &&
    !isSlackBotMentioned(rawContent, resolveSlackBotUserId(context))
  ) {
    return null;
  }

  const content = stripLeadingMentions(rawContent);
  if (!content) {
    return null;
  }

  return {
    id: readString(message, 'client_msg_id') || readString(message, 'ts') || `${Date.now()}`,
    senderId: readString(message, 'user') || 'unknown',
    senderName: readString(message, 'username') || readString(message, 'user') || 'unknown',
    chatId,
    chatName: readString(message, 'channel_name') || undefined,
    content,
    timestamp: readTimestamp(readString(message, 'ts') || readString(message, 'event_ts')),
    raw: data,
  };
}
