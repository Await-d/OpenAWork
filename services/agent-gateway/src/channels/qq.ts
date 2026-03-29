import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';

export class QQChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'qq';

  private appId: string;
  private clientSecret: string;
  private webhookSecret: string;
  private running = false;
  private notify: (event: ChannelEvent) => void;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.appId = instance.config['appId'] ?? '';
    this.clientSecret = instance.config['clientSecret'] ?? '';
    this.webhookSecret = instance.config['webhookSecret'] ?? '';
    this.notify = notify;
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
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    });
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: string;
      code?: number;
      message?: string;
    };
    if (!data.access_token) {
      throw new Error(`QQ token error: ${data.message ?? data.code}`);
    }
    return data.access_token;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    const token = await this.getAccessToken();
    const [channelId, msgId] = chatId.split(':');
    const response = await fetch(`https://api.sgroup.qq.com/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `QQBot ${token}`,
      },
      body: JSON.stringify({
        content,
        msg_type: 0,
        ...(msgId ? { msg_id: msgId } : {}),
      }),
    });
    const data = (await response.json()) as { id?: string; code?: number; message?: string };
    if (data.code) {
      throw new Error(`QQ API error ${data.code}: ${data.message}`);
    }
    return { messageId: data.id ?? `${Date.now()}` };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const chatId = messageId.split(':')[0] ?? '';
    return this.sendMessage(chatId, content);
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
    this.notify({ type: 'message', pluginId: this.pluginId, message: channelMessage });
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
