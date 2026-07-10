import type { ChannelMessage } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseJsonRecord,
  parseSimpleEnvelope,
  readRecord,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

export function parseDingTalkInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const headers = readRecord(data, 'headers');
  if (!isRecord(data)) {
    return null;
  }
  const payload =
    headers?.['topic'] === '/v1.0/im/bot/messages/get' ? parseDingTalkStreamData(data) : data;
  if (!payload) {
    return null;
  }

  const text = readRecord(payload, 'text');
  const parsedText = parseJsonRecord(readString(text, 'content'));
  const content = (readString(parsedText, 'content') || readString(text, 'content')).trim();
  const chatId = readString(payload, 'conversationId');
  if (!chatId || !content) {
    return null;
  }

  return {
    id: readString(payload, 'msgId') || `${Date.now()}`,
    senderId: readString(payload, 'senderStaffId') || readString(payload, 'senderId') || 'unknown',
    senderName: readString(payload, 'senderNick') || readString(payload, 'senderId') || 'unknown',
    chatId,
    chatName: readString(payload, 'conversationTitle') || undefined,
    content,
    timestamp: readTimestamp(
      readString(payload, 'msgCreateTime') || readString(payload, 'createAt'),
    ),
    raw: data,
  };
}

function parseDingTalkStreamData(data: Record<string, unknown>): Record<string, unknown> | null {
  const payload = data['data'];
  if (typeof payload === 'string') {
    return parseJsonRecord(payload);
  }
  return isRecord(payload) ? payload : null;
}
