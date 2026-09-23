import { randomUUID } from 'node:crypto';
import type {
  ChannelEvent,
  ChannelGroup,
  ChannelInstance,
  ChannelMessage,
  ChannelServiceFactory,
  ChannelStreamingHandle,
  FeishuFileType,
  MessagingChannelService,
} from './types.js';
import { listBuiltinChannelCommands } from './channel-command-experience.js';
import { parseSlackInboundMessage } from './inbound-parsers/slack.js';
import { attachSlackInboundImages, sendSlackFile, type SlackUploadClient } from './slack-media.js';

type SlackApp = {
  start(port?: number): Promise<unknown>;
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
  files?: unknown[];
};

type SlackWebClient = {
  auth: {
    test(): Promise<{ user_id?: string }>;
  };
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
  files: SlackUploadClient['files'];
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
  private botUserId: string | undefined;

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
    await this.resolveBotUserId();
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

  /**
   * 出站发送文件：走 Slack `files.uploadV2`（bot token 需具备 `files:write`
   * scope），`text` 非空时作为 `initial_comment` 随文件投递。
   *
   * `fileType` 按接口保留但不使用——Slack 由文件本身推断类型；`signal` 同样按
   * 接口保留——`uploadV2` 内部的三段请求不暴露 AbortSignal 透传点，故不下传。
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
    return sendSlackFile({
      client: this.client(),
      channelId: chatId,
      buffer: input.buffer,
      fileName: input.fileName,
      ...(input.text ? { text: input.text } : {}),
    });
  }

  /**
   * 出站发送图片：与 `sendFile` 共用 `files.uploadV2`（bot token 需具备
   * `files:write` scope），`fileName` 缺省为 `image.png`，`text` 非空时作为
   * `initial_comment` 随图投递。
   *
   * `signal` / `sourceUrl` 按接口保留但不透传——`uploadV2` 内部的三段请求不暴露
   * AbortSignal 透传点（与既有 `sendFile` 一致）；图片字节由调用方先取好后经
   * `buffer` 传入，故无需再消费 `sourceUrl`。
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
    return sendSlackFile({
      client: this.client(),
      channelId: chatId,
      buffer: input.buffer,
      fileName: input.fileName ?? 'image.png',
      ...(input.text ? { text: input.text } : {}),
    });
  }

  /**
   * 回复图片。messageId 格式与 `replyMessage` 一致，为 `<channelId>:<ts>`：
   * Slack 是线程模型，回复历史消息即把文件挂到该消息的线程（`thread_ts`），
   * 而不是引用展示。格式不合法时直接抛错、不发任何请求。
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
    const [channelId, threadTs] = messageId.split(':');
    if (!channelId || !threadTs) {
      throw new Error('Slack image reply requires "<channelId>:<ts>" reference');
    }
    return sendSlackFile({
      client: this.client(),
      channelId,
      buffer: input.buffer,
      fileName: input.fileName ?? 'image.png',
      ...(input.text ? { text: input.text } : {}),
      threadTs,
    });
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

  private async resolveBotUserId(): Promise<void> {
    const configuredBotUserId = this.instance.config['botUserId']?.trim();
    if (configuredBotUserId) {
      this.botUserId = configuredBotUserId;
      return;
    }
    try {
      const result = await this.client().auth.test();
      this.botUserId = result.user_id?.trim() || undefined;
    } catch (error) {
      console.warn(
        `[slack] auth.test failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.botUserId = undefined;
    }
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

    // 斜杠命令与其它渠道统一走共享命令管线：先 ack 满足 Slack 的三秒约束，
    // 再把命令合成为标准 ChannelMessage 交给 notify，由 auto-reply 管线调用
    // 内置命令处理器；这里不再直接 say 任何固定话术。
    for (const descriptor of listBuiltinChannelCommands()) {
      const trigger = descriptor.canonicalTrigger;
      this.app.command(trigger, async ({ ack, command }) => {
        await ack();
        const trimmed = command.text.trim();
        const message: ChannelMessage = {
          id: randomUUID(),
          senderId: command.user_id,
          senderName: command.user_id,
          chatId: command.channel_id,
          content: trimmed.length > 0 ? `${trigger} ${trimmed}` : trigger,
          timestamp: Date.now(),
          raw: command,
        };
        this.notify({ type: 'message', pluginId: this.pluginId, message });
      });
    }

    this.app.message(/.*/, async ({ message }) => {
      const msg = parseSlackInboundMessage(message, {
        channel: this.instance,
        botId: this.botUserId,
      });
      if (!msg) return;
      // Slack 入站不经过通用路由的 enrich 钩子：在此处下载图片（base64）后
      // 再 notify；下载失败不影响文本投递（attach 内部降级为原消息）。
      const enriched = await attachSlackInboundImages({
        token: this.instance.config['botToken'] ?? '',
        message: msg,
        raw: message,
      });
      this.notify({ type: 'message', pluginId: this.pluginId, message: enriched });
    });
  }
}

export const slackFactory: ChannelServiceFactory = (instance, notify) =>
  new SlackChannelService(instance, notify);
