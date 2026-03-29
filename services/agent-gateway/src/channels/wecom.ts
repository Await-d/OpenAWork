import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';

export class WeComChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'wecom';

  private corpId: string;
  private corpSecret: string;
  private agentId: string;
  private webhookUrl: string;
  private running = false;
  private notify: (event: ChannelEvent) => void;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.corpId = instance.config['corpId'] ?? '';
    this.corpSecret = instance.config['corpSecret'] ?? '';
    this.agentId = instance.config['agentId'] ?? '';
    this.webhookUrl = instance.config['webhookUrl'] ?? '';
    this.notify = notify;
  }

  async start(): Promise<void> {
    if (!this.corpId && !this.webhookUrl) {
      throw new Error('WeCom channel requires corpId+corpSecret+agentId or webhookUrl');
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    if (this.webhookUrl) {
      return this.sendViaWebhook(content);
    }
    return this.sendViaApi(chatId, content);
  }

  private async sendViaWebhook(content: string): Promise<{ messageId: string }> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
    });
    const data = (await response.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode !== 0 && data.errcode !== undefined) {
      throw new Error(`WeCom webhook error: ${data.errmsg ?? data.errcode}`);
    }
    return { messageId: `webhook-${Date.now()}` };
  }

  private async sendViaApi(chatId: string, content: string): Promise<{ messageId: string }> {
    const token = await this.getAccessToken();
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: chatId,
          msgtype: 'text',
          agentid: Number(this.agentId),
          text: { content },
        }),
      },
    );
    const data = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
      msgid?: string;
    };
    if (data.errcode !== 0 && data.errcode !== undefined) {
      throw new Error(`WeCom API error ${data.errcode}: ${data.errmsg}`);
    }
    return { messageId: data.msgid ?? `${Date.now()}` };
  }

  private async getAccessToken(): Promise<string> {
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`,
    );
    const data = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
    };
    if (!data.access_token) {
      throw new Error(`WeCom token error: ${data.errmsg ?? data.errcode}`);
    }
    return data.access_token;
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const chatId = messageId.split(':')[0] ?? '';
    return this.sendMessage(chatId, content);
  }

  async getGroupMessages(_chatId: string, _count?: number): Promise<ChannelMessage[]> {
    return [];
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return [];
  }
}

export const weComFactory: ChannelServiceFactory = (instance, notify) =>
  new WeComChannelService(instance, notify);
