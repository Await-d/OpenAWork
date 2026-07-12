import type { ChannelMessage } from '../types.js';
import {
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readFirstString,
  readRecord,
  readRecordArray,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

function resolveWhatsAppChatId(
  value: Record<string, unknown> | null,
  message: Record<string, unknown> | null,
): string {
  return (
    readFirstString(value, ['chat_id', 'conversation_id', 'conversationId', 'group_id']) ||
    readFirstString(readRecord(value, 'conversation'), ['id']) ||
    readFirstString(readRecord(value, 'chat'), ['id']) ||
    readFirstString(readRecord(value, 'group'), ['id']) ||
    readFirstString(message, ['chat_id', 'conversation_id', 'conversationId', 'group_id', 'from'])
  );
}

function resolveWhatsAppSenderId(message: Record<string, unknown> | null, chatId: string): string {
  return readFirstString(message, ['author', 'sender_id', 'senderId', 'from']) || chatId;
}

function resolveWhatsAppSenderName(
  contact: Record<string, unknown> | null,
  profile: Record<string, unknown> | null,
  message: Record<string, unknown> | null,
  senderId: string,
): string {
  return (
    readString(profile, 'name') ||
    readFirstString(contact, ['name', 'wa_id']) ||
    readFirstString(message, ['author_name', 'sender_name', 'senderName']) ||
    senderId
  );
}

function resolveWhatsAppChatName(value: Record<string, unknown> | null): string | undefined {
  const chatName =
    readFirstString(readRecord(value, 'conversation'), ['name', 'title']) ||
    readFirstString(readRecord(value, 'chat'), ['name', 'title']) ||
    readFirstString(readRecord(value, 'group'), ['name', 'title']) ||
    readFirstString(value, ['chat_name', 'conversation_name', 'group_name']);
  return chatName || undefined;
}

export function parseWhatsAppInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const entry = readRecordArray(data, 'entry')[0] ?? null;
  const change = readRecordArray(entry, 'changes')[0] ?? null;
  const value = readRecord(change, 'value');
  const message = readRecordArray(value, 'messages')[0] ?? null;
  const contact = readRecordArray(value, 'contacts')[0] ?? null;
  const profile = readRecord(contact, 'profile');
  const text = readRecord(message, 'text');
  const content = readString(text, 'body');
  const chatId = resolveWhatsAppChatId(value, message);
  if (!chatId || !content) {
    return null;
  }

  const senderId = resolveWhatsAppSenderId(message, chatId);

  return {
    id: readString(message, 'id') || `${Date.now()}`,
    senderId,
    senderName: resolveWhatsAppSenderName(contact, profile, message, senderId),
    chatId,
    chatName: resolveWhatsAppChatName(value),
    content,
    timestamp: readTimestamp(readString(message, 'timestamp')),
    raw: data,
  };
}
