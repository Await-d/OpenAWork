import type { ChannelMessage, ChannelParseContext } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseBooleanConfig,
  parseSimpleEnvelope,
  readRecordArray,
  readString,
  readTimestamp,
  stripLeadingMentions,
} from '../inbound-utils.js';

/** Slack `filetype` 白名单：`mimetype` 缺失时据此判定图片（映射表在 `slack-media.ts`）。 */
const SLACK_IMAGE_FILETYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

function resolveSlackBotUserId(context?: ChannelParseContext): string {
  return context?.botId?.trim() || context?.channel?.config['botUserId']?.trim() || '';
}

function shouldRequireSlackMention(context?: ChannelParseContext): boolean {
  return parseBooleanConfig(context?.channel?.config['requireMentionInGroup']);
}

function isSlackGroupConversation(message: Record<string, unknown>): boolean {
  const channelType = readString(message, 'channel_type');
  if (channelType) {
    return channelType !== 'im';
  }
  const channelId = readString(message, 'channel');
  return channelId.length > 0 && !channelId.startsWith('D');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSlackBotMentioned(content: string, botUserId: string): boolean {
  return botUserId.length > 0 && new RegExp(`<@${escapeRegExp(botUserId)}>`, 'i').test(content);
}

/** 图片文件判定：`mimetype` 以 `image/` 开头（大小写不敏感）或 `filetype` 命中白名单。 */
function isSlackImageFile(file: Record<string, unknown>): boolean {
  if (readString(file, 'mimetype').trim().toLowerCase().startsWith('image/')) {
    return true;
  }
  return SLACK_IMAGE_FILETYPES.has(readString(file, 'filetype').trim().toLowerCase());
}

function hasSlackImageFiles(message: Record<string, unknown>): boolean {
  return readRecordArray(message, 'files').some(isSlackImageFile);
}

export function parseSlackInboundMessage(
  raw: unknown,
  context?: ChannelParseContext,
): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw, context);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const message =
    isRecord(data) && isRecord(data['message']) ? data['message'] : isRecord(data) ? data : null;
  if (!message) {
    return null;
  }

  if (readString(message, 'subtype') === 'bot_message' || readString(message, 'bot_id')) {
    return null;
  }

  const chatId = readString(message, 'channel');
  const rawContent = readString(message, 'text');
  // 纯文件消息（text 为空但带图片文件）不得丢弃：下游按占位符文本投递，
  // 图片由 service 层 `attachSlackInboundImages` 下载补全。
  const hasImageFile = hasSlackImageFiles(message);
  if (!chatId || (!rawContent && !hasImageFile)) {
    return null;
  }

  if (
    shouldRequireSlackMention(context) &&
    isSlackGroupConversation(message) &&
    !isSlackBotMentioned(rawContent, resolveSlackBotUserId(context))
  ) {
    return null;
  }

  const content = stripLeadingMentions(rawContent) || (hasImageFile ? '[User sent an image]' : '');
  if (!content) {
    return null;
  }

  return {
    id: readString(message, 'client_msg_id') || readString(message, 'ts') || `${Date.now()}`,
    senderId: readString(message, 'user') || 'unknown',
    senderName: readString(message, 'username') || readString(message, 'user') || 'unknown',
    chatId,
    chatName: readString(message, 'channel_name') || undefined,
    content,
    timestamp: readTimestamp(readString(message, 'ts') || readString(message, 'event_ts')),
    raw: data,
  };
}
