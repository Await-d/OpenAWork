import type { DingTalkChatMeta } from './dingtalk-card-streaming.js';

interface DingTalkSessionWebhook {
  readonly url: string;
  readonly expiredTime: number;
}

const MAX_MESSAGE_CHAT_CACHE = 1000;
const MAX_CHAT_META_CACHE = 1000;

export class DingTalkReplyContext {
  private readonly sessionWebhooks = new Map<string, DingTalkSessionWebhook>();
  private readonly messageChatCache = new Map<string, string>();
  private readonly chatMetaCache = new Map<string, DingTalkChatMeta>();

  rememberStreamEvent(raw: unknown, chatId: string, messageId: string): void {
    this.rememberMessageChat(messageId, chatId);
    const payload = readDingTalkStreamPayload(raw);
    if (!payload) {
      return;
    }

    this.rememberChatMeta(chatId, payload);

    const webhookUrl = readString(payload, 'sessionWebhook');
    const expiredTime = readTimestampMs(payload['sessionWebhookExpiredTime']);
    if (!webhookUrl || !expiredTime) {
      return;
    }

    this.sessionWebhooks.set(chatId, { url: webhookUrl, expiredTime });
  }

  resolveChatId(messageId: string): string | null {
    return this.messageChatCache.get(messageId) ?? null;
  }

  getSessionWebhook(chatId: string, now = Date.now()): string | null {
    const webhook = this.sessionWebhooks.get(chatId);
    if (!webhook || webhook.expiredTime <= now) {
      return null;
    }
    return webhook.url;
  }

  resolveChatMeta(chatId: string): DingTalkChatMeta | null {
    return this.chatMetaCache.get(chatId) ?? null;
  }

  private rememberMessageChat(messageId: string, chatId: string): void {
    if (!messageId || !chatId) {
      return;
    }
    this.messageChatCache.set(messageId, chatId);
    if (this.messageChatCache.size <= MAX_MESSAGE_CHAT_CACHE) {
      return;
    }

    const oldest = this.messageChatCache.keys().next().value;
    if (oldest) {
      this.messageChatCache.delete(oldest);
    }
  }

  private rememberChatMeta(chatId: string, payload: Record<string, unknown>): void {
    if (!chatId) {
      return;
    }
    const conversationType = readString(payload, 'conversationType') === '1' ? 'p2p' : 'group';
    const senderId = readString(payload, 'senderStaffId') || readString(payload, 'senderId');
    this.chatMetaCache.set(chatId, { conversationType, senderId });
    if (this.chatMetaCache.size <= MAX_CHAT_META_CACHE) {
      return;
    }

    const oldest = this.chatMetaCache.keys().next().value;
    if (oldest) {
      this.chatMetaCache.delete(oldest);
    }
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return normalizeRecord(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function readDingTalkStreamPayload(raw: unknown): Record<string, unknown> | null {
  const data = normalizeRecord(raw);
  if (!data) {
    return null;
  }

  const payload = data['data'];
  if (typeof payload === 'string') {
    return parseJsonRecord(payload);
  }
  return normalizeRecord(payload);
}

function readString(value: unknown, key: string): string {
  const record = normalizeRecord(value);
  const child = record?.[key];
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'number' || typeof child === 'boolean') {
    return String(child);
  }
  return '';
}

function readTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
}
