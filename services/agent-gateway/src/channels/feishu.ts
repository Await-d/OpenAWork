import type {
  MessagingChannelService,
  ChannelMessage,
  ChannelGroup,
  ChannelStreamingHandle,
  ChannelInstance,
  ChannelEvent,
  FeishuBitableRecordsInput,
  FeishuChatMembersResult,
  FeishuFileType,
  FeishuMemberIdType,
  FeishuUrgentType,
} from './types.js';
import { channelFetch } from './channel-http.js';
import {
  createOfficialFeishuGateway,
  type FeishuGateway,
  type FeishuGatewayFactory,
} from './feishu-gateway.js';
import { FEISHU_API, type FeishuConfig } from './feishu-api-types.js';
import {
  createFeishuBitableRecords,
  deleteFeishuBitableRecords,
  getFeishuBitableRecords,
  listFeishuBitableApps,
  listFeishuBitableFields,
  listFeishuBitableTables,
  updateFeishuBitableRecords,
} from './feishu-bitable.js';
import { sendFeishuFile, sendFeishuImage } from './feishu-media.js';
import {
  getFeishuGroupMessages,
  listFeishuChatMembers,
  listFeishuGroups,
  replyFeishuTextMessage,
  sendFeishuStreamingMessage,
  sendFeishuTextMessage,
  sendFeishuUrgent,
  type FeishuAuthContext,
} from './feishu-messaging.js';
import { sendFeishuMention } from './feishu-mention.js';
import { feishuTokenResponseSchema } from './feishu-response-schemas.js';

export class FeishuChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'feishu';
  readonly supportsStreaming = true;

  private config: FeishuConfig;
  private readonly botName: string;
  private notify: (event: ChannelEvent) => void;
  private readonly gatewayFactory: FeishuGatewayFactory;
  private gateway: FeishuGateway | null = null;
  private running = false;
  private accessToken = '';
  private tokenExpiresAt = 0;
  private readonly auth: FeishuAuthContext = { getToken: () => this.getToken() };

  constructor(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void,
    gatewayFactory: FeishuGatewayFactory = createOfficialFeishuGateway,
  ) {
    this.pluginId = instance.id;
    this.botName = instance.name;
    this.config = instance.config as unknown as FeishuConfig;
    this.notify = notify;
    this.gatewayFactory = gatewayFactory;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    await this.refreshToken();
    const gateway = this.gatewayFactory({
      pluginId: this.pluginId,
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      botName: this.botName,
      botOpenId: this.config.botOpenId,
      downloadImage: (messageId, imageKey) => this.downloadMessageImage(messageId, imageKey),
      notify: (event) => this.safeNotify(event),
    });
    this.gateway = gateway;
    try {
      await gateway.start();
    } catch (error) {
      this.gateway = null;
      throw error;
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
    return sendFeishuTextMessage(this.auth, chatId, content);
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    return replyFeishuTextMessage(this.auth, messageId, content);
  }

  async sendStreamingMessage(
    chatId: string,
    initialContent: string,
    replyToMessageId?: string,
  ): Promise<ChannelStreamingHandle> {
    return sendFeishuStreamingMessage(this.auth, { chatId, initialContent, replyToMessageId });
  }

  async getGroupMessages(chatId: string, count = 20): Promise<ChannelMessage[]> {
    return getFeishuGroupMessages(this.auth, chatId, count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return listFeishuGroups(this.auth);
  }

  async sendImage(
    chatId: string,
    input: { readonly buffer: Buffer; readonly fileName?: string; readonly signal?: AbortSignal },
  ): Promise<{ messageId: string }> {
    return sendFeishuImage(this.auth, chatId, input);
  }

  async sendFile(
    chatId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName: string;
      readonly fileType?: FeishuFileType;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ messageId: string }> {
    return sendFeishuFile(this.auth, chatId, input);
  }

  async listChatMembers(
    chatId: string,
    input?: {
      readonly pageSize?: number;
      readonly pageToken?: string;
      readonly memberIdType?: FeishuMemberIdType;
      readonly signal?: AbortSignal;
    },
  ): Promise<FeishuChatMembersResult> {
    return listFeishuChatMembers(this.auth, chatId, input);
  }

  async sendMention(
    chatId: string,
    input: {
      readonly userIds: readonly string[];
      readonly atAll?: boolean;
      readonly text: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ messageId: string }> {
    return sendFeishuMention(this.auth, chatId, input);
  }

  async sendUrgent(
    messageId: string,
    input: {
      readonly userIds: readonly string[];
      readonly urgentTypes: readonly FeishuUrgentType[];
      readonly userIdType?: FeishuMemberIdType;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ ok: true }> {
    return sendFeishuUrgent(this.auth, messageId, input);
  }

  async listBitableApps(input?: {
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown> {
    return listFeishuBitableApps(this.auth, input);
  }

  async listBitableTables(input: {
    readonly appToken: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown> {
    return listFeishuBitableTables(this.auth, input);
  }

  async listBitableFields(input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown> {
    return listFeishuBitableFields(this.auth, input);
  }

  async getBitableRecords(input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly filter?: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown> {
    return getFeishuBitableRecords(this.auth, input);
  }

  async createBitableRecords(input: FeishuBitableRecordsInput): Promise<unknown> {
    return createFeishuBitableRecords(this.auth, input);
  }

  async updateBitableRecords(input: FeishuBitableRecordsInput): Promise<unknown> {
    return updateFeishuBitableRecords(this.auth, input);
  }

  async deleteBitableRecords(input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly recordIds: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<unknown> {
    return deleteFeishuBitableRecords(this.auth, input);
  }

  private async getToken(): Promise<string> {
    if (Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    await this.refreshToken();
    return this.accessToken;
  }

  private async refreshToken(): Promise<void> {
    const resp = await channelFetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    const data = feishuTokenResponseSchema.parse(await resp.json());
    if (data.code !== 0) throw new Error(`Feishu auth failed: ${data.code}`);
    this.accessToken = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + data.expire * 1000;
  }

  private async downloadMessageImage(
    messageId: string,
    imageKey: string,
  ): Promise<{ readonly base64: string; readonly mediaType: string }> {
    const token = await this.getToken();
    const response = await channelFetch(
      `${FEISHU_API}/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(
        imageKey,
      )}?type=image`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Feishu image download failed: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mediaType = response.headers.get('content-type') || 'image/png';
    return {
      base64: buffer.toString('base64'),
      mediaType,
    };
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (error) {
      console.warn('[feishu] channel notify handler threw', {
        pluginId: this.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createFeishuService(
  instance: ChannelInstance,
  notify: (event: ChannelEvent) => void,
): MessagingChannelService {
  return new FeishuChannelService(instance, notify);
}
