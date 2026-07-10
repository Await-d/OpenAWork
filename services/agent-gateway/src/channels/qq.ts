import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelDiagnostics,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';
import { listRecentChannelGroups, listRecentChannelMessages } from './channel-message-cache.js';
import { QQApiClient } from './qq-api.js';
import { QQGatewayClient } from './qq-gateway.js';
import { parseQQInboundMessage } from './inbound-parsers/qq.js';
import { parseQQChatId } from './qq-target.js';
import { channelLogInfo, summarizeChannelMessage } from './channel-log.js';
import { markQQWakeupSent, resolveQQWakeupEligibility } from './qq-wakeup-store.js';
export { parseQQChatId } from './qq-target.js';

function parseBooleanConfig(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? '').trim());
}

export class QQChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'qq';

  private readonly appId: string;
  private readonly clientSecret: string;
  private readonly webhookSecret: string;
  private readonly gatewayUrl: string | undefined;
  private readonly ownerUserId: string | undefined;
  private readonly api: QQApiClient;
  private gateway: QQGatewayClient | null = null;
  private running = false;
  private readonly notify: (event: ChannelEvent) => void;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.appId = instance.config['appId'] ?? '';
    this.clientSecret = instance.config['clientSecret'] ?? '';
    this.webhookSecret = instance.config['webhookSecret'] ?? '';
    this.gatewayUrl = instance.config['gatewayUrl']?.trim() || undefined;
    this.ownerUserId = instance.ownerUserId;
    this.api = new QQApiClient({
      appId: this.appId,
      clientSecret: this.clientSecret,
      useSandbox: parseBooleanConfig(instance.config['useSandbox']),
      markdownSupport:
        instance.config['markdownSupport'] === undefined ||
        parseBooleanConfig(instance.config['markdownSupport']),
    });
    this.notify = notify;
  }

  /**
   * Dispatch a channel event without letting a throwing subscriber bubble back
   * into the webhook handler. Mirrors the Telegram channel's `safeNotify`
   * invariant: a fault in the router/auto-reply hook must not propagate into
   * the QQ webhook delivery path.
   */
  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (err) {
      console.warn(
        `[qq] channel notify handler threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async start(): Promise<void> {
    if (!this.appId || !this.clientSecret) {
      throw new Error('QQ channel requires appId and clientSecret');
    }
    if (this.running) {
      return;
    }
    await this.api.validate();
    this.running = true;
    const gateway =
      this.gatewayUrl === undefined
        ? new QQGatewayClient({
            pluginId: this.pluginId,
            ownerUserId: this.ownerUserId,
            api: this.api,
            notify: (event) => this.safeNotify(event),
          })
        : new QQGatewayClient({
            pluginId: this.pluginId,
            ownerUserId: this.ownerUserId,
            api: this.api,
            notify: (event) => this.safeNotify(event),
            gatewayUrl: this.gatewayUrl,
          });
    this.gateway = gateway;
    try {
      await gateway.start();
      channelLogInfo('qq gateway channel started', {
        pluginId: this.pluginId,
        transport: this.gatewayUrl === undefined ? 'gateway' : 'gateway-custom-url',
      });
    } catch (error) {
      this.gateway = null;
      this.running = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.gateway?.stop();
    this.gateway = null;
    this.running = false;
    channelLogInfo('qq gateway channel stopped', { pluginId: this.pluginId });
  }

  isRunning(): boolean {
    return this.running;
  }

  getDiagnostics(): ChannelDiagnostics {
    const gatewayDiagnostics = this.gateway?.getDiagnostics();
    if (gatewayDiagnostics) {
      const note =
        gatewayDiagnostics.lastDispatchAt === undefined
          ? 'QQ Gateway 已连接，但还没有收到任何消息事件。私聊请检查 C2C_MESSAGE_CREATE 事件权限、是否从机器人私聊入口发送，以及沙箱/正式环境是否一致；群聊请检查 GROUP_AT_MESSAGE_CREATE 权限、机器人是否进群并被 @。'
          : undefined;
      return {
        ...gatewayDiagnostics,
        status: this.running ? 'running' : 'stopped',
        running: this.running,
        ...(note ? { note } : {}),
      };
    }
    return {
      status: this.running ? 'running' : 'stopped',
      running: this.running,
      transport: this.gatewayUrl === undefined ? 'gateway' : 'gateway-custom-url',
      note: this.running ? 'QQ Gateway is starting.' : 'QQ Gateway is not running.',
    };
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    return this.sendMessageInternal(chatId, content, false);
  }

  async sendWakeupMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    return this.sendMessageInternal(chatId, content, true);
  }

  private async sendMessageInternal(
    chatId: string,
    content: string,
    allowWakeup: boolean,
  ): Promise<{ messageId: string }> {
    channelLogInfo('qq sending text message', {
      pluginId: this.pluginId,
      chatId,
      contentLength: content.length,
      allowWakeup,
    });
    const target = parseQQChatId(chatId);
    if (target.type !== 'c2c' || !allowWakeup) {
      const result = await this.api.sendMessage(target, content);
      channelLogInfo('qq text message sent', {
        pluginId: this.pluginId,
        chatId,
        messageId: result.messageId,
        wakeup: false,
      });
      return result;
    }

    const wakeup = resolveQQWakeupEligibility(this.pluginId, target.id);
    const result = await this.api.sendMessage(target, content, undefined, {
      isWakeup: wakeup.enabled,
    });
    if (wakeup.enabled && wakeup.periodKey) {
      markQQWakeupSent({
        pluginId: this.pluginId,
        openId: target.id,
        periodKey: wakeup.periodKey,
        sourceMessageId: wakeup.sourceMessageId,
        sourceTimestamp: wakeup.sourceTimestamp,
      });
    }
    channelLogInfo('qq text message sent', {
      pluginId: this.pluginId,
      chatId,
      messageId: result.messageId,
      wakeup: wakeup.enabled,
    });
    return result;
  }

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
    void input.fileName;
    void input.signal;
    channelLogInfo('qq sending image message', {
      pluginId: this.pluginId,
      chatId,
      fileName: input.fileName,
      byteLength: input.buffer.byteLength,
      textLength: input.text?.length ?? 0,
    });
    const result = await this.api.sendImage(parseQQChatId(chatId), {
      buffer: input.buffer,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.text ? { text: input.text } : {}),
    });
    channelLogInfo('qq image message sent', {
      pluginId: this.pluginId,
      chatId,
      messageId: result.messageId,
    });
    return result;
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const [chatId, replyToMessageId] = messageId.split('|');
    if (!chatId || !replyToMessageId) {
      throw new Error('QQ reply requires "<chatId>|<messageId>" reference');
    }
    channelLogInfo('qq replying text message', {
      pluginId: this.pluginId,
      chatId,
      replyToMessageId,
      contentLength: content.length,
    });
    const result = await this.api.sendMessage(parseQQChatId(chatId), content, replyToMessageId);
    channelLogInfo('qq text reply sent', {
      pluginId: this.pluginId,
      chatId,
      replyToMessageId,
      messageId: result.messageId,
    });
    return result;
  }

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
    void input.fileName;
    void input.signal;
    const [chatId, replyToMessageId] = messageId.split('|');
    if (!chatId || !replyToMessageId) {
      throw new Error('QQ image reply requires "<chatId>|<messageId>" reference');
    }
    channelLogInfo('qq replying image message', {
      pluginId: this.pluginId,
      chatId,
      replyToMessageId,
      fileName: input.fileName,
      byteLength: input.buffer.byteLength,
      textLength: input.text?.length ?? 0,
    });
    const result = await this.api.sendImage(parseQQChatId(chatId), {
      buffer: input.buffer,
      replyToMessageId,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.text ? { text: input.text } : {}),
    });
    channelLogInfo('qq image reply sent', {
      pluginId: this.pluginId,
      chatId,
      replyToMessageId,
      messageId: result.messageId,
    });
    return result;
  }

  handleWebhookEvent(body: unknown, signature?: string): void {
    void signature;
    const message = parseQQInboundMessage(body);
    if (message) {
      channelLogInfo('qq webhook message parsed', {
        pluginId: this.pluginId,
        ...summarizeChannelMessage(message),
      });
      this.safeNotify({ type: 'message', pluginId: this.pluginId, message });
    }
  }

  async getGroupMessages(_chatId: string, _count?: number): Promise<ChannelMessage[]> {
    return listRecentChannelMessages(this.pluginId, _chatId, _count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return listRecentChannelGroups(this.pluginId);
  }
}

export const qqFactory: ChannelServiceFactory = (instance, notify) =>
  new QQChannelService(instance, notify);
