import type { ChannelMessage } from '../types.js';
import {
  normalizeInboundRaw,
  parseJsonRecord,
  parseSimpleEnvelope,
  readRecord,
  readRecordArray,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

export interface FeishuInboundParseOptions {
  readonly botName?: string;
  readonly botOpenId?: string;
  readonly requireMentionInGroup?: boolean;
}

function isBotMentioned(
  mentions: readonly Record<string, unknown>[],
  options: FeishuInboundParseOptions,
): boolean {
  return mentions.some((mention) => {
    const id = readRecord(mention, 'id');
    return (
      readString(mention, 'key') === '@_all' ||
      (options.botOpenId ? readString(id, 'open_id') === options.botOpenId : false) ||
      (options.botName ? readString(mention, 'name') === options.botName : false)
    );
  });
}

function stripMentionPlaceholders(
  content: string,
  mentions: readonly Record<string, unknown>[],
): string {
  return mentions
    .reduce((nextContent, mention) => {
      const key = readString(mention, 'key');
      return key ? nextContent.replaceAll(key, '') : nextContent;
    }, content)
    .trim();
}

function readFeishuContent(message: Record<string, unknown>): string {
  const messageType = readString(message, 'message_type') || 'text';
  const contentPayload = parseJsonRecord(readString(message, 'content'));
  if (messageType === 'image') {
    const imageKey = readString(contentPayload, 'image_key');
    return imageKey ? `[User sent an image: ${imageKey}]` : '[User sent an image]';
  }
  if (messageType === 'audio') {
    const fileKey = readString(contentPayload, 'file_key');
    return fileKey ? `[User sent an audio message: ${fileKey}]` : '[User sent an audio message]';
  }
  return readString(contentPayload, 'text') || readString(message, 'content');
}

export function parseFeishuInboundMessage(
  raw: unknown,
  options: FeishuInboundParseOptions = {},
): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const header = readRecord(data, 'header');
  const event =
    header?.['event_type'] === 'im.message.receive_v1'
      ? readRecord(data, 'event')
      : readRecord(data, 'message') && readRecord(data, 'sender')
        ? data
        : null;
  if (!event) {
    return null;
  }
  const message = readRecord(event, 'message');
  if (!message) {
    return null;
  }
  const sender = readRecord(event, 'sender');
  const senderId = readRecord(sender, 'sender_id');
  const mentions = readRecordArray(message, 'mentions');
  if (
    options.requireMentionInGroup === true &&
    readString(message, 'chat_type') === 'group' &&
    !isBotMentioned(mentions, options)
  ) {
    return null;
  }
  const content = stripMentionPlaceholders(readFeishuContent(message), mentions);
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
