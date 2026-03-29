import { createHmac } from 'node:crypto';
import type {
  MessagingChannelService,
  ChannelMessage,
  ChannelGroup,
  ChannelInstance,
  ChannelEvent,
} from './types.js';

interface DingTalkConfig {
  webhookUrl: string;
  secret?: string;
  appKey?: string;
  appSecret?: string;
  robotCode?: string;
}

interface DingTalkWebhookResponse {
  errcode: number;
  errmsg: string;
}

interface DingTalkTokenResponse {
  errcode: number;
  access_token: string;
  expires_in: number;
}

interface DingTalkSendResponse {
  processQueryKey: string;
  requestId: string;
}

const DINGTALK_API = 'https://oapi.dingtalk.com';
const DINGTALK_NEW_API = 'https://api.dingtalk.com/v1.0';

function signWebhook(secret: string, timestamp: number): string {
  const payload = `${timestamp}\n${secret}`;
  return encodeURIComponent(createHmac('sha256', secret).update(payload).digest('base64'));
}

export class DingTalkChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'dingtalk';
  readonly supportsStreaming = false;

  private config: DingTalkConfig;
  private notify: (event: ChannelEvent) => void;
  private running = false;
  private accessToken = '';
  private tokenExpiresAt = 0;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.config = instance.config as unknown as DingTalkConfig;
    this.notify = notify;
  }

  async start(): Promise<void> {
    if (this.config.appKey && this.config.appSecret) {
      await this.refreshToken();
    }
    this.running = true;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'running' });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'stopped' });
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    if (this.config.appKey && this.config.robotCode) {
      return this.sendViaRobotApi(chatId, content);
    }
    return this.sendViaWebhook(content);
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    return this.sendViaWebhook(content, messageId);
  }

  async getGroupMessages(_chatId: string, _count = 20): Promise<ChannelMessage[]> {
    return [];
  }

  async listGroups(): Promise<ChannelGroup[]> {
    if (!this.config.appKey) return [];
    const token = await this.getToken();
    const resp = await fetch(`${DINGTALK_NEW_API}/chat/privatechats`, {
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
    const resp = await fetch(url, {
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

  private async sendViaRobotApi(chatId: string, content: string): Promise<{ messageId: string }> {
    const token = await this.getToken();
    const resp = await fetch(`${DINGTALK_NEW_API}/robot/oToMessages/batchSend`, {
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
    const resp = await fetch(
      `${DINGTALK_API}/gettoken?appkey=${this.config.appKey}&appsecret=${this.config.appSecret}`,
    );
    const data = (await resp.json()) as DingTalkTokenResponse;
    if (data.errcode !== 0) throw new Error(`DingTalk auth failed: ${data.errcode}`);
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
  }
}

export function createDingTalkService(
  instance: ChannelInstance,
  notify: (event: ChannelEvent) => void,
): MessagingChannelService {
  return new DingTalkChannelService(instance, notify);
}
