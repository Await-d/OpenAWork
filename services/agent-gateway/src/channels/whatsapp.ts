import type { Buffer } from 'node:buffer';
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
import { parseWhatsAppInboundMessage } from './inbound-parsers/whatsapp.js';
import { attachWhatsAppInboundImages, sendWhatsAppMedia } from './whatsapp-media.js';
import { listRecentChannelGroups, listRecentChannelMessages } from './channel-message-cache.js';

/** 出站图片入参，与 `MessagingChannelService.sendImage` / `replyImage` 的契约一致。 */
interface WhatsAppImageSendInput {
  readonly buffer: Buffer;
  readonly fileName?: string;
  readonly signal?: AbortSignal;
  readonly sourceUrl?: string;
  readonly text?: string;
}

export class WhatsAppChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'whatsapp';

  private phoneNumberId: string;
  private accessToken: string;
  private verifyToken: string;
  private running = false;
  private notify: (event: ChannelEvent) => void;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.phoneNumberId = instance.config['phoneNumberId'] ?? '';
    this.accessToken = instance.config['accessToken'] ?? '';
    this.verifyToken = instance.config['verifyToken'] ?? '';
    this.notify = notify;
  }

  /**
   * Dispatch a channel event without letting a throwing subscriber break the
   * webhook batch loop. `handleWebhookEvent` fans every message in a single
   * WhatsApp webhook payload (entry[] → changes[] → messages[]) out via
   * `notify`; a synchronous throw from one dispatch (router lookup / filter)
   * would otherwise skip every remaining message in the same payload. Mirrors
   * the Telegram channel's `safeNotify` invariant.
   */
  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (err) {
      console.warn(
        `[whatsapp] channel notify handler threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async start(): Promise<void> {
    if (!this.phoneNumberId || !this.accessToken) {
      throw new Error('WhatsApp channel requires phoneNumberId and accessToken');
    }
    await this.verifyCredentials();
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async verifyCredentials(): Promise<void> {
    const response = await channelFetch(
      `https://graph.facebook.com/v19.0/${this.phoneNumberId}?fields=id,display_phone_number`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    );
    const data = (await response.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!response.ok || data.error || !data.id) {
      throw new Error(
        `WhatsApp credential check failed: ${data.error?.message ?? response.status}`,
      );
    }
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    const response = await channelFetch(
      `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: chatId,
          type: 'text',
          text: { body: content },
        }),
      },
    );
    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
      error?: { message: string };
    };
    if (data.error) {
      throw new Error(`WhatsApp error: ${data.error.message}`);
    }
    return { messageId: data.messages?.[0]?.id ?? `${Date.now()}` };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const chatId = messageId.split(':')[0] ?? '';
    return this.sendMessage(chatId, content);
  }

  /**
   * 出站发图：Cloud API 只接受媒体 ID，故走「先上传再发送」两步
   * （`sendWhatsAppMedia`）。`sourceUrl` 按接口保留但不使用（调用方需先取成
   * buffer）。
   */
  async sendImage(chatId: string, input: WhatsAppImageSendInput): Promise<{ messageId: string }> {
    return sendWhatsAppMedia({
      accessToken: this.accessToken,
      phoneNumberId: this.phoneNumberId,
      to: chatId,
      buffer: input.buffer,
      fileName: input.fileName ?? 'image.jpg',
      kind: 'image',
      ...(input.text ? { caption: input.text } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  /**
   * 回复图片：WhatsApp 无引用回复语义，按 `messageId` 拆出的 chatId 重发
   * （与既有 `replyMessage` 一致）。
   */
  async replyImage(
    messageId: string,
    input: WhatsAppImageSendInput,
  ): Promise<{ messageId: string }> {
    const chatId = messageId.split(':')[0] ?? '';
    return this.sendImage(chatId, input);
  }

  /**
   * 出站发文件：同样两步上传 + 发送，文件名随 document 消息下发。
   * `fileType` 按接口保留但不使用——WhatsApp 由 `type=document` 自行处理。
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
    return sendWhatsAppMedia({
      accessToken: this.accessToken,
      phoneNumberId: this.phoneNumberId,
      to: chatId,
      buffer: input.buffer,
      fileName: input.fileName,
      kind: 'file',
      ...(input.text ? { caption: input.text } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  handleWebhookVerification(mode: string, verifyToken: string, challenge: string): string | null {
    if (mode === 'subscribe' && verifyToken === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  handleWebhookEvent(body: unknown): void {
    const payload = body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              id: string;
              from: string;
              text?: { body: string };
              timestamp: string;
            }>;
            contacts?: Array<{ profile: { name: string }; wa_id: string }>;
          };
        }>;
      }>;
    };

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;
        for (const message of value.messages) {
          const contact = value.contacts?.find((contact) => contact.wa_id === message.from);
          const parsed = parseWhatsAppInboundMessage({
            entry: [
              {
                changes: [
                  {
                    value: {
                      ...value,
                      messages: [message],
                      contacts: contact ? [contact] : value.contacts,
                    },
                  },
                ],
              },
            ],
          });
          if (!parsed) continue;
          this.safeNotify({ type: 'message', pluginId: this.pluginId, message: parsed });
        }
      }
    }
  }

  /**
   * 服务层入站 enrich：WhatsApp 图片消息只带媒体 ID，需在通用路由派发前
   * 下载为 base64 附件（`ChannelMessage.images`），供多模态输入消费。
   * 失败只降级为占位符消息，绝不上抛。
   */
  async enrichInboundMessage(message: ChannelMessage): Promise<ChannelMessage> {
    return attachWhatsAppInboundImages({
      accessToken: this.accessToken,
      message,
    });
  }

  async getGroupMessages(_chatId: string, _count?: number): Promise<ChannelMessage[]> {
    return listRecentChannelMessages(this.pluginId, _chatId, _count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return listRecentChannelGroups(this.pluginId);
  }
}

export const whatsAppFactory: ChannelServiceFactory = (instance, notify) =>
  new WhatsAppChannelService(instance, notify);
