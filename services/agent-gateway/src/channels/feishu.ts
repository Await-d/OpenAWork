import type {
  MessagingChannelService,
  ChannelMessage,
  ChannelGroup,
  ChannelStreamingHandle,
  ChannelInstance,
  ChannelEvent,
} from './types.js';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey?: string;
}

interface FeishuTokenResponse {
  code: number;
  tenant_access_token: string;
  expire: number;
}

interface FeishuMessageResponse {
  code: number;
  data: { message_id: string };
}

interface FeishuCardUpdateResponse {
  code: number;
}

const FEISHU_API = 'https://open.feishu.cn/open-apis';

function buildTextCard(content: string): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content },
      },
    ],
  });
}

export class FeishuChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'feishu';
  readonly supportsStreaming = true;

  private config: FeishuConfig;
  private notify: (event: ChannelEvent) => void;
  private running = false;
  private accessToken = '';
  private tokenExpiresAt = 0;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.config = instance.config as unknown as FeishuConfig;
    this.notify = notify;
  }

  async start(): Promise<void> {
    await this.refreshToken();
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
    const token = await this.getToken();
    const resp = await fetch(`${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      }),
    });
    const data = (await resp.json()) as FeishuMessageResponse;
    return { messageId: data.data.message_id };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const token = await this.getToken();
    const resp = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}/reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      }),
    });
    const data = (await resp.json()) as FeishuMessageResponse;
    return { messageId: data.data.message_id };
  }

  async sendStreamingMessage(
    chatId: string,
    initialContent: string,
    _replyToMessageId?: string,
  ): Promise<ChannelStreamingHandle> {
    const token = await this.getToken();
    const resp = await fetch(`${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: buildTextCard(initialContent),
      }),
    });
    const data = (await resp.json()) as FeishuMessageResponse;
    const messageId = data.data.message_id;

    const updateCard = async (content: string): Promise<void> => {
      const t = await this.getToken();
      const r = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msg_type: 'interactive',
          content: buildTextCard(content),
        }),
      });
      const result = (await r.json()) as FeishuCardUpdateResponse;
      if (result.code !== 0) {
        throw new Error(`Feishu card update failed: ${result.code}`);
      }
    };

    return {
      update: updateCard,
      finish: updateCard,
    };
  }

  async getGroupMessages(chatId: string, count = 20): Promise<ChannelMessage[]> {
    const token = await this.getToken();
    const resp = await fetch(
      `${FEISHU_API}/im/v1/messages?container_id_type=chat&container_id=${chatId}&page_size=${count}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await resp.json()) as {
      data: {
        items: Array<{
          message_id: string;
          sender: { id: string; name?: string };
          body: { content: string };
          create_time: string;
        }>;
      };
    };
    return (data.data.items ?? []).map((item) => ({
      id: item.message_id,
      senderId: item.sender.id,
      senderName: item.sender.name ?? item.sender.id,
      chatId,
      content: item.body.content,
      timestamp: Number(item.create_time),
      raw: item,
    }));
  }

  async listGroups(): Promise<ChannelGroup[]> {
    const token = await this.getToken();
    const resp = await fetch(`${FEISHU_API}/im/v1/chats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await resp.json()) as {
      data: { items: Array<{ chat_id: string; name: string; member_count?: number }> };
    };
    return (data.data.items ?? []).map((g) => ({
      id: g.chat_id,
      name: g.name,
      memberCount: g.member_count,
    }));
  }

  private async getToken(): Promise<string> {
    if (Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    await this.refreshToken();
    return this.accessToken;
  }

  private async refreshToken(): Promise<void> {
    const resp = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    const data = (await resp.json()) as FeishuTokenResponse;
    if (data.code !== 0) throw new Error(`Feishu auth failed: ${data.code}`);
    this.accessToken = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + data.expire * 1000;
  }
}

export function createFeishuService(
  instance: ChannelInstance,
  notify: (event: ChannelEvent) => void,
): MessagingChannelService {
  return new FeishuChannelService(instance, notify);
}
