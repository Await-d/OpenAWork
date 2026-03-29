import type {
  ChannelEvent,
  ChannelGroup,
  ChannelInstance,
  ChannelMessage,
  ChannelServiceFactory,
  ChannelStreamingHandle,
  MessagingChannelService,
} from './types.js';

type SlackApp = {
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
  message(pattern: string | RegExp, handler: SlackMessageHandler): void;
  command(cmd: string, handler: SlackCommandHandler): void;
  client: SlackWebClient;
};

type SlackMessageHandler = (params: { message: SlackMessage; say: SayFn }) => Promise<void> | void;

type SlackCommandHandler = (params: {
  command: { channel_id: string; user_id: string; text: string };
  ack: () => Promise<void>;
  say: SayFn;
}) => Promise<void> | void;

type SayFn = (text: string) => Promise<{ ts: string; channel: string }>;

type SlackMessage = {
  ts: string;
  channel: string;
  user?: string;
  text?: string;
  username?: string;
};

type SlackWebClient = {
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
      thread_ts?: string;
    }): Promise<{ ts: string }>;
    update(args: { channel: string; ts: string; text: string }): Promise<unknown>;
  };
  conversations: {
    list(): Promise<{ channels?: Array<{ id: string; name: string; num_members?: number }> }>;
    history(args: { channel: string; limit?: number }): Promise<{ messages?: SlackMessage[] }>;
  };
};

type BoltConstructor = new (options: {
  token: string;
  signingSecret: string;
  socketMode?: boolean;
  appToken?: string;
}) => SlackApp;

const STREAMING_EDIT_INTERVAL_MS = 1500;

async function loadBolt(): Promise<{ App: BoltConstructor }> {
  return (await import('@slack/bolt')) as { App: BoltConstructor };
}

export class SlackChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'slack';
  readonly supportsStreaming = true;

  private app: SlackApp | null = null;
  private running = false;
  private notify: (event: ChannelEvent) => void;
  private instance: ChannelInstance;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.instance = instance;
    this.notify = notify;
  }

  async start(): Promise<void> {
    const { App } = await loadBolt();
    const token = this.instance.config['botToken'];
    const signingSecret = this.instance.config['signingSecret'];
    const appToken = this.instance.config['appToken'];
    if (!token) throw new Error('SlackChannelService: botToken is required in config');
    if (!signingSecret) throw new Error('SlackChannelService: signingSecret is required in config');
    this.app = new App({
      token,
      signingSecret,
      socketMode: Boolean(appToken),
      appToken,
    });
    this.registerHandlers();
    await this.app.start(Number(this.instance.config['port'] ?? 3000));
    this.running = true;
  }

  async stop(): Promise<void> {
    await this.app?.stop();
    this.app = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    const res = await this.client().chat.postMessage({ channel: chatId, text: content });
    return { messageId: res.ts };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const parts = messageId.split(':');
    const channel = parts[0] ?? messageId;
    const threadTs = parts[1];
    const res = await this.client().chat.postMessage({
      channel,
      text: content,
      thread_ts: threadTs,
    });
    return { messageId: res.ts };
  }

  async getGroupMessages(chatId: string, count?: number): Promise<ChannelMessage[]> {
    const res = await this.client().conversations.history({
      channel: chatId,
      limit: count ?? 50,
    });
    return (res.messages ?? []).map((m) => this.toChannelMessage(m, chatId));
  }

  async listGroups(): Promise<ChannelGroup[]> {
    const res = await this.client().conversations.list();
    return (res.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      memberCount: c.num_members,
    }));
  }

  async sendStreamingMessage(
    chatId: string,
    initialContent: string,
    _replyToMessageId?: string,
  ): Promise<ChannelStreamingHandle> {
    const res = await this.client().chat.postMessage({
      channel: chatId,
      text: initialContent || '...',
    });
    const postedTs = res.ts;
    let lastEditAt = Date.now();

    return {
      update: async (content: string): Promise<void> => {
        const now = Date.now();
        if (now - lastEditAt < STREAMING_EDIT_INTERVAL_MS) return;
        lastEditAt = now;
        await this.client().chat.update({ channel: chatId, ts: postedTs, text: content });
      },
      finish: async (finalContent: string): Promise<void> => {
        await this.client().chat.update({ channel: chatId, ts: postedTs, text: finalContent });
      },
    };
  }

  private client(): SlackWebClient {
    if (!this.app) throw new Error('SlackChannelService is not started');
    return this.app.client;
  }

  private toChannelMessage(m: SlackMessage, chatId: string): ChannelMessage {
    return {
      id: m.ts,
      senderId: m.user ?? 'unknown',
      senderName: m.username ?? m.user ?? 'Unknown',
      chatId,
      content: m.text ?? '',
      timestamp: Math.floor(Number(m.ts) * 1000),
      raw: m,
    };
  }

  private registerHandlers(): void {
    if (!this.app) return;

    this.app.command('/new', async ({ ack, say }) => {
      await ack();
      await say('New session started.');
    });

    this.app.command('/status', async ({ ack, say }) => {
      await ack();
      await say('System is running.');
    });

    this.app.command('/plan', async ({ ack, say }) => {
      await ack();
      await say('No active plan in this session.');
    });

    this.app.command('/approve', async ({ ack, say }) => {
      await ack();
      await say('Approval registered.');
    });

    this.app.command('/deny', async ({ ack, say }) => {
      await ack();
      await say('Action denied.');
    });

    this.app.command('/history', async ({ ack, say }) => {
      await ack();
      await say('No session history available yet.');
    });

    this.app.message(/.*/, async ({ message }) => {
      if (!message.user) return;
      const msg = this.toChannelMessage(message, message.channel);
      this.notify({ type: 'message', pluginId: this.pluginId, message: msg });
    });
  }
}

export const slackFactory: ChannelServiceFactory = (instance, notify) =>
  new SlackChannelService(instance, notify);
