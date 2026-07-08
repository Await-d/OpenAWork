import type { ChannelMessage } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

export function parseWeComInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  if (!isRecord(data) || data['MsgType'] !== 'text') {
    return null;
  }

  const chatId = readString(data, 'ChatId') || readString(data, 'FromUserName');
  const content = readString(data, 'Content');
  if (!chatId || !content) {
    return null;
  }

  return {
    id: readString(data, 'MsgId') || `${Date.now()}`,
    senderId: readString(data, 'FromUserName') || 'unknown',
    senderName: readString(data, 'FromUserName') || 'unknown',
    chatId,
    content,
    timestamp: readTimestamp(readString(data, 'CreateTime')),
    raw: data,
  };
}
