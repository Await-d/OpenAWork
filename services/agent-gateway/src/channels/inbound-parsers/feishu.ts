import type { ChannelMessage } from '../types.js';
import {
  normalizeInboundRaw,
  parseJsonRecord,
  parseSimpleEnvelope,
  readRecord,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

export function parseFeishuInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const header = readRecord(data, 'header');
  if (header?.['event_type'] !== 'im.message.receive_v1') {
    return null;
  }

  const event = readRecord(data, 'event');
  const message = readRecord(event, 'message');
  const sender = readRecord(event, 'sender');
  const senderId = readRecord(sender, 'sender_id');
  const contentPayload = parseJsonRecord(readString(message, 'content'));
  const content = readString(contentPayload, 'text') || readString(message, 'content');
  const chatId = readString(message, 'chat_id');
  if (!chatId || !content) {
    return null;
  }

  return {
    id: readString(message, 'message_id') || `${Date.now()}`,
    senderId: readString(senderId, 'open_id') || readString(senderId, 'user_id') || 'unknown',
    senderName: readString(senderId, 'open_id') || readString(senderId, 'user_id') || 'unknown',
    chatId,
    content,
    timestamp: readTimestamp(readString(message, 'create_time')),
    raw: data,
  };
}
