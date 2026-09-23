import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
  FeishuFileType,
} from './types.js';
import { channelFetch } from './channel-http.js';
import { listRecentChannelGroups, listRecentChannelMessages } from './channel-message-cache.js';

/** 媒体上传超时：上传比普通消息慢，与飞书文件上传一致给 60s。 */
const WECOM_MEDIA_UPLOAD_TIMEOUT_MS = 60_000;

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
    if (!this.webhookUrl) {
      if (!this.corpSecret || !this.agentId) {
        throw new Error('WeCom API channel requires corpId, corpSecret and agentId');
      }
      await this.getAccessToken();
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

  /**
   * 应用模式发送文件：先 `/cgi-bin/media/upload` 换取 `media_id`，再以
   * `file` 消息类型发送。webhook（群机器人）不支持 file 消息，因此
   * webhook-only 配置下直接抛错，而不是静默退化成文本。
   *
   * 说明：企业微信 file 消息没有 caption 字段，`text` 仅按接口保留但不参与
   * 发送；`fileType` 同理——企业微信按上传的 media 类型自行推断，无需声明。
   */
  async sendFile(
    chatId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName: string;
      readonly fileType?: FeishuFileType;
      readonly signal?: AbortSignal;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }> {
    if (!this.corpId || !this.corpSecret || !this.agentId) {
      throw new Error('WeCom webhook mode does not support file messages');
    }

    const token = await this.getAccessToken();
    const mediaId = await this.uploadFileMedia(token, input);

    const response = await channelFetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: chatId,
          msgtype: 'file',
          agentid: Number(this.agentId),
          file: { media_id: mediaId },
        }),
        signal: input.signal,
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

  /** 上传文件媒体换取 `media_id`（multipart 字段名固定为 `media`）。 */
  private async uploadFileMedia(
    token: string,
    input: { readonly buffer: Buffer; readonly fileName: string; readonly signal?: AbortSignal },
  ): Promise<string> {
    const form = new FormData();
    form.set('media', bufferToBlob(input.buffer), input.fileName);

    // 不设置 Content-Type：FormData 必须由 fetch 生成带 boundary 的头。
    const response = await channelFetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=file`,
      {
        method: 'POST',
        body: form,
        timeoutMs: WECOM_MEDIA_UPLOAD_TIMEOUT_MS,
        signal: input.signal,
      },
    );
    const data = (await response.json()) as {
      media_id?: string;
      errcode?: number;
      errmsg?: string;
    };
    // 企业微信成功时 errcode 为 0 或字段缺失，故缺失也算成功；media_id 必须存在。
    if ((data.errcode !== 0 && data.errcode !== undefined) || !data.media_id) {
      throw new Error(`WeCom media upload failed: ${data.errmsg ?? data.errcode}`);
    }
    return data.media_id;
  }

  private async sendViaWebhook(content: string): Promise<{ messageId: string }> {
    const response = await channelFetch(this.webhookUrl, {
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
    const response = await channelFetch(
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
    const response = await channelFetch(
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
    return listRecentChannelMessages(this.pluginId, _chatId, _count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return listRecentChannelGroups(this.pluginId);
  }
}

export const weComFactory: ChannelServiceFactory = (instance, notify) =>
  new WeComChannelService(instance, notify);

function bufferToBlob(buffer: Buffer): Blob {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Blob([bytes], { type: 'application/octet-stream' });
}
