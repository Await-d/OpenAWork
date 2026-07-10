import { channelFetch } from './channel-http.js';
import { parseJsonObject, readNumber, readString } from './qq-api-utils.js';
import { sendQQImage } from './qq-media.js';
import type { QQChatTarget } from './qq-target.js';

const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const QQ_PROD_API_BASE = 'https://api.sgroup.qq.com';
const QQ_SANDBOX_API_BASE = 'https://sandbox.api.sgroup.qq.com';

interface QQApiOptions {
  readonly appId: string;
  readonly clientSecret: string;
  readonly useSandbox: boolean;
  readonly markdownSupport: boolean;
}

interface QQTokenCache {
  readonly token: string;
  readonly expiresAt: number;
}

interface QQSendMessageOptions {
  readonly isWakeup?: boolean;
}

export class QQApiClient {
  private readonly appId: string;
  private readonly clientSecret: string;
  private readonly apiBase: string;
  private readonly markdownSupport: boolean;
  private readonly seqBaseTime = Math.floor(Date.now() / 1000) % 100_000_000;
  private readonly msgSeqTracker = new Map<string, number>();
  private tokenCache: QQTokenCache | null = null;

  constructor(options: QQApiOptions) {
    this.appId = options.appId;
    this.clientSecret = options.clientSecret;
    this.apiBase = options.useSandbox ? QQ_SANDBOX_API_BASE : QQ_PROD_API_BASE;
    this.markdownSupport = options.markdownSupport;
  }

  async sendMessage(
    target: QQChatTarget,
    content: string,
    replyToMessageId?: string,
    options: QQSendMessageOptions = {},
  ): Promise<{ messageId: string }> {
    switch (target.type) {
      case 'c2c':
        return this.apiRequest(
          `/v2/users/${encodeURIComponent(target.id)}/messages`,
          this.buildDirectMessageBody(content, replyToMessageId, options),
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

  async sendImage(
    target: QQChatTarget,
    input: {
      readonly buffer: Buffer;
      readonly replyToMessageId?: string;
      readonly sourceUrl?: string;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }> {
    return sendQQImage(
      {
        apiBase: this.apiBase,
        getAccessToken: () => this.getAccessToken(),
        getNextMsgSeq: (messageId) => this.getNextMsgSeq(messageId),
        sendMessageBody: (path, body) => this.apiRequest(path, body),
      },
      target,
      input,
    );
  }

  async getGatewayAccessToken(): Promise<string> {
    return this.getAccessToken();
  }

  async validate(): Promise<void> {
    await this.getGatewayAccessToken();
    await this.getGatewayUrl();
  }

  clearTokenCache(): void {
    this.tokenCache = null;
  }

  async getGatewayUrl(): Promise<string> {
    const token = await this.getAccessToken();
    const response = await channelFetch(`${this.apiBase}/gateway`, {
      headers: {
        Authorization: `QQBot ${token}`,
      },
    });
    const rawText = await response.text();
    const data = parseJsonObject(rawText, 'gateway');
    const gatewayUrl = readString(data, 'url');
    if (!response.ok || !gatewayUrl) {
      throw new Error(
        `QQ gateway error ${response.status}: ${readString(data, 'message') || rawText}`,
      );
    }
    return gatewayUrl;
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
      throw new Error(
        `QQ auth failed (${response.status}): ${readString(data, 'message') || rawText.slice(0, 300)}`,
      );
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

  private buildDirectMessageBody(
    content: string,
    replyToMessageId?: string,
    options: QQSendMessageOptions = {},
  ): Record<string, unknown> {
    const trimmed = this.requireMessageContent(content);
    const body: Record<string, unknown> = this.markdownSupport
      ? { markdown: { content: trimmed }, msg_type: 2 }
      : { content: trimmed, msg_type: 0 };
    body['msg_seq'] = replyToMessageId ? this.getNextMsgSeq(replyToMessageId) : 1;
    if (replyToMessageId) {
      body['msg_id'] = replyToMessageId;
    }
    if (options.isWakeup === true) {
      body['is_wakeup'] = true;
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
      throw new Error(
        `QQ API error ${code || response.status}: ${readString(data, 'message') || rawText}`,
      );
    }
    return { messageId: readString(data, 'id') || `${Date.now()}` };
  }
}
