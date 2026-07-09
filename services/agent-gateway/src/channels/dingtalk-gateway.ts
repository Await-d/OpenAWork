import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import type { DWClientDownStream } from 'dingtalk-stream';
import type { ChannelEvent } from './types.js';

export interface DingTalkGateway {
  start(): Promise<void>;
  stop(): void;
}

export interface DingTalkGatewayFactoryOptions {
  readonly pluginId: string;
  readonly appKey: string;
  readonly appSecret: string;
  readonly handleStreamEvent: (raw: unknown) => void;
  readonly notify: (event: ChannelEvent) => void;
}

export type DingTalkGatewayFactory = (options: DingTalkGatewayFactoryOptions) => DingTalkGateway;

export const createOfficialDingTalkGateway: DingTalkGatewayFactory = (options) =>
  new OfficialDingTalkGateway(options);

class OfficialDingTalkGateway implements DingTalkGateway {
  private readonly pluginId: string;
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly handleStreamEvent: (raw: unknown) => void;
  private readonly notify: (event: ChannelEvent) => void;
  private client: DWClient | null = null;

  constructor(options: DingTalkGatewayFactoryOptions) {
    this.pluginId = options.pluginId;
    this.appKey = options.appKey;
    this.appSecret = options.appSecret;
    this.handleStreamEvent = options.handleStreamEvent;
    this.notify = options.notify;
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    const client = new DWClient({
      clientId: this.appKey,
      clientSecret: this.appSecret,
      keepAlive: true,
      debug: false,
    });
    client.registerCallbackListener(TOPIC_ROBOT, (message) => {
      this.handleRobotMessage(client, message);
    });
    this.client = client;

    try {
      await client.connect();
    } catch (error) {
      this.client = null;
      this.safeNotify({
        type: 'error',
        pluginId: this.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  stop(): void {
    const current = this.client;
    this.client = null;
    current?.disconnect();
  }

  private handleRobotMessage(client: DWClient, message: DWClientDownStream): void {
    this.handleStreamEvent(message);
    client.send(message.headers.messageId, { response: {} });
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (error) {
      console.warn('[dingtalk] gateway notify handler threw', {
        pluginId: this.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
