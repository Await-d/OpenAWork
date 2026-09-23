import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';
import { channelFetch } from './channel-http.js';
import { DiscordGatewayClient } from './discord-gateway.js';

const DISCORD_API = 'https://discord.com/api/v10';

/** Discord 单条消息 `content` 的字符上限。 */
const DISCORD_CONTENT_MAX_LENGTH = 2000;

export class DiscordChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'discord';

  private readonly instance: ChannelInstance;
  private token: string;
  private running = false;
  private notify: (event: ChannelEvent) => void;
  private gateway: DiscordGatewayClient | null = null;
  private gatewayUrl: string | undefined;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.instance = instance;
    this.pluginId = instance.id;
    this.token = instance.config['token'] ?? '';
    this.gatewayUrl = instance.config['gatewayUrl'];
    this.notify = notify;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bot ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 仅带鉴权的请求头，供 multipart 请求使用。
   * 绝不能带 `Content-Type: application/json`——否则 fetch 无法自动生成
   * multipart boundary，Discord 会拒绝整个表单。
   */
  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bot ${this.token}`,
    };
  }

  async start(): Promise<void> {
    if (!this.token) throw new Error('Discord bot token is required');
    if (this.running) {
      return;
    }
    const gateway = new DiscordGatewayClient({
      channel: this.instance,
      pluginId: this.pluginId,
      token: this.token,
      gatewayUrl: this.gatewayUrl,
      notify: this.notify,
    });
    this.gateway = gateway;
    try {
      await gateway.start();
    } catch (error) {
      this.gateway = null;
      this.running = false;
      throw error;
    }
    this.running = true;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'running' });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.gateway?.stop();
    this.gateway = null;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'stopped' });
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(channelId: string, content: string): Promise<{ messageId: string }> {
    const res = await channelFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ content }),
    });
    const data = (await res.json()) as { id?: string };
    return { messageId: data.id ?? '' };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const [channelId, msgId] = messageId.split(':');
    const res = await channelFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ content, message_reference: { message_id: msgId } }),
    });
    const data = (await res.json()) as { id?: string };
    return { messageId: data.id ?? '' };
  }

  /**
   * 发送图片/文件。Discord 的图片与文件走同一消息端点：
   * `multipart/form-data` 中的 `payload_json` 承载消息体（content 等），
   * `files[0]` 承载二进制附件（正文可为空，即只发附件）。
   */
  async sendImage(
    chatId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName?: string;
      readonly signal?: AbortSignal;
      readonly sourceUrl?: string;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }> {
    return this.postDiscordMessage(
      chatId,
      { content: truncateDiscordContent(input.text) },
      { buffer: input.buffer, fileName: sanitizeDiscordFileName(input.fileName ?? 'image.png') },
      input.signal,
    );
  }

  /**
   * 回复图片/文件。messageId 格式与 `replyMessage` 一致，为
   * `<channelId>:<msgId>`；额外在 `payload_json` 里带 `message_reference`
   * 让 Discord 把该消息作为引用回复展示。
   */
  async replyImage(
    messageId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName?: string;
      readonly signal?: AbortSignal;
      readonly sourceUrl?: string;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }> {
    const [channelId, msgId] = messageId.split(':');
    if (!channelId || !msgId) {
      throw new Error('Discord image reply requires "<channelId>:<messageId>" reference');
    }
    return this.postDiscordMessage(
      channelId,
      {
        content: truncateDiscordContent(input.text),
        message_reference: { message_id: msgId },
      },
      { buffer: input.buffer, fileName: sanitizeDiscordFileName(input.fileName ?? 'image.png') },
      input.signal,
    );
  }

  /**
   * 统一的 multipart 消息投递：`payload_json` 为 JSON 消息体，
   * `files[0]` 为附件。请求头只能用 `authHeaders`（不带 Content-Type），
   * 让 fetch 自己生成 boundary；Discord 附件上传比纯文本慢，超时放宽到 30s。
   */
  private async postDiscordMessage(
    channelId: string,
    payload: Record<string, unknown>,
    file: { readonly buffer: Buffer; readonly fileName: string },
    signal?: AbortSignal,
  ): Promise<{ messageId: string }> {
    const form = new FormData();
    form.set('payload_json', JSON.stringify(payload));
    form.set('files[0]', bufferToBlob(file.buffer), file.fileName);
    const res = await channelFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: this.authHeaders,
      body: form,
      signal,
      timeoutMs: 30_000,
    });
    const data = (await res.json()) as { id?: string; code?: number; message?: string };
    if (!res.ok) {
      throw new Error(`Discord sendImage failed: ${data.message ?? res.status}`);
    }
    return { messageId: data.id ?? '' };
  }

  async getGroupMessages(channelId: string, count = 20): Promise<ChannelMessage[]> {
    const res = await channelFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${count}`, {
      headers: this.headers,
    });
    const body = (await res.json()) as unknown;
    // Discord returns a JSON object (e.g. `{ message, code }`) on error,
    // not an array — guard so `.map` can't throw, and read each field
    // defensively in case an entry omits author/content.
    if (!Array.isArray(body)) {
      return [];
    }
    const msgs = body as Array<{
      id?: string;
      author?: { id?: string; username?: string };
      content?: string;
      timestamp?: string;
    }>;
    return msgs.map((m) => ({
      id: m.id ?? '',
      senderId: m.author?.id ?? 'unknown',
      senderName: m.author?.username ?? m.author?.id ?? 'unknown',
      chatId: channelId,
      content: m.content ?? '',
      timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      raw: m,
    }));
  }

  async listGroups(): Promise<ChannelGroup[]> {
    const res = await channelFetch(`${DISCORD_API}/users/@me/guilds`, { headers: this.headers });
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) {
      return [];
    }
    const guilds = body as Array<{ id?: string; name?: string }>;
    return guilds.map((g) => ({ id: g.id ?? '', name: g.name ?? '' }));
  }
}

export const discordFactory: ChannelServiceFactory = (instance, notify) =>
  new DiscordChannelService(instance, notify);

/** 把 Buffer 复制为 Blob，供 multipart 附件上传使用。 */
function bufferToBlob(buffer: Buffer): Blob {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Blob([bytes], { type: 'application/octet-stream' });
}

/** 截断 `content` 到 Discord 的 2000 字符上限；`undefined` 归一为空字符串。 */
function truncateDiscordContent(content: string | undefined): string {
  const text = content ?? '';
  if (text.length <= DISCORD_CONTENT_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, DISCORD_CONTENT_MAX_LENGTH - 1)}…`;
}

/**
 * 清洗附件文件名：把路径分隔符、引号和换行/制表符替换为 `_`，
 * 避免 multipart header 注入或路径穿越；再去掉首尾空白与点，
 * 为空时回退 `upload.bin`，总长截到 100。
 */
function sanitizeDiscordFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '');
  if (!sanitized) {
    return 'upload.bin';
  }
  return sanitized.slice(0, 100);
}
