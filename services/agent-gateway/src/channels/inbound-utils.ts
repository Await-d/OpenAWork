import type {
  ChannelImageAttachment,
  ChannelMessage,
  ChannelParseContext,
  ChannelPlatform,
} from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const child = value[key];
  return isRecord(child) ? child : null;
}

export function readString(value: unknown, key: string): string {
  if (!isRecord(value)) {
    return '';
  }
  const child = value[key];
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'number' || typeof child === 'boolean') {
    return String(child);
  }
  return '';
}

export function readBoolean(value: unknown, key: string): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const child = value[key];
  if (typeof child === 'boolean') {
    return child;
  }
  if (typeof child === 'number') {
    return child !== 0;
  }
  if (typeof child === 'string') {
    return parseBooleanConfig(child);
  }
  return false;
}

export function readRecordArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }
  const child = value[key];
  if (!Array.isArray(child)) {
    return [];
  }
  return child.filter(isRecord);
}

export function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeInboundRaw(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }
  const parsed = parseJsonRecord(raw);
  return parsed ?? raw;
}

export function parseBooleanConfig(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function readTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function parseSimpleEnvelope(
  raw: unknown,
  context?: ChannelParseContext,
): ChannelMessage | null {
  const data = normalizeInboundRaw(raw);
  if (!isRecord(data)) {
    return null;
  }

  const chatId = readString(data, 'chatId');
  const images = readImageAttachments(data);
  const audio = readAudioAttachment(data);
  const rawContent = readString(data, 'content') || buildAttachmentFallback(images, audio);
  if (!chatId || !rawContent) {
    return null;
  }

  const isGroupMessage = isSimpleEnvelopeGroupMessage(data, context?.channel?.type, chatId);
  if (
    isGroupMessage &&
    shouldRequireSimpleEnvelopeMention(context) &&
    !isSimpleEnvelopeBotMentioned(data, rawContent, context)
  ) {
    return null;
  }

  const content =
    isGroupMessage && shouldRequireSimpleEnvelopeMention(context)
      ? stripLeadingMentions(rawContent)
      : rawContent;
  if (!content) {
    return null;
  }

  return {
    id: readString(data, 'messageId') || readString(data, 'id') || `${Date.now()}`,
    senderId: readString(data, 'senderId') || 'unknown',
    senderName: readString(data, 'senderName') || readString(data, 'senderId') || 'unknown',
    chatId,
    chatName: readString(data, 'chatName') || undefined,
    content,
    timestamp: readTimestamp(data['timestamp']),
    ...(images.length > 0 ? { images } : {}),
    ...(audio ? { audio } : {}),
    raw: data,
  };
}

export function stripLeadingMentions(content: string): string {
  return content
    .replace(/^(?:<@!?[^>]+>\s*)+/, '')
    .replace(/^(?:@\S+\s*)+/, '')
    .trim();
}

export function readFirstString(value: unknown, keys: readonly string[]): string {
  for (const key of keys) {
    const child = readString(value, key);
    if (child) {
      return child;
    }
  }
  return '';
}

function readImageAttachments(data: Record<string, unknown>): ChannelImageAttachment[] {
  const images = data['images'];
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .filter(isRecord)
    .map((image) => {
      const base64 = readString(image, 'base64');
      const imageUrl = readString(image, 'imageUrl') || readString(image, 'url');
      const mediaType = readString(image, 'mediaType') || readString(image, 'mimeType');
      const fileName = readString(image, 'fileName') || readString(image, 'name');
      if (!mediaType || (!base64 && !imageUrl)) {
        return null;
      }
      return {
        ...(base64 ? { base64 } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        mediaType,
        ...(fileName ? { fileName } : {}),
      };
    })
    .filter((image): image is ChannelImageAttachment => image !== null);
}

function readAudioAttachment(data: Record<string, unknown>): ChannelMessage['audio'] {
  const audio = readRecord(data, 'audio');
  if (!audio) {
    return undefined;
  }

  const fileKey = readString(audio, 'fileKey');
  if (!fileKey) {
    return undefined;
  }
  const durationValue = audio['durationMs'];
  const durationMs = typeof durationValue === 'number' ? durationValue : undefined;
  return {
    fileKey,
    ...(readString(audio, 'fileName') ? { fileName: readString(audio, 'fileName') } : {}),
    ...(readString(audio, 'mediaType') ? { mediaType: readString(audio, 'mediaType') } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function buildAttachmentFallback(
  images: readonly ChannelImageAttachment[],
  audio: ChannelMessage['audio'],
): string {
  if (images.length > 0) {
    return '[User sent an image]';
  }
  if (audio) {
    return '[User sent an audio message]';
  }
  return '';
}

function shouldRequireSimpleEnvelopeMention(context?: ChannelParseContext): boolean {
  return parseBooleanConfig(context?.channel?.config['requireMentionInGroup']);
}

function isSimpleEnvelopeGroupMessage(
  data: Record<string, unknown>,
  channelType: ChannelPlatform | undefined,
  chatId: string,
): boolean {
  const explicitType = readFirstString(data, [
    'chatType',
    'chat_type',
    'conversationType',
    'conversation_type',
    'channelType',
    'channel_type',
  ]).toLowerCase();
  if (
    explicitType === 'group' ||
    explicitType === 'supergroup' ||
    explicitType === 'channel' ||
    explicitType === 'guild' ||
    explicitType === 'room'
  ) {
    return true;
  }
  if (
    explicitType === 'p2p' ||
    explicitType === 'direct' ||
    explicitType === 'dm' ||
    explicitType === 'im' ||
    explicitType === 'private'
  ) {
    return false;
  }

  if (readBoolean(data, 'isGroup') || readBoolean(data, 'is_group')) {
    return true;
  }

  switch (channelType) {
    case 'telegram':
      return chatId.startsWith('-');
    case 'discord':
      return Boolean(readFirstString(data, ['guildId', 'guild_id', 'guild']));
    case 'slack':
      return /^(C|G)/i.test(chatId);
    case 'wecom': {
      const senderId = readString(data, 'senderId');
      return Boolean(senderId) && senderId !== chatId;
    }
    case 'whatsapp':
      return chatId.endsWith('@g.us');
    default:
      return false;
  }
}

function isSimpleEnvelopeBotMentioned(
  data: Record<string, unknown>,
  content: string,
  context?: ChannelParseContext,
): boolean {
  const channelType = context?.channel?.type;
  const botId = context?.botId?.trim() || context?.channel?.config['botUserId']?.trim() || '';
  const botName = context?.botName?.trim() || context?.channel?.config['botName']?.trim() || '';
  const botUsername =
    context?.botUsername?.trim().replace(/^@/, '') ||
    context?.channel?.config['botUsername']?.trim().replace(/^@/, '') ||
    '';
  if (!content) {
    return false;
  }

  const mentions = readRecordArray(data, 'mentions');
  if (botId) {
    const mentionedById = mentions.some(
      (mention) =>
        readFirstString(mention, ['id', 'userId', 'user_id', 'memberId', 'member_id']) === botId,
    );
    if (mentionedById) {
      return true;
    }
  }

  switch (channelType) {
    case 'telegram':
      return botUsername.length > 0 && isUsernameMentioned(content, botUsername);
    case 'discord':
      return botId.length > 0 && new RegExp(`<@!?${escapeRegExp(botId)}>`, 'i').test(content);
    case 'slack':
      return botId.length > 0 && new RegExp(`<@${escapeRegExp(botId)}>`, 'i').test(content);
    case 'wecom':
      if (readBoolean(data, 'IsMentioned') || readBoolean(data, 'isMentioned')) {
        return true;
      }
      if (botName.length === 0) {
        return false;
      }
      return (
        readMentionedNames(data).some((name) => name === botName) ||
        new RegExp(`(^|\\s)@${escapeRegExp(botName)}(?=\\s|$)`, 'i').test(content)
      );
    default:
      if (botId.length > 0 && new RegExp(`<@!?${escapeRegExp(botId)}>`, 'i').test(content)) {
        return true;
      }
      if (
        botName.length > 0 &&
        new RegExp(`(^|\\s)@${escapeRegExp(botName)}(?=\\s|$)`, 'i').test(content)
      ) {
        return true;
      }
      return botUsername.length > 0 && isUsernameMentioned(content, botUsername);
  }
}

function isUsernameMentioned(content: string, botUsername: string): boolean {
  return (
    new RegExp(`(^|\\s)@${escapeRegExp(botUsername)}(?=\\s|$)`, 'i').test(content) ||
    new RegExp(`^/[\\w-]+@${escapeRegExp(botUsername)}(?=\\s|$)`, 'i').test(content)
  );
}

function readMentionedNames(data: Record<string, unknown>): string[] {
  return [
    ...readStringArray(data, 'MentionedList'),
    ...readStringArray(data, 'mentioned_list'),
    ...readStringArray(data, 'AtUsers'),
    ...readStringArray(data, 'at_users'),
  ];
}

function readStringArray(value: unknown, key: string): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const child = value[key];
  if (!Array.isArray(child)) {
    return [];
  }
  return child.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
