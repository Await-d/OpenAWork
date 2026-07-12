import type { ChannelMessage, ChannelParseContext } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseBooleanConfig,
  parseSimpleEnvelope,
  readRecord,
  readRecordArray,
  readString,
  readTimestamp,
  stripLeadingMentions,
} from '../inbound-utils.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveDiscordBotUserId(context?: ChannelParseContext): string {
  return context?.botId?.trim() || context?.channel?.config['botUserId']?.trim() || '';
}

function shouldRequireDiscordMention(context?: ChannelParseContext): boolean {
  return parseBooleanConfig(context?.channel?.config['requireMentionInGroup']);
}

function isDiscordGuildMessage(message: Record<string, unknown>): boolean {
  return Boolean(readString(message, 'guild_id'));
}

function isDiscordBotMentioned(
  message: Record<string, unknown>,
  content: string,
  botUserId: string,
): boolean {
  if (!content || !botUserId) {
    return false;
  }
  const mentions = readRecordArray(message, 'mentions');
  if (mentions.some((mention) => readString(mention, 'id') === botUserId)) {
    return true;
  }
  return new RegExp(`<@!?${escapeRegExp(botUserId)}>`, 'i').test(content);
}

export function parseDiscordInboundMessage(
  raw: unknown,
  context?: ChannelParseContext,
): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw, context);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  if (!isRecord(data) || data['t'] !== 'MESSAGE_CREATE') {
    return null;
  }

  const message = readRecord(data, 'd');
  if (!message) {
    return null;
  }
  const author = readRecord(message, 'author');
  if (author?.['bot'] === true) {
    return null;
  }

  const chatId = readString(message, 'channel_id');
  const rawContent = readString(message, 'content');
  if (!chatId || !rawContent) {
    return null;
  }

  if (
    shouldRequireDiscordMention(context) &&
    isDiscordGuildMessage(message) &&
    !isDiscordBotMentioned(message, rawContent, resolveDiscordBotUserId(context))
  ) {
    return null;
  }

  const content = stripLeadingMentions(rawContent);
  if (!content) {
    return null;
  }

  return {
    id: readString(message, 'id') || `${Date.now()}`,
    senderId: readString(author, 'id') || 'unknown',
    senderName: readString(author, 'username') || readString(author, 'id') || 'unknown',
    chatId,
    content,
    timestamp: readTimestamp(message?.['timestamp']),
    raw: data,
  };
}
