import type { ChannelImageAttachment, ChannelMessage } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readRecord,
  readRecordArray,
  readString,
  readTimestamp,
  stripLeadingMentions,
} from '../inbound-utils.js';

const QQ_MAX_IMAGE_ATTACHMENTS = 4;

export function parseQQInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return {
      ...envelope,
      id: buildQQReplyReference(envelope.chatId, envelope.id),
    };
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

  if (
    eventType !== 'AT_MESSAGE_CREATE' &&
    eventType !== 'MESSAGE_CREATE' &&
    eventType !== 'DIRECT_MESSAGE_CREATE'
  ) {
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
  const content = readQQMessageContent(event);
  if (!senderId || !content) {
    return null;
  }
  const images = readQQImageAttachments(event, QQ_MAX_IMAGE_ATTACHMENTS);
  return {
    id: buildQQReplyReference(`c2c:${senderId}`, readString(event, 'id')),
    senderId,
    senderName: senderId,
    chatId: `c2c:${senderId}`,
    chatName: senderId,
    content,
    timestamp: readTimestamp(event['timestamp']),
    ...(images.length > 0 ? { images } : {}),
    raw,
  };
}

function parseQQGroupMessage(
  raw: Record<string, unknown>,
  event: Record<string, unknown>,
): ChannelMessage | null {
  const author = readRecord(event, 'author');
  const groupOpenId = readString(event, 'group_openid') || readString(event, 'group_id');
  const content = readQQMessageContent(event);
  if (!groupOpenId || !content) {
    return null;
  }
  const chatId = `group:${groupOpenId}`;
  const images = readQQImageAttachments(event, QQ_MAX_IMAGE_ATTACHMENTS);
  return {
    id: buildQQReplyReference(chatId, readString(event, 'id')),
    senderId: readString(author, 'member_openid') || readString(author, 'id') || 'unknown',
    senderName: readString(author, 'username') || readString(author, 'id') || 'unknown',
    chatId,
    chatName: groupOpenId,
    content,
    timestamp: readTimestamp(event['timestamp']),
    ...(images.length > 0 ? { images } : {}),
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
  const content = readQQMessageContent(event);
  if (!channelId || !content) {
    return null;
  }
  const chatId = `channel:${channelId}`;
  const images = readQQImageAttachments(event, QQ_MAX_IMAGE_ATTACHMENTS);

  return {
    id: buildQQReplyReference(chatId, readString(event, 'id')),
    senderId: readString(author, 'id') || 'unknown',
    senderName: readString(author, 'username') || readString(author, 'id') || 'unknown',
    chatId,
    chatName: readString(event, 'guild_id') || channelId,
    content,
    timestamp: readTimestamp(event['timestamp']),
    ...(images.length > 0 ? { images } : {}),
    raw,
  };
}

function buildQQReplyReference(chatId: string, messageId: string): string {
  const rawMessageId = messageId || `${Date.now()}`;
  if (rawMessageId.startsWith(`${chatId}|`)) {
    return rawMessageId;
  }
  return `${chatId}|${rawMessageId}`;
}

function readQQMessageContent(event: Record<string, unknown>): string {
  const text = stripLeadingMentions(readString(event, 'content'));
  if (text) {
    return text;
  }
  return describeQQAttachments(event);
}

function describeQQAttachments(event: Record<string, unknown>): string {
  const firstAttachment = readRecordArray(event, 'attachments')[0];
  if (!firstAttachment) {
    return '';
  }

  const contentType = readString(firstAttachment, 'content_type');
  if (contentType.startsWith('image/')) {
    return '[User sent an image]';
  }
  if (contentType.startsWith('audio/')) {
    return '[User sent an audio message]';
  }
  if (contentType.startsWith('video/')) {
    return '[User sent a video]';
  }
  return '[User sent an attachment]';
}

function toQQImageAttachment(attachment: Record<string, unknown>): ChannelImageAttachment | null {
  const mediaType = readString(attachment, 'content_type').trim();
  if (!mediaType.toLowerCase().startsWith('image/')) {
    return null;
  }
  const imageUrl = readString(attachment, 'url');
  if (!imageUrl) {
    return null;
  }
  const fileName = readString(attachment, 'filename');
  return {
    imageUrl,
    mediaType,
    ...(fileName ? { fileName } : {}),
  };
}

// QQ CDN 附件 URL 直映射为 imageUrl（与 Discord 同款取舍：不下载、不转 base64，避免消息体积膨胀）。
function readQQImageAttachments(
  event: Record<string, unknown>,
  maxCount: number,
): ChannelImageAttachment[] {
  return readRecordArray(event, 'attachments')
    .map((attachment) => toQQImageAttachment(attachment))
    .filter((image): image is ChannelImageAttachment => image !== null)
    .slice(0, maxCount);
}
