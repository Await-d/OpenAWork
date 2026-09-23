import type { ChannelMessage, ChannelParseContext } from '../types.js';
import {
  isRecord,
  normalizeInboundRaw,
  parseBooleanConfig,
  parseSimpleEnvelope,
  readBoolean,
  readString,
  readTimestamp,
  stripLeadingMentions,
} from '../inbound-utils.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldRequireWeComMention(context?: ChannelParseContext): boolean {
  return parseBooleanConfig(context?.channel?.config['requireMentionInGroup']);
}

function resolveWeComBotName(context?: ChannelParseContext): string {
  return context?.botName?.trim() || context?.channel?.config['botName']?.trim() || '';
}

function isWeComGroupChat(data: Record<string, unknown>): boolean {
  return Boolean(readString(data, 'ChatId'));
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

function isWeComBotMentioned(
  data: Record<string, unknown>,
  content: string,
  botName: string,
): boolean {
  if (readBoolean(data, 'IsMentioned') || readBoolean(data, 'isMentioned')) {
    return true;
  }

  const mentionedNames = [
    ...readStringArray(data, 'MentionedList'),
    ...readStringArray(data, 'mentioned_list'),
    ...readStringArray(data, 'AtUsers'),
    ...readStringArray(data, 'at_users'),
  ];
  if (botName && mentionedNames.some((name) => name === botName)) {
    return true;
  }
  if (botName) {
    return new RegExp(`(^|\\s)@${escapeRegExp(botName)}(?=\\s|$)`, 'i').test(content);
  }
  return false;
}

export function parseWeComInboundMessage(
  raw: unknown,
  context?: ChannelParseContext,
): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw, context);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const msgType = readString(data, 'MsgType');
  if (!isRecord(data) || (msgType !== 'text' && msgType !== 'image')) {
    return null;
  }

  const chatId = readString(data, 'ChatId') || readString(data, 'FromUserName');
  const rawContent = readString(data, 'Content');
  // 图片消息通常没有 Content，图片地址在 PicUrl；纯文本路径保持原有语义。
  const picUrl = readString(data, 'PicUrl');
  if (!chatId || (!rawContent && !picUrl)) {
    return null;
  }

  if (
    shouldRequireWeComMention(context) &&
    isWeComGroupChat(data) &&
    !isWeComBotMentioned(data, rawContent, resolveWeComBotName(context))
  ) {
    return null;
  }

  const content = stripLeadingMentions(rawContent) || (picUrl ? '[User sent an image]' : '');
  if (!content) {
    return null;
  }

  return {
    id: readString(data, 'MsgId') || `${Date.now()}`,
    senderId: readString(data, 'FromUserName') || 'unknown',
    senderName: readString(data, 'FromUserName') || 'unknown',
    chatId,
    content,
    timestamp: readTimestamp(readString(data, 'CreateTime')),
    // 企业微信图片消息不提供 mime，v1 默认 image/jpeg（媒体验证依赖下游；
    // 若 PicUrl 不可访问会由下游降级）。
    ...(picUrl ? { images: [{ imageUrl: picUrl, mediaType: 'image/jpeg' }] } : {}),
    raw: data,
  };
}
