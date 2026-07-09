import type {
  MessagingChannelService,
  ChannelMessage,
  ChannelGroup,
  ChannelInstance,
  ChannelEvent,
  ChannelStreamingHandle,
} from './types.js';
import { channelFetch } from './channel-http.js';
import { listRecentChannelMessages } from './channel-message-cache.js';
import { parseDingTalkInboundMessage } from './inbound-parsers/dingtalk.js';
import { DingTalkReplyContext } from './dingtalk-reply-context.js';
import { DingTalkCardStreamingClient } from './dingtalk-card-streaming.js';
import {
  createOfficialDingTalkGateway,
  type DingTalkGateway,
  type DingTalkGatewayFactory,
} from './dingtalk-gateway.js';
import {
  DINGTALK_API,
  DINGTALK_NEW_API,
  normalizeDingTalkConfig,
  signWebhook,
  type DingTalkConfig,
  type DingTalkSendResponse,
  type DingTalkTokenResponse,
  type DingTalkWebhookResponse,
} from './dingtalk-api-types.js';

export class DingTalkChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'dingtalk';

  private config: DingTalkConfig;
  private notify: (event: ChannelEvent) => void;
  private running = false;
  private accessToken = '';
  private tokenExpiresAt = 0;
  private guidCounter = 0;
  private readonly replyContext = new DingTalkReplyContext();
  private readonly cardStreaming: DingTalkCardStreamingClient;
  private readonly gatewayFactory: DingTalkGatewayFactory;
  private gateway: DingTalkGateway | null = null;

  constructor(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void,
    gatewayFactory: DingTalkGatewayFactory = createOfficialDingTalkGateway,
  ) {
    this.pluginId = instance.id;
    this.config = normalizeDingTalkConfig(instance.config);
    this.notify = notify;
    this.gatewayFactory = gatewayFactory;
    this.cardStreaming = new DingTalkCardStreamingClient({
      pluginId: this.pluginId,
      robotCode: this.config.robotCode,
      cardTemplateId: this.config.cardTemplateId,
      getToken: () => this.getToken(),
      nextGuid: () => this.nextGuid(),
    });
  }

  get supportsStreaming(): boolean {
    return Boolean(this.config.cardTemplateId);
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    const { appKey, appSecret } = this.config;
    if (appKey && appSecret) {
      await this.refreshToken();
      const gateway = this.gatewayFactory({
        pluginId: this.pluginId,
        appKey,
        appSecret,
        handleStreamEvent: (raw) => this.handleStreamEvent(raw),
        notify: (event) => this.safeNotify(event),
      });
      this.gateway = gateway;
      try {
        await gateway.start();
      } catch (error) {
        this.gateway = null;
        throw error;
      }
    }
    this.running = true;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'running' });
  }

  async stop(): Promise<void> {
    this.gateway?.stop();
    this.gateway = null;
    this.running = false;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'stopped' });
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    const webhookUrl = this.replyContext.getSessionWebhook(chatId);
    if (webhookUrl) {
      try {
        return await this.sendViaSessionWebhook(webhookUrl, content);
      } catch (error) {
        console.warn('[dingtalk] sessionWebhook reply failed, falling back', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (this.config.appKey && this.config.robotCode) {
      return this.sendViaRobotApi(chatId, content);
    }
    return this.sendViaWebhook(content);
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const chatId = this.replyContext.resolveChatId(messageId);
    if (chatId) {
      return this.sendMessage(chatId, content);
    }
    return this.sendViaWebhook(content, messageId);
  }

  async sendStreamingMessage(
    chatId: string,
    initialContent: string,
    _replyToMessageId?: string,
  ): Promise<ChannelStreamingHandle> {
    return this.cardStreaming.createHandle({
      chatId,
      initialContent,
      chatMeta: this.replyContext.resolveChatMeta(chatId),
    });
  }

  async getGroupMessages(_chatId: string, _count = 20): Promise<ChannelMessage[]> {
    return listRecentChannelMessages(this.pluginId, _chatId, _count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    if (!this.config.appKey) return [];
    const token = await this.getToken();
    const resp = await channelFetch(`${DINGTALK_NEW_API}/chat/privatechats`, {
      headers: { 'x-acs-dingtalk-access-token': token },
    });
    const data = (await resp.json()) as {
      result?: Array<{ chatId: string; title?: string }>;
    };
    return (data.result ?? []).map((g) => ({
      id: g.chatId,
      name: g.title ?? g.chatId,
    }));
  }

  handleStreamEvent(raw: unknown): void {
    const message = parseDingTalkInboundMessage(raw);
    if (!message) {
      return;
    }

    this.replyContext.rememberStreamEvent(raw, message.chatId, message.id);
    this.safeNotify({ type: 'message', pluginId: this.pluginId, message });
  }

  private async sendViaWebhook(
    content: string,
    _replyToId?: string,
  ): Promise<{ messageId: string }> {
    const timestamp = Date.now();
    let url = this.config.webhookUrl;
    if (this.config.secret) {
      const sign = signWebhook(this.config.secret, timestamp);
      url += `&timestamp=${timestamp}&sign=${sign}`;
    }
    const resp = await channelFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
    });
    const data = (await resp.json()) as DingTalkWebhookResponse;
    if (data.errcode !== 0) {
      throw new Error(`DingTalk webhook error ${data.errcode}: ${data.errmsg}`);
    }
    return { messageId: `webhook-${timestamp}` };
  }

  private async sendViaSessionWebhook(
    webhookUrl: string,
    content: string,
  ): Promise<{ messageId: string }> {
    const timestamp = Date.now();
    const resp = await channelFetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
    });
    if (!resp.ok) {
      throw new Error(`DingTalk sessionWebhook error ${resp.status}`);
    }
    return { messageId: `session-webhook-${timestamp}` };
  }

  private async sendViaRobotApi(chatId: string, content: string): Promise<{ messageId: string }> {
    const token = await this.getToken();
    const resp = await channelFetch(`${DINGTALK_NEW_API}/robot/oToMessages/batchSend`, {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        robotCode: this.config.robotCode,
        userIds: [chatId],
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content }),
      }),
    });
    const data = (await resp.json()) as DingTalkSendResponse;
    return { messageId: data.processQueryKey ?? `robot-${Date.now()}` };
  }

  private async getToken(): Promise<string> {
    if (Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    await this.refreshToken();
    return this.accessToken;
  }

  private async refreshToken(): Promise<void> {
    const resp = await channelFetch(
      `${DINGTALK_API}/gettoken?appkey=${this.config.appKey}&appsecret=${this.config.appSecret}`,
    );
    const data = (await resp.json()) as DingTalkTokenResponse;
    if (data.errcode !== 0) throw new Error(`DingTalk auth failed: ${data.errcode}`);
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
  }

  private nextGuid(): string {
    this.guidCounter += 1;
    return `${this.pluginId}-${Date.now()}-${this.guidCounter}`;
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (error) {
      console.warn('[dingtalk] channel notify handler threw', {
        pluginId: this.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createDingTalkService(
  instance: ChannelInstance,
  notify: (event: ChannelEvent) => void,
): MessagingChannelService {
  return new DingTalkChannelService(instance, notify);
}
