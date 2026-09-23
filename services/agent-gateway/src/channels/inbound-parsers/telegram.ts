import type { ChannelMessage, ChannelParseContext } from '../types.js';
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

export interface TelegramImageCandidate {
  readonly fileId: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly fileSize?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从 photo 尺寸数组中取最大的一张：`file_size` 数值最大者；若都没有
 * `file_size`，则按 Telegram 的升序约定取数组最后一项（最后即最大）。
 */
function pickLargestTelegramPhoto(
  photos: readonly Record<string, unknown>[],
): Record<string, unknown> | null {
  let largest: Record<string, unknown> | null = null;
  let largestSize = Number.NEGATIVE_INFINITY;
  for (const photo of photos) {
    const size = photo['file_size'];
    if (typeof size !== 'number') {
      continue;
    }
    if (size > largestSize) {
      largest = photo;
      largestSize = size;
    }
  }
  if (largest) {
    return largest;
  }
  return photos[photos.length - 1] ?? null;
}

/**
 * 从 Telegram update（或裸 message）中解析可下载的图片候选：photo 取最大尺寸 /
 * image document。
 */
export function resolveTelegramImageCandidate(raw: unknown): TelegramImageCandidate | null {
  const data = normalizeInboundRaw(raw);
  const message = readRecord(data, 'message') ?? (isRecord(data) ? data : null);
  if (!message) {
    return null;
  }

  const photos = readRecordArray(message, 'photo');
  if (photos.length > 0) {
    const largest = pickLargestTelegramPhoto(photos);
    if (!largest) {
      return null;
    }
    const fileId = readString(largest, 'file_id');
    if (!fileId) {
      return null;
    }
    // 透出 file_size：下载层据此做「零网络超限短路」，避免为必被丢弃的
    // 大图多发一次 getFile 请求。
    const fileSize = largest['file_size'];
    return {
      fileId,
      ...(typeof fileSize === 'number' ? { fileSize } : {}),
    };
  }

  const document = readRecord(message, 'document');
  if (!document) {
    return null;
  }
  const mimeType = readString(document, 'mime_type');
  if (!mimeType.toLowerCase().startsWith('image/')) {
    return null;
  }
  const fileId = readString(document, 'file_id');
  if (!fileId) {
    return null;
  }
  const fileName = readString(document, 'file_name');
  const fileSize = document['file_size'];
  return {
    fileId,
    ...(fileName ? { fileName } : {}),
    mimeType,
    ...(typeof fileSize === 'number' ? { fileSize } : {}),
  };
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
  // Telegram 的 photo/document 消息文本可能为空，此处只产出占位符与候选描述符，
  // 真正的下载（getFile → 取回文件 → base64）在服务层做。
  const imageCandidate = resolveTelegramImageCandidate(data);
  if (!chat || (!rawContent && !imageCandidate)) {
    return null;
  }

  if (
    isTelegramGroupChat(chat) &&
    shouldRequireTelegramMention(context) &&
    !isTelegramBotMentioned(rawContent, resolveTelegramBotUsername(context))
  ) {
    return null;
  }

  const content =
    normalizeTelegramContent(rawContent, resolveTelegramBotUsername(context)) ||
    (imageCandidate ? '[User sent an image]' : '');
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
