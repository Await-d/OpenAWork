import type { ChannelMessage } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readRecord,
  readString,
  readTimestamp,
  stripLeadingMentions,
} from '../inbound-utils.js';

export function parseQQInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  if (!isRecord(data)) {
    return null;
  }

  const eventType = readString(data, 't');
  const event = readRecord(data, 'd');
  if (!event) {
    return null;
  }

  if (eventType === 'C2C_MESSAGE_CREATE') {
    return parseQQC2CMessage(data, event);
  }

  if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
    return parseQQGroupMessage(data, event);
  }

  if (eventType !== 'AT_MESSAGE_CREATE' && eventType !== 'MESSAGE_CREATE') {
    return null;
  }

  return parseQQChannelMessage(data, event);
}

function parseQQC2CMessage(
  raw: Record<string, unknown>,
  event: Record<string, unknown>,
): ChannelMessage | null {
  const author = readRecord(event, 'author');
  const senderId = readString(author, 'user_openid') || readString(author, 'id');
  const content = stripLeadingMentions(readString(event, 'content'));
  if (!senderId || !content) {
    return null;
  }
  return {
    id: readString(event, 'id') || `${Date.now()}`,
    senderId,
    senderName: senderId,
    chatId: `c2c:${senderId}`,
    chatName: senderId,
    content,
    timestamp: readTimestamp(event['timestamp']),
    raw,
  };
}

function parseQQGroupMessage(
  raw: Record<string, unknown>,
  event: Record<string, unknown>,
): ChannelMessage | null {
  const author = readRecord(event, 'author');
  const groupOpenId = readString(event, 'group_openid') || readString(event, 'group_id');
  const content = stripLeadingMentions(readString(event, 'content'));
  if (!groupOpenId || !content) {
    return null;
  }
  return {
    id: readString(event, 'id') || `${Date.now()}`,
    senderId: readString(author, 'member_openid') || readString(author, 'id') || 'unknown',
    senderName: readString(author, 'username') || readString(author, 'id') || 'unknown',
    chatId: `group:${groupOpenId}`,
    chatName: groupOpenId,
    content,
    timestamp: readTimestamp(event['timestamp']),
    raw,
  };
}

function parseQQChannelMessage(
  raw: Record<string, unknown>,
  event: Record<string, unknown>,
): ChannelMessage | null {
  const author = readRecord(event, 'author');
  if (author?.['bot'] === true) {
    return null;
  }
  const channelId = readString(event, 'channel_id');
  const content = stripLeadingMentions(readString(event, 'content'));
  if (!channelId || !content) {
    return null;
  }

  return {
    id: readString(event, 'id') || `${Date.now()}`,
    senderId: readString(author, 'id') || 'unknown',
    senderName: readString(author, 'username') || readString(author, 'id') || 'unknown',
    chatId: `channel:${channelId}`,
    chatName: readString(event, 'guild_id') || channelId,
    content,
    timestamp: readTimestamp(event['timestamp']),
    raw,
  };
}
