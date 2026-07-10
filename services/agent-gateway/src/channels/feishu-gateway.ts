import * as Lark from '@larksuiteoapi/node-sdk';
import { parseFeishuInboundMessage } from './inbound-parsers/feishu.js';
import type { ChannelEvent, ChannelImageAttachment } from './types.js';

const MAX_DEDUPED_MESSAGES = 500;

const processedMessageIdsByPlugin = new Map<string, Set<string>>();

export interface FeishuGateway {
  start(): Promise<void>;
  stop(): void;
}

export interface FeishuGatewayFactoryOptions {
  readonly pluginId: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly botName?: string;
  readonly botOpenId?: string;
  readonly downloadImage?: (
    messageId: string,
    imageKey: string,
  ) => Promise<ChannelImageAttachment | null>;
  readonly notify: (event: ChannelEvent) => void;
}

export type FeishuGatewayFactory = (options: FeishuGatewayFactoryOptions) => FeishuGateway;

export const createOfficialFeishuGateway: FeishuGatewayFactory = (options) =>
  new OfficialFeishuGateway(options);

export interface FeishuGatewayParseContext {
  readonly pluginId: string;
  readonly botName?: string;
  readonly botOpenId?: string;
}

function rememberMessage(pluginId: string, messageId: string): boolean {
  const processed = processedMessageIdsByPlugin.get(pluginId) ?? new Set<string>();
  processedMessageIdsByPlugin.set(pluginId, processed);
  if (processed.has(messageId)) {
    return false;
  }
  processed.add(messageId);
  if (processed.size > MAX_DEDUPED_MESSAGES) {
    const first = processed.values().next().value;
    if (typeof first === 'string') {
      processed.delete(first);
    }
  }
  return true;
}

export async function parseFeishuGatewayEvent(
  contextOrPluginId: FeishuGatewayParseContext | string,
  event: unknown,
  downloadImage?: (messageId: string, imageKey: string) => Promise<ChannelImageAttachment | null>,
): Promise<ChannelEvent | null> {
  const context =
    typeof contextOrPluginId === 'string' ? { pluginId: contextOrPluginId } : contextOrPluginId;
  const message = parseFeishuInboundMessage(event, {
    botName: context.botName,
    botOpenId: context.botOpenId,
    requireMentionInGroup: true,
  });
  if (!message || !rememberMessage(context.pluginId, message.id)) {
    return null;
  }
  const imageKey = readFeishuImageKey(event);
  if (imageKey && downloadImage) {
    try {
      const image = await downloadImage(message.id, imageKey);
      if (image) {
        return {
          type: 'message',
          pluginId: context.pluginId,
          message: {
            ...message,
            content: message.content || '[User sent an image]',
            images: [image],
          },
        };
      }
    } catch (error) {
      console.warn('[feishu] failed to download inbound image', {
        pluginId: context.pluginId,
        messageId: message.id,
        imageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { type: 'message', pluginId: context.pluginId, message };
}

class OfficialFeishuGateway implements FeishuGateway {
  private readonly pluginId: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly botName: string | undefined;
  private readonly botOpenId: string | undefined;
  private readonly downloadImage:
    ((messageId: string, imageKey: string) => Promise<ChannelImageAttachment | null>) | undefined;
  private readonly notify: (event: ChannelEvent) => void;
  private wsClient: Lark.WSClient | null = null;

  constructor(options: FeishuGatewayFactoryOptions) {
    this.pluginId = options.pluginId;
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.botName = options.botName;
    this.botOpenId = options.botOpenId;
    this.downloadImage = options.downloadImage;
    this.notify = options.notify;
  }

  async start(): Promise<void> {
    if (this.wsClient) {
      return;
    }

    const wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
      onError: (error) => {
        this.safeNotify({
          type: 'error',
          pluginId: this.pluginId,
          error: error.message,
        });
      },
    });
    this.wsClient = wsClient;

    await wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (event: unknown) => {
          await this.handleMessage(event);
        },
      }),
    });
  }

  stop(): void {
    const current = this.wsClient;
    this.wsClient = null;
    current?.close();
  }

  private async handleMessage(event: unknown): Promise<void> {
    const channelEvent = await parseFeishuGatewayEvent(
      {
        pluginId: this.pluginId,
        botName: this.botName,
        botOpenId: this.botOpenId,
      },
      event,
      this.downloadImage,
    );
    if (channelEvent) {
      this.safeNotify(channelEvent);
    }
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (error) {
      console.warn('[feishu] gateway notify handler threw', {
        pluginId: this.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function readFeishuImageKey(event: unknown): string {
  if (!isRecord(event)) {
    return '';
  }
  const payload = isRecord(event['event']) ? event['event'] : event;
  const message = isRecord(payload['message']) ? payload['message'] : null;
  if (!message || message['message_type'] !== 'image' || typeof message['content'] !== 'string') {
    return '';
  }
  try {
    const content = JSON.parse(message['content']) as unknown;
    if (!isRecord(content)) {
      return '';
    }
    const imageKey = content['image_key'];
    return typeof imageKey === 'string' ? imageKey : '';
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
