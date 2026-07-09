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
    return this.api.sendMessage(parseQQChatId(chatId), content);
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const [chatId, replyToMessageId] = messageId.split('|');
    if (!chatId || !replyToMessageId) {
      throw new Error('QQ reply requires "<chatId>|<messageId>" reference');
    }
    return this.api.sendMessage(parseQQChatId(chatId), content, replyToMessageId);
  }

  handleWebhookEvent(body: unknown, signature?: string): void {
    void signature;
    const message = parseQQInboundMessage(body);
    if (message) {
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
