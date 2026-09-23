import type { ChannelImageAttachment, ChannelMessage, ChannelParseContext } from '../types.js';
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

const DISCORD_MAX_IMAGE_ATTACHMENTS = 4;

const DISCORD_IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readFileExtension(fileName: string): string {
  const matched = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return matched?.[1]?.toLowerCase() ?? '';
}

function resolveDiscordImageMediaType(attachment: Record<string, unknown>): string {
  const contentType = readString(attachment, 'content_type').trim();
  if (contentType.toLowerCase().startsWith('image/')) {
    return contentType;
  }
  const extension = readFileExtension(readString(attachment, 'filename'));
  return DISCORD_IMAGE_MEDIA_TYPES[extension] ?? '';
}

function toDiscordImageAttachment(
  attachment: Record<string, unknown>,
): ChannelImageAttachment | null {
  const mediaType = resolveDiscordImageMediaType(attachment);
  if (!mediaType) {
    return null;
  }
  const imageUrl = readString(attachment, 'url') || readString(attachment, 'proxy_url');
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

function readDiscordImageAttachments(
  message: Record<string, unknown>,
  maxCount: number,
): ChannelImageAttachment[] {
  return readRecordArray(message, 'attachments')
    .map((attachment) => toDiscordImageAttachment(attachment))
    .filter((image): image is ChannelImageAttachment => image !== null)
    .slice(0, maxCount);
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
  // Discord CDN 附件 URL 自带签名有效期约 24h；这里直接映射 URL 而不下载图片，
  // 避免 base64 入库导致消息体积膨胀。
  const images = readDiscordImageAttachments(message, DISCORD_MAX_IMAGE_ATTACHMENTS);
  if (!chatId || (!rawContent && images.length === 0)) {
    return null;
  }

  if (
    shouldRequireDiscordMention(context) &&
    isDiscordGuildMessage(message) &&
    !isDiscordBotMentioned(message, rawContent, resolveDiscordBotUserId(context))
  ) {
    return null;
  }

  const content =
    stripLeadingMentions(rawContent) || (images.length > 0 ? '[User sent an image]' : '');
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
    ...(images.length > 0 ? { images } : {}),
    raw: data,
  };
}
