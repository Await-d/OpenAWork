import type {
  ChannelEvent,
  ChannelGroup,
  ChannelInstance,
  ChannelMessage,
  ChannelServiceFactory,
  MessagingChannelService,
} from './types.js';
import { computeChannelRetryDelayMs } from './channel-http.js';
import { listRecentChannelGroups, listRecentChannelMessages } from './channel-message-cache.js';
import { isRecord, readString, readTimestamp } from './inbound-utils.js';
import { parseWeixinInboundMessage } from './inbound-parsers/weixin.js';
import {
  createWeixinApi,
  DEFAULT_WEIXIN_BASE_URL,
  type WeixinApiClient,
  type WeixinApiOptions,
  type WeixinSendFileParams,
  type WeixinSendImageParams,
} from './weixin-api.js';

export type { WeixinApiClient } from './weixin-api.js';

type WeixinApiFactory = (options: WeixinApiOptions) => WeixinApiClient;

const DEFAULT_POLL_DELAY_MS = 35_000;
const STARTUP_CHECK_TIMEOUT_MS = 5_000;
const STALE_MESSAGE_WINDOW_MS = 15 * 60 * 1000;
const MAX_CONTEXT_CACHE_SIZE = 500;

export class WeixinChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'weixin-official';

  private readonly token: string;
  private readonly accountId: string;
  private readonly baseUrl: string;
  private readonly routeTag: string | undefined;
  private readonly notify: (event: ChannelEvent) => void;
  private readonly apiFactory: WeixinApiFactory;
  private readonly contextTokens = new Map<string, string>();
  private readonly messageReplyMeta = new Map<string, { userId: string; contextToken: string }>();
  private api: WeixinApiClient | null = null;
  private running = false;
  private syncBuf = '';
  private pollDelayMs = DEFAULT_POLL_DELAY_MS;
  private pollAbortController: AbortController | null = null;
  private pollPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryResolve: (() => void) | null = null;

  constructor(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void,
    apiFactory: WeixinApiFactory = createWeixinApi,
  ) {
    this.pluginId = instance.id;
    this.token = instance.config['token'] ?? '';
    this.accountId = instance.config['accountId'] ?? '';
    this.baseUrl = instance.config['baseUrl'] || DEFAULT_WEIXIN_BASE_URL;
    this.routeTag = instance.config['routeTag']?.trim() || undefined;
    this.notify = notify;
    this.apiFactory = apiFactory;
  }

  async start(): Promise<void> {
    if (!this.token || !this.accountId) {
      throw new Error('Weixin channel requires token and accountId');
    }
    if (this.running) {
      return;
    }
    this.api = this.apiFactory({
      baseUrl: this.baseUrl,
      token: this.token,
      ...(this.routeTag ? { routeTag: this.routeTag } : {}),
    });
    try {
      await this.verifyStartup();
    } catch (error) {
      this.api = null;
      this.running = false;
      throw error;
    }
    this.running = true;
    this.pollPromise = this.runPollingLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pollAbortController?.abort();
    this.resolveRetryDelay();
    if (this.pollPromise) {
      await this.pollPromise;
    }
    this.pollPromise = null;
    this.pollAbortController = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    return this.requireApi().sendMessage({
      toUserId: chatId,
      text: content,
      contextToken: this.getContextTokenForChat(chatId),
    });
  }

  async sendImage(
    chatId: string,
    input: Omit<WeixinSendImageParams, 'toUserId' | 'contextToken'>,
  ): Promise<{ messageId: string }> {
    return this.requireApi().sendImage({
      ...input,
      toUserId: chatId,
      contextToken: this.getContextTokenForChat(chatId),
    });
  }

  async sendFile(
    chatId: string,
    input: Omit<WeixinSendFileParams, 'toUserId' | 'contextToken'>,
  ): Promise<{ messageId: string }> {
    return this.requireApi().sendFile({
      ...input,
      toUserId: chatId,
      contextToken: this.getContextTokenForChat(chatId),
    });
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const meta = this.messageReplyMeta.get(messageId);
    if (!meta) {
      throw new Error('Weixin reply context not found for messageId');
    }
    return this.requireApi().sendMessage({
      toUserId: meta.userId,
      text: content,
      contextToken: meta.contextToken,
    });
  }

  async getGroupMessages(_chatId: string, _count?: number): Promise<ChannelMessage[]> {
    return listRecentChannelMessages(this.pluginId, _chatId, _count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return listRecentChannelGroups(this.pluginId);
  }

  private requireApi(): WeixinApiClient {
    if (!this.api) {
      throw new Error('Weixin channel is not started');
    }
    return this.api;
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (err) {
      console.warn(
        `[weixin] channel notify handler threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async verifyStartup(): Promise<void> {
    const response = await this.requireApi().getUpdates('', STARTUP_CHECK_TIMEOUT_MS);
    const errorCode = response.errcode ?? response.ret ?? 0;
    if (errorCode !== 0) {
      throw new Error(
        `Weixin startup check failed: ${response.errmsg || `getupdates returned ${errorCode}`}`,
      );
    }
    if (response.get_updates_buf) {
      this.syncBuf = response.get_updates_buf;
    }
    if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
      this.pollDelayMs = response.longpolling_timeout_ms;
    }
    for (const message of response.msgs ?? []) {
      this.handleIncomingMessage(message);
    }
  }

  private getContextTokenForChat(chatId: string): string {
    const contextToken = this.contextTokens.get(`${this.accountId}:${chatId}`);
    if (!contextToken) {
      throw new Error(
        'Missing context token for this Weixin chat. Send can only reply to existing conversations.',
      );
    }
    return contextToken;
  }

  private rememberContext(messageId: string, userId: string, contextToken: string): void {
    if (!contextToken) {
      return;
    }
    this.contextTokens.set(`${this.accountId}:${userId}`, contextToken);
    this.messageReplyMeta.set(messageId, { userId, contextToken });
    trimCache(this.contextTokens);
    trimCache(this.messageReplyMeta);
  }

  private handleIncomingMessage(rawMessage: unknown): void {
    if (!isRecord(rawMessage) || readString(rawMessage, 'message_type') !== '1') {
      return;
    }
    const userId = readString(rawMessage, 'from_user_id');
    const timestamp = readTimestamp(rawMessage['create_time_ms']);
    if (!userId || timestamp < Date.now() - STALE_MESSAGE_WINDOW_MS) {
      return;
    }
    const message = parseWeixinInboundMessage(rawMessage);
    if (!message) {
      return;
    }
    this.rememberContext(message.id, userId, readString(rawMessage, 'context_token'));
    this.safeNotify({ type: 'message', pluginId: this.pluginId, message });
  }

  private async runPollingLoop(): Promise<void> {
    let failureStreak = 0;
    while (this.running) {
      const controller = new AbortController();
      this.pollAbortController = controller;
      try {
        const response = await this.requireApi().getUpdates(
          this.syncBuf,
          this.pollDelayMs + 5_000,
          controller.signal,
        );
        if (response.get_updates_buf) {
          this.syncBuf = response.get_updates_buf;
        }
        if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
          this.pollDelayMs = response.longpolling_timeout_ms;
        }
        const errorCode = response.errcode ?? response.ret ?? 0;
        if (errorCode !== 0) {
          throw new Error(response.errmsg || `Weixin getupdates failed: ${errorCode}`);
        }
        failureStreak = 0;
        for (const message of response.msgs ?? []) {
          this.handleIncomingMessage(message);
        }
      } catch (err) {
        if (!this.running) {
          break;
        }
        failureStreak += 1;
        this.safeNotify({
          type: 'error',
          pluginId: this.pluginId,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.waitBeforeRetry(computeChannelRetryDelayMs(failureStreak));
      } finally {
        if (this.pollAbortController === controller) {
          this.pollAbortController = null;
        }
      }
    }
  }

  private async waitBeforeRetry(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.retryResolve = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.retryResolve = null;
        resolve();
      }, ms);
    });
  }

  private resolveRetryDelay(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryResolve?.();
    this.retryResolve = null;
  }
}

function trimCache<T>(cache: Map<string, T>): void {
  if (cache.size <= MAX_CONTEXT_CACHE_SIZE) {
    return;
  }
  const oldest = cache.keys().next().value;
  if (oldest) {
    cache.delete(oldest);
  }
}

export const weixinFactory: ChannelServiceFactory = (instance, notify) =>
  new WeixinChannelService(instance, notify);
