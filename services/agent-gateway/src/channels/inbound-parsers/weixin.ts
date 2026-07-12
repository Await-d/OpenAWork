import type { ChannelMessage } from '../types.js';
import {
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readFirstString,
  readRecord,
  readRecordArray,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

const USER_MESSAGE_TYPE = '1';
const TEXT_ITEM = '1';
const IMAGE_ITEM = '2';
const VOICE_ITEM = '3';
const FILE_ITEM = '4';
const VIDEO_ITEM = '5';

function readWeixinContent(items: readonly Record<string, unknown>[]): string {
  for (const item of items) {
    const itemType = readString(item, 'type');
    if (itemType === TEXT_ITEM) {
      const textItem = readRecord(item, 'text_item');
      const text = readString(textItem, 'text');
      if (text) {
        return text;
      }
    }
    if (itemType === VOICE_ITEM) {
      const voiceItem = readRecord(item, 'voice_item');
      const text = readString(voiceItem, 'text');
      if (text) {
        return text;
      }
    }
    if (itemType === IMAGE_ITEM) {
      return '[User sent an image]';
    }
    if (itemType === FILE_ITEM) {
      const fileItem = readRecord(item, 'file_item');
      const fileName = readString(fileItem, 'file_name');
      return fileName ? `[File: ${fileName}]` : '[File]';
    }
    if (itemType === VIDEO_ITEM) {
      return '[Video]';
    }
  }

  return '';
}

function resolveWeixinChatId(data: unknown): string {
  return readFirstString(data, [
    'chat_id',
    'conversation_id',
    'conversationId',
    'room_id',
    'roomid',
    'group_id',
    'groupId',
    'group_openid',
    'group_open_id',
    'from_user_id',
  ]);
}

function resolveWeixinSenderId(data: unknown): string {
  return readFirstString(data, [
    'sender_user_id',
    'sender_id',
    'senderId',
    'from_user_id',
    'user_id',
  ]);
}

function resolveWeixinChatName(data: unknown): string | undefined {
  const chatName = readFirstString(data, [
    'chat_name',
    'conversation_title',
    'conversationTitle',
    'room_name',
    'group_name',
    'title',
  ]);
  return chatName || undefined;
}

function resolveWeixinSenderName(data: unknown, senderId: string, chatId: string): string {
  return (
    readFirstString(data, ['sender_name', 'senderName', 'nickname', 'from_user_name']) ||
    senderId ||
    chatId
  );
}

export function parseWeixinInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  if (readString(data, 'message_type') !== USER_MESSAGE_TYPE) {
    return null;
  }

  const chatId = resolveWeixinChatId(data);
  const content = readWeixinContent(readRecordArray(data, 'item_list'));
  if (!chatId || !content) {
    return null;
  }

  const senderId = resolveWeixinSenderId(data) || chatId;
  const senderName = resolveWeixinSenderName(data, senderId, chatId);

  return {
    id: readString(data, 'message_id') || readString(data, 'client_id') || `${Date.now()}`,
    senderId,
    senderName,
    chatId,
    chatName: resolveWeixinChatName(data) || chatId,
    content,
    timestamp: readTimestamp(
      readRecord(data, 'meta')?.['timestamp'] ?? readString(data, 'create_time_ms'),
    ),
    raw: data,
  };
}
