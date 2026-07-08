import type { ChannelMessage } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readRecord,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

export function parseDiscordInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  if (!isRecord(data) || data['t'] !== 'MESSAGE_CREATE') {
    return null;
  }

  const message = readRecord(data, 'd');
  const author = readRecord(message, 'author');
  if (author?.['bot'] === true) {
    return null;
  }

  const chatId = readString(message, 'channel_id');
  const content = readString(message, 'content');
  if (!chatId || !content) {
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
