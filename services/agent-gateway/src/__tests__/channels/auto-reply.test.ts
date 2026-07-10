import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoReplyPipeline, type ChannelCommandActions } from '../../channels/auto-reply.js';
import { channelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  ChannelStreamingHandle,
  MessagingChannelService,
} from '../../channels/types.js';

interface FakeServiceOptions {
  supportsStreaming?: boolean;
  pluginType?: string;
  sendMessage?: (chatId: string, content: string) => Promise<{ messageId: string }>;
  replyMessage?: (messageId: string, content: string) => Promise<{ messageId: string }>;
  sendStreamingMessage?: (
    chatId: string,
    initialContent: string,
    replyToMessageId?: string,
  ) => Promise<ChannelStreamingHandle>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

class FakeService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType: string;
  readonly supportsStreaming: boolean;
  private opts: FakeServiceOptions;

  constructor(pluginId: string, opts: FakeServiceOptions) {
    this.pluginId = pluginId;
    this.opts = opts;
    this.pluginType = opts.pluginType ?? 'telegram';
    this.supportsStreaming = opts.supportsStreaming ?? false;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  isRunning(): boolean {
    return true;
  }
  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    if (this.opts.sendMessage) return this.opts.sendMessage(chatId, content);
    return { messageId: 'fake' };
  }
  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    if (this.opts.replyMessage) return this.opts.replyMessage(messageId, content);
    return { messageId: 'fake' };
  }
  async sendStreamingMessage(
    chatId: string,
    initialContent: string,
    replyToMessageId?: string,
  ): Promise<ChannelStreamingHandle> {
    if (this.opts.sendStreamingMessage) {
      return this.opts.sendStreamingMessage(chatId, initialContent, replyToMessageId);
    }
    return {
      update: async () => undefined,
      finish: async () => undefined,
    };
  }
  async getGroupMessages(): Promise<ChannelMessage[]> {
    return [];
  }
  async listGroups(): Promise<[]> {
    return [];
  }
}

function makeInstance(id: string): ChannelInstance {
  return {
    id,
    type: 'telegram',
    name: id,
    enabled: true,
    config: {},
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'user-1',
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeStreamingInstance(id: string): ChannelInstance {
  return {
    ...makeInstance(id),
    features: { autoReply: true, streamingReply: true, autoStart: false },
  };
}

function messageEvent(pluginId: string, content = 'hello'): ChannelEvent {
  return {
    type: 'message',
    pluginId,
    message: {
      id: 'm1',
      senderId: 's1',
      senderName: 'Sender',
      chatId: 'chat-1',
      content,
      timestamp: Date.now(),
    },
  };
}

function makeCommandActions(): ChannelCommandActions {
  return {
    compactConversation: vi.fn(async () => ({ content: 'Context compression completed.' })),
    getUsageStats: vi.fn(() => ({ content: 'Usage statistics ready.' })),
    resetConversation: vi.fn(() => ({ content: 'Session cleared.' })),
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

/** Install a fake service into the singleton manager via a one-off factory. */
async function installFakeService(id: string, service: MessagingChannelService): Promise<void> {
  channelManager.registerFactory('telegram', () => service);
  await channelManager.startPlugin(makeInstance(id), () => undefined);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await channelManager.stopAll();
});

describe('AutoReplyPipeline error isolation', () => {
  it('onAgentRun 抛错时把错误通知发回渠道，且 handle 不 reject', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-agent-fail';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun: async () => {
        throw new Error('upstream exploded');
      },
    });

    await expect(pipeline.handle(messageEvent(id))).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const firstCall = sendMessage.mock.calls[0];
    const sentContent = firstCall ? firstCall[1] : '';
    expect(sentContent).toContain('upstream exploded');
  });

  it('错误通知本身发送失败时被吞掉，handle 仍不 reject', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sendMessage = vi.fn((_chatId: string, _content: string): Promise<{ messageId: string }> =>
      Promise.reject(new Error('channel API unreachable')),
    );
    const id = 'tg-notice-fail';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun: async () => {
        throw new Error('primary failure');
      },
    });

    await expect(pipeline.handle(messageEvent(id))).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('onAgentRun 成功时正常发送回复', async () => {
    const sendMessage = vi.fn(async () => ({ messageId: 'ok' }));
    const id = 'tg-success';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun: async () => 'the answer',
    });

    await pipeline.handle(messageEvent(id));
    expect(sendMessage).toHaveBeenCalledWith('chat-1', 'the answer');
  });

  it('同一通道会话的自动回复串行执行，避免上一轮运行中时下一条消息被会话冲突丢弃', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-serialized-session';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const secondRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ message }: { readonly message: string }) => {
      return message === 'first' ? firstRun.promise : secondRun.promise;
    });
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    const first = pipeline.handle(messageEvent(id, 'first'));
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });

    const second = pipeline.handle(messageEvent(id, 'second'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onAgentRun).toHaveBeenCalledTimes(1);

    firstRun.resolve('reply first');
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(2);
    });
    secondRun.resolve('reply second');
    await Promise.all([first, second]);

    expect(sendMessage.mock.calls.map((call) => call[1])).toEqual(['reply first', 'reply second']);
  });

  it('不同通道会话的自动回复保持并发，不被单个会话队列全局阻塞', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-parallel-sessions';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const secondRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ chatId }: { readonly chatId: string }) => {
      return chatId === 'chat-1' ? firstRun.promise : secondRun.promise;
    });
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    const first = pipeline.handle(messageEvent(id, 'first'));
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });

    const secondEvent = messageEvent(id, 'second');
    if (secondEvent.type === 'message') {
      secondEvent.message.chatId = 'chat-2';
    }
    const second = pipeline.handle(secondEvent);

    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(2);
    });

    secondRun.resolve('reply second');
    await second;
    firstRun.resolve('reply first');
    await first;

    expect(sendMessage.mock.calls.map((call) => call[0])).toEqual(['chat-2', 'chat-1']);
  });

  it('不同插件即使 chatId 相同也保持独立队列，避免跨实例互相阻塞', async () => {
    const firstSendMessage = vi.fn(async (_chatId: string, _content: string) => ({
      messageId: 'first-ok',
    }));
    const secondSendMessage = vi.fn(async (_chatId: string, _content: string) => ({
      messageId: 'second-ok',
    }));
    const firstPluginId = 'tg-plugin-a';
    const secondPluginId = 'tg-plugin-b';
    await installFakeService(
      firstPluginId,
      new FakeService(firstPluginId, { sendMessage: firstSendMessage }),
    );
    await installFakeService(
      secondPluginId,
      new FakeService(secondPluginId, { sendMessage: secondSendMessage }),
    );
    const firstRun = createDeferred<string>();
    const secondRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ pluginId }: { readonly pluginId: string }) => {
      return pluginId === firstPluginId ? firstRun.promise : secondRun.promise;
    });
    const pipeline = new AutoReplyPipeline({
      resolveChannel: (pluginId) => makeInstance(pluginId),
      onAgentRun,
    });

    const first = pipeline.handle(messageEvent(firstPluginId, 'first'));
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });
    const second = pipeline.handle(messageEvent(secondPluginId, 'second'));

    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(2);
    });

    secondRun.resolve('reply second');
    await second;
    firstRun.resolve('reply first');
    await first;

    expect(firstSendMessage).toHaveBeenCalledWith('chat-1', 'reply first');
    expect(secondSendMessage).toHaveBeenCalledWith('chat-1', 'reply second');
  });

  it('同一通道会话队列超过上限时回复忙碌提示，避免无限积压 agent run', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-queue-depth-limit';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ message }: { readonly message: string }) => {
      return message === 'msg-1' ? firstRun.promise : Promise.resolve(`reply ${message}`);
    });
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    const tasks = [pipeline.handle(messageEvent(id, 'msg-1'))];
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });

    for (let index = 2; index <= 9; index += 1) {
      tasks.push(pipeline.handle(messageEvent(id, `msg-${index}`)));
    }

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        'chat-1',
        '当前会话正在处理较多消息，请稍后再发送。',
      );
    });
    expect(onAgentRun).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();

    firstRun.resolve('reply msg-1');
    await Promise.all(tasks);

    expect(onAgentRun).toHaveBeenCalledTimes(8);
    expect(sendMessage.mock.calls.map((call) => call[1])).toContain(
      '当前会话正在处理较多消息，请稍后再发送。',
    );

    await pipeline.handle(messageEvent(id, 'msg-10'));

    expect(onAgentRun).toHaveBeenCalledTimes(9);
    expect(sendMessage).toHaveBeenCalledWith('chat-1', 'reply msg-10');
  });

  it('streaming 自动回复也在同一通道会话内串行创建 handle 和运行 agent', async () => {
    const finishes: string[] = [];
    const updates: string[] = [];
    const sendStreamingMessage = vi.fn(
      async (
        _chatId: string,
        _initialContent: string,
        _replyToMessageId?: string,
      ): Promise<ChannelStreamingHandle> => ({
        update: async (content: string) => {
          updates.push(content);
        },
        finish: async (finalContent: string) => {
          finishes.push(finalContent);
        },
      }),
    );
    const id = 'tg-streaming-serialized-session';
    await installFakeService(
      id,
      new FakeService(id, { supportsStreaming: true, sendStreamingMessage }),
    );
    const firstRun = createDeferred<string>();
    const secondRun = createDeferred<string>();
    const onAgentRun = vi.fn(
      async ({
        message,
        onPartialText,
      }: {
        readonly message: string;
        readonly onPartialText?: (text: string) => Promise<void> | void;
      }) => {
        await onPartialText?.(`partial ${message}`);
        return message === 'first' ? firstRun.promise : secondRun.promise;
      },
    );
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeStreamingInstance(id),
      onAgentRun,
    });

    const first = pipeline.handle(messageEvent(id, 'first'));
    await vi.waitFor(() => {
      expect(sendStreamingMessage).toHaveBeenCalledTimes(1);
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });

    const second = pipeline.handle(messageEvent(id, 'second'));
    await Promise.resolve();
    await Promise.resolve();

    expect(sendStreamingMessage).toHaveBeenCalledTimes(1);
    expect(onAgentRun).toHaveBeenCalledTimes(1);

    firstRun.resolve('stream first');
    await vi.waitFor(() => {
      expect(sendStreamingMessage).toHaveBeenCalledTimes(2);
      expect(onAgentRun).toHaveBeenCalledTimes(2);
    });
    secondRun.resolve('stream second');
    await Promise.all([first, second]);

    expect(updates).toEqual(['partial first', 'partial second']);
    expect(finishes).toEqual(['stream first', 'stream second']);
  });

  it('streaming handle 创建失败不会毒化同一通道会话后续队列任务', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const finishes: string[] = [];
    let createAttempts = 0;
    const sendStreamingMessage = vi.fn(async (): Promise<ChannelStreamingHandle> => {
      createAttempts += 1;
      if (createAttempts === 1) {
        throw new Error('streaming unavailable');
      }
      return {
        update: async () => undefined,
        finish: async (finalContent: string) => {
          finishes.push(finalContent);
        },
      };
    });
    const id = 'tg-streaming-rejection-continues';
    await installFakeService(
      id,
      new FakeService(id, { supportsStreaming: true, sendStreamingMessage }),
    );
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeStreamingInstance(id),
      onAgentRun: async ({ message }) => `reply ${message}`,
    });

    const first = pipeline.handle(messageEvent(id, 'first'));
    const second = pipeline.handle(messageEvent(id, 'second'));

    await Promise.all([first, second]);

    expect(consoleSpy).toHaveBeenCalled();
    expect(sendStreamingMessage).toHaveBeenCalledTimes(2);
    expect(finishes).toEqual(['reply second']);
  });

  it('QQ 群聊自动回复使用入站 message id 进行 reply，避免 QQ API 缺少 msg_id', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'send' }));
    const replyMessage = vi.fn(async (_messageId: string, _content: string) => ({
      messageId: 'reply',
    }));
    const id = 'qq-group-reply';
    await installFakeService(
      id,
      new FakeService(id, { pluginType: 'qq', sendMessage, replyMessage }),
    );
    const event = messageEvent(id);
    if (event.type === 'message') {
      event.message.id = 'group:group-open-id|incoming-msg-id';
      event.message.chatId = 'group:group-open-id';
    }

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => ({ ...makeInstance(id), type: 'qq' }),
      onAgentRun: async () => '收到',
    });

    await pipeline.handle(event);

    expect(replyMessage).toHaveBeenCalledWith('group:group-open-id|incoming-msg-id', '收到');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('QQ 私聊自动回复也使用入站 message id 进行 reply，避免 C2C 回发缺少 msg_id', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'send' }));
    const replyMessage = vi.fn(async (_messageId: string, _content: string) => ({
      messageId: 'reply',
    }));
    const id = 'qq-c2c-reply';
    await installFakeService(
      id,
      new FakeService(id, { pluginType: 'qq', sendMessage, replyMessage }),
    );
    const event = messageEvent(id);
    if (event.type === 'message') {
      event.message.id = 'c2c:user-open-id|incoming-msg-id';
      event.message.chatId = 'c2c:user-open-id';
    }

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => ({ ...makeInstance(id), type: 'qq' }),
      onAgentRun: async () => '收到',
    });

    await pipeline.handle(event);

    expect(replyMessage).toHaveBeenCalledWith('c2c:user-open-id|incoming-msg-id', '收到');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('AutoReplyPipeline built-in commands', () => {
  it('/stats 直接回复渠道，不进入 agent loop', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const commandActions = makeCommandActions();
    const id = 'tg-stats';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      commandActions,
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '/stats'));

    expect(onAgentRun).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const firstCall = sendMessage.mock.calls[0];
    const sentContent = firstCall ? firstCall[1] : '';
    expect(sentContent).toContain('Usage statistics');
    expect(commandActions.getUsageStats).toHaveBeenCalledWith({
      channel: makeInstance(id),
      chatId: 'chat-1',
    });
  });

  it('/compress 直接回复渠道，不进入 agent loop', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const commandActions = makeCommandActions();
    const id = 'tg-compress';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      commandActions,
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '/compress'));

    expect(onAgentRun).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const firstCall = sendMessage.mock.calls[0];
    const sentContent = firstCall ? firstCall[1] : '';
    expect(sentContent).toContain('Context compression');
    expect(commandActions.compactConversation).toHaveBeenCalledWith({
      channel: makeInstance(id),
      chatId: 'chat-1',
    });
  });

  it('/status 返回当前通道配置和会话状态，不进入 agent loop', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const id = 'tg-status';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => ({
        ...makeInstance(id),
        model: 'gpt-5-mini',
        providerId: 'openai',
      }),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '/status'));

    expect(onAgentRun).not.toHaveBeenCalled();
    const firstCall = sendMessage.mock.calls[0];
    const sentContent = firstCall ? firstCall[1] : '';
    expect(sentContent).toContain('Channel status');
    expect(sentContent).toContain(`Name: ${id}`);
    expect(sentContent).toContain('Type: telegram');
    expect(sentContent).toContain('Provider: openai');
    expect(sentContent).toContain('Model: gpt-5-mini');
    expect(sentContent).toContain('Current chat: chat-1');
    expect(sentContent).toContain('Auto reply: on');
  });

  it('群聊 @ 机器人前缀后面的命令也会被识别', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const commandActions = makeCommandActions();
    const id = 'tg-mentioned-command';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      commandActions,
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '<@123456> /stats'));

    expect(onAgentRun).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const firstCall = sendMessage.mock.calls[0];
    const sentContent = firstCall ? firstCall[1] : '';
    expect(sentContent).toContain('Usage statistics');
  });

  it('/new 直接清空当前 channel conversation', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const commandActions = makeCommandActions();
    const id = 'tg-new';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      commandActions,
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '/new'));

    expect(onAgentRun).not.toHaveBeenCalled();
    expect(commandActions.resetConversation).toHaveBeenCalledWith({
      channel: makeInstance(id),
      chatId: 'chat-1',
    });
    expect(sendMessage).toHaveBeenCalledWith('chat-1', 'Session cleared.');
  });
});
