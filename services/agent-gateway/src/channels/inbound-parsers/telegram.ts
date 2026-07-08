import type { ChannelMessage } from '../types.js';
import {
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readRecord,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

export function parseTelegramInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const message = readRecord(data, 'message');
  const chat = readRecord(message, 'chat');
  const from = readRecord(message, 'from');
  const content = readString(message, 'text');
  if (!chat || !content) {
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
