import type { ChannelMessage, ChannelParseContext } from '../types.js';
import {
  normalizeInboundRaw,
  parseBooleanConfig,
  parseSimpleEnvelope,
  readRecord,
  readString,
  readTimestamp,
  stripLeadingMentions,
} from '../inbound-utils.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTelegramGroupChat(chat: Record<string, unknown> | null): boolean {
  const chatType = readString(chat, 'type');
  return chatType === 'group' || chatType === 'supergroup';
}

function resolveTelegramBotUsername(context?: ChannelParseContext): string {
  const runtimeUsername = context?.botUsername?.trim().replace(/^@/, '');
  if (runtimeUsername) {
    return runtimeUsername;
  }
  return context?.channel?.config['botUsername']?.trim().replace(/^@/, '') || '';
}

function shouldRequireTelegramMention(context?: ChannelParseContext): boolean {
  return parseBooleanConfig(context?.channel?.config['requireMentionInGroup']);
}

function isTelegramBotMentioned(content: string, botUsername: string): boolean {
  if (!content || !botUsername) {
    return false;
  }
  const escapedUsername = escapeRegExp(botUsername);
  return (
    new RegExp(`(^|\\s)@${escapedUsername}(?=\\s|$)`, 'i').test(content) ||
    new RegExp(`^/[\\w-]+@${escapedUsername}(?=\\s|$)`, 'i').test(content)
  );
}

function normalizeTelegramContent(content: string, botUsername: string): string {
  const stripped = stripLeadingMentions(content);
  if (!botUsername) {
    return stripped;
  }
  const escapedUsername = escapeRegExp(botUsername);
  return stripped
    .replace(new RegExp(`^(\\/[\\w-]+)@${escapedUsername}(?=\\s|$)`, 'i'), '$1')
    .trim();
}

export function parseTelegramInboundMessage(
  raw: unknown,
  context?: ChannelParseContext,
): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw, context);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const message = readRecord(data, 'message');
  const chat = readRecord(message, 'chat');
  const from = readRecord(message, 'from');
  const rawContent = readString(message, 'text');
  if (!chat || !rawContent) {
    return null;
  }

  if (
    isTelegramGroupChat(chat) &&
    shouldRequireTelegramMention(context) &&
    !isTelegramBotMentioned(rawContent, resolveTelegramBotUsername(context))
  ) {
    return null;
  }

  const content = normalizeTelegramContent(rawContent, resolveTelegramBotUsername(context));
  if (!content) {
    return null;
  }

  const firstName = readString(from, 'first_name');
  const lastName = readString(from, 'last_name');
  return {
    id: readString(message, 'message_id') || `${Date.now()}`,
    senderId: readString(from, 'id') || 'unknown',
    senderName:
      [firstName, lastName].filter(Boolean).join(' ') || readString(from, 'username') || 'unknown',
    chatId: readString(chat, 'id'),
    chatName: readString(chat, 'title') || undefined,
    content,
    timestamp: readTimestamp(message?.['date']),
    raw: data,
  };
}
