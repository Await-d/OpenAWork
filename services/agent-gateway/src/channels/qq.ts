import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';
import { channelFetch } from './channel-http.js';
import { parseQQChatId, type QQChatTarget } from './qq-target.js';
export { parseQQChatId } from './qq-target.js';

const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const QQ_PROD_API_BASE = 'https://api.sgroup.qq.com';
const QQ_SANDBOX_API_BASE = 'https://sandbox.api.sgroup.qq.com';

interface QQTokenCache {
  readonly token: string;
  readonly expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string {
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

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const child = value[key];
  if (typeof child === 'number' && Number.isFinite(child)) {
    return child;
  }
  if (typeof child === 'string') {
    const parsed = Number(child);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseBooleanConfig(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? '').trim());
}

function parseJsonObject(rawText: string, context: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    throw new Error(`Failed to parse QQ ${context} response: ${rawText.slice(0, 300)}`);
  }
  throw new Error(`Invalid QQ ${context} response: ${rawText.slice(0, 300)}`);
}

export class QQChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'qq';

  private readonly appId: string;
  private readonly clientSecret: string;
  private readonly webhookSecret: string;
  private readonly apiBase: string;
  private readonly markdownSupport: boolean;
  private readonly seqBaseTime = Math.floor(Date.now() / 1000) % 100_000_000;
  private readonly msgSeqTracker = new Map<string, number>();
  private running = false;
  private tokenCache: QQTokenCache | null = null;
  private readonly notify: (event: ChannelEvent) => void;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.appId = instance.config['appId'] ?? '';
    this.clientSecret = instance.config['clientSecret'] ?? '';
    this.webhookSecret = instance.config['webhookSecret'] ?? '';
    this.apiBase = parseBooleanConfig(instance.config['useSandbox'])
      ? QQ_SANDBOX_API_BASE
      : QQ_PROD_API_BASE;
    this.markdownSupport = parseBooleanConfig(instance.config['markdownSupport']);
    this.notify = notify;
  }

  /**
   * Dispatch a channel event without letting a throwing subscriber bubble back
   * into the webhook handler. Mirrors the Telegram channel's `safeNotify`
   * invariant: a fault in the router/auto-reply hook must not propagate into
   * the QQ webhook delivery path.
   */
  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (err) {
      console.warn(
        `[qq] channel notify handler threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async start(): Promise<void> {
    if (!this.appId || !this.clientSecret) {
      throw new Error('QQ channel requires appId and clientSecret');
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    const response = await channelFetch(QQ_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    });
    const rawText = await response.text();
    const data = parseJsonObject(rawText, 'auth');
    const token = readString(data, 'access_token');
    if (!response.ok) {
      throw new Error(`QQ auth failed (${response.status}): ${readString(data, 'message') || rawText.slice(0, 300)}`);
    }
    if (!token) {
      throw new Error(`QQ token error: ${readString(data, 'message') || readString(data, 'code')}`);
    }

    this.tokenCache = {
      token,
      expiresAt: Date.now() + (readNumber(data, 'expires_in') ?? 7200) * 1000,
    };
    return token;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    return this.sendQQMessage(parseQQChatId(chatId), content);
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const [chatId, replyToMessageId] = messageId.split('|');
    if (!chatId || !replyToMessageId) {
      throw new Error('QQ reply requires "<chatId>|<messageId>" reference');
    }
    return this.sendQQMessage(parseQQChatId(chatId), content, replyToMessageId);
  }

  private async sendQQMessage(
    target: QQChatTarget,
    content: string,
    replyToMessageId?: string,
  ): Promise<{ messageId: string }> {
    switch (target.type) {
      case 'c2c':
        return this.apiRequest(
          `/v2/users/${encodeURIComponent(target.id)}/messages`,
          this.buildDirectMessageBody(content, replyToMessageId),
        );
      case 'group':
        return this.apiRequest(
          `/v2/groups/${encodeURIComponent(target.id)}/messages`,
          this.buildGroupMessageBody(content, replyToMessageId),
        );
      case 'channel':
        return this.apiRequest(
          `/channels/${encodeURIComponent(target.id)}/messages`,
          this.buildChannelMessageBody(content, replyToMessageId),
        );
    }
  }

  private buildDirectMessageBody(
    content: string,
    replyToMessageId?: string,
  ): Record<string, unknown> {
    const trimmed = this.requireMessageContent(content);
    const body: Record<string, unknown> = this.markdownSupport
      ? { markdown: { content: trimmed }, msg_type: 2 }
      : { content: trimmed, msg_type: 0 };
    body['msg_seq'] = replyToMessageId ? this.getNextMsgSeq(replyToMessageId) : 1;
    if (replyToMessageId) {
      body['msg_id'] = replyToMessageId;
    }
    return body;
  }

  private buildGroupMessageBody(
    content: string,
    replyToMessageId?: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      content: this.requireMessageContent(content),
      msg_type: 0,
      msg_seq: replyToMessageId ? this.getNextMsgSeq(replyToMessageId) : 1,
    };
    if (replyToMessageId) {
      body['msg_id'] = replyToMessageId;
    }
    return body;
  }

  private buildChannelMessageBody(
    content: string,
    replyToMessageId?: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      content: this.requireMessageContent(content),
    };
    if (replyToMessageId) {
      body['msg_id'] = replyToMessageId;
    }
    return body;
  }

  private requireMessageContent(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('QQ message content cannot be empty');
    }
    return trimmed;
  }

  private getNextMsgSeq(messageId: string): number {
    const next = (this.msgSeqTracker.get(messageId) ?? 0) + 1;
    this.msgSeqTracker.set(messageId, next);

    if (this.msgSeqTracker.size > 1000) {
      for (const key of Array.from(this.msgSeqTracker.keys()).slice(0, 500)) {
        this.msgSeqTracker.delete(key);
      }
    }

    return this.seqBaseTime + next;
  }

  private async apiRequest(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ messageId: string }> {
    const token = await this.getAccessToken();
    const response = await channelFetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `QQBot ${token}`,
      },
      body: JSON.stringify(body),
    });
    const rawText = await response.text();
    const data = parseJsonObject(rawText, 'message');
    const code = readString(data, 'code');
    if (!response.ok || code) {
      throw new Error(`QQ API error ${code || response.status}: ${readString(data, 'message') || rawText}`);
    }
    return { messageId: readString(data, 'id') || `${Date.now()}` };
  }

  handleWebhookEvent(body: unknown, signature?: string): void {
    void signature;
    const payload = body as {
      t?: string;
      d?: {
        id?: string;
        channel_id?: string;
        author?: { id: string; username: string };
        content?: string;
        timestamp?: string;
      };
    };

    if (payload.t !== 'AT_MESSAGE_CREATE' && payload.t !== 'MESSAGE_CREATE') return;
    const msg = payload.d;
    if (!msg?.content || !msg.channel_id) return;

    const channelMessage: ChannelMessage = {
      id: msg.id ?? `${Date.now()}`,
      senderId: msg.author?.id ?? 'unknown',
      senderName: msg.author?.username ?? 'Unknown',
      chatId: msg.channel_id,
      content: msg.content.replace(/<@!?\d+>\s*/g, '').trim(),
      timestamp: msg.timestamp ? Date.parse(msg.timestamp) : Date.now(),
      raw: payload,
    };
    this.safeNotify({ type: 'message', pluginId: this.pluginId, message: channelMessage });
  }

  async getGroupMessages(_chatId: string, _count?: number): Promise<ChannelMessage[]> {
    return [];
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return [];
  }
}

export const qqFactory: ChannelServiceFactory = (instance, notify) =>
  new QQChannelService(instance, notify);
