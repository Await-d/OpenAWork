import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoReplyPipeline, type ChannelCommandActions } from '../../channels/auto-reply.js';
import { channelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  ChannelReplyLanguage,
  ChannelStreamingHandle,
  MessagingChannelService,
} from '../../channels/types.js';

interface FakeServiceOptions {
  supportsStreaming?: boolean;
  pluginType?: string;
  sendMessage?: (chatId: string, content: string) => Promise<{ messageId: string }>;
  /** 显式提供才模拟「该渠道支持主动消息」（QQ 才有）。 */
  sendWakeupMessage?: (chatId: string, content: string) => Promise<{ messageId: string }>;
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
  /** 只有显式传了才存在，用来区分「QQ 有主动消息」与「其它渠道没有」。 */
  sendWakeupMessage?: (chatId: string, content: string) => Promise<{ messageId: string }>;
  private opts: FakeServiceOptions;

  constructor(pluginId: string, opts: FakeServiceOptions) {
    this.pluginId = pluginId;
    this.opts = opts;
    this.pluginType = opts.pluginType ?? 'telegram';
    this.supportsStreaming = opts.supportsStreaming ?? false;
    if (opts.sendWakeupMessage) {
      this.sendWakeupMessage = opts.sendWakeupMessage;
    }
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

function makeInstance(id: string, replyLanguage: ChannelReplyLanguage = 'zh-CN'): ChannelInstance {
  return {
    id,
    type: 'telegram',
    name: id,
    enabled: true,
    config: {},
    replyLanguage,
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'user-1',
    createdAt: 0,
    updatedAt: 0,
  };
}

/** QQ 实例：被动回复（带 `msg_id`）+ 有主动消息能力。 */
function makeQQInstance(id: string): ChannelInstance {
  return { ...makeInstance(id), type: 'qq' };
}

function makeStreamingInstance(
  id: string,
  replyLanguage: ChannelReplyLanguage = 'zh-CN',
): ChannelInstance {
  return {
    ...makeInstance(id, replyLanguage),
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

  it('非流式渠道运行超过阈值时先发「仍在处理」回执，结束后再发完整结果', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-pending-notice';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const run = createDeferred<string>();
    const pipeline = new AutoReplyPipeline({
      pendingNoticeDelayMs: 20,
      resolveChannel: () => makeInstance(id),
      onAgentRun: async () => run.promise,
    });

    const handling = pipeline.handle(messageEvent(id));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('**仍在处理中**'));
    });

    run.resolve('最终结果');
    await handling;
    expect(sendMessage.mock.calls.map((call) => call[1])).toEqual([
      expect.stringContaining('**仍在处理中**'),
      '最终结果',
    ]);
  });

  it('短任务不发「仍在处理」回执（定时器在结束时被取消）', async () => {
    const sendMessage = vi.fn(async () => ({ messageId: 'ok' }));
    const id = 'tg-pending-notice-fast';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const pipeline = new AutoReplyPipeline({
      pendingNoticeDelayMs: 20,
      resolveChannel: () => makeInstance(id),
      onAgentRun: async () => 'quick answer',
    });

    await pipeline.handle(messageEvent(id));
    // 给阈值定时器留出触发机会：若没被取消，这里会多出一条回执。
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('chat-1', 'quick answer');
  });

  it('QQ 被动回复失败时改用主动消息兜底投递结果', async () => {
    const replyMessage = vi.fn(async (_messageId: string, _content: string) => {
      throw new Error('msg_id expired');
    });
    const sendWakeupMessage = vi.fn(async (_chatId: string, _content: string) => ({
      messageId: 'wake-1',
    }));
    const id = 'qq-passive-expired';
    await installFakeService(id, new FakeService(id, { replyMessage, sendWakeupMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeQQInstance(id),
      onAgentRun: async () => '最终结果',
    });

    const event = messageEvent(id);
    if (event.type === 'message') {
      event.message.id = 'chat-1|msg-9';
    }

    await expect(pipeline.handle(event)).resolves.toBeUndefined();
    expect(replyMessage).toHaveBeenCalledWith('chat-1|msg-9', '最终结果');
    // 被动回复失败不能把结果吞掉：结果只在会话里可见、IM 里收不到才是最差的结果。
    expect(sendWakeupMessage).toHaveBeenCalledWith('chat-1', '最终结果');
  });

  it('QQ 被动回复与主动消息都失败时落库两次错误且 handle 不 reject', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const replyMessage = vi.fn(async (_messageId: string, _content: string) => {
      throw new Error('msg_id expired');
    });
    const sendWakeupMessage = vi.fn(async (_chatId: string, _content: string) => {
      throw new Error('wakeup quota exhausted');
    });
    const id = 'qq-both-failed';
    await installFakeService(id, new FakeService(id, { replyMessage, sendWakeupMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeQQInstance(id),
      onAgentRun: async () => '最终结果',
    });

    const event = messageEvent(id);
    if (event.type === 'message') {
      event.message.id = 'chat-1|msg-9';
    }

    await expect(pipeline.handle(event)).resolves.toBeUndefined();
    // 结果投递与随后的「错误通知」投递都会尝试兜底，故只断言「至少尝试过」。
    expect(sendWakeupMessage).toHaveBeenCalled();
    expect(sendWakeupMessage).toHaveBeenCalledWith('chat-1', expect.any(String));
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('图片附件会作为 inputParts 传给 channel session 运行', async () => {
    const sendMessage = vi.fn(async () => ({ messageId: 'ok' }));
    const id = 'tg-image-input';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const onAgentRun = vi.fn(async () => '看到了图片');
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle({
      type: 'message',
      pluginId: id,
      message: {
        id: 'm1',
        senderId: 's1',
        senderName: 'Sender',
        chatId: 'chat-1',
        content: '[User sent an image]',
        timestamp: Date.now(),
        images: [
          {
            base64: Buffer.from('image').toString('base64'),
            mediaType: 'image/png',
          },
        ],
      },
    });

    expect(onAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        inputParts: [
          expect.objectContaining({
            imageUrl: expect.stringContaining('data:image/png;base64,'),
            mimeType: 'image/png',
            type: 'input_image',
          }),
        ],
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith('chat-1', '看到了图片');
  });

  it('关闭插话开关时同一通道会话的自动回复串行执行，避免上一轮运行中时下一条消息被会话冲突丢弃', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-serialized-session';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const secondRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ message }: { readonly message: string }) => {
      return message === 'first' ? firstRun.promise : secondRun.promise;
    });
    const pipeline = new AutoReplyPipeline({
      interruptOnNewMessage: false,
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

    // 第二条消息等待期间会先收到一条「已排队」回执（见下方排队可见性用例）。
    expect(sendMessage.mock.calls.map((call) => call[1])).toEqual([
      expect.stringContaining('**消息已排队**'),
      'reply first',
      'reply second',
    ]);
  });

  it('新消息打断同一会话正在执行的轮次：上一轮被 abort 且不发回复，最新这条立刻开跑', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-interrupt-running';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const secondRun = createDeferred<string>();
    const firstSignals: AbortSignal[] = [];
    const onAgentRun = vi.fn(
      ({ message, signal }: { readonly message: string; readonly signal?: AbortSignal }) => {
        if (message === 'first') {
          if (signal) firstSignals.push(signal);
          // 真实实现会在 abort 时停下本轮，并以作废结果 settle（router 拿到 cancelled）。
          signal?.addEventListener('abort', () => firstRun.resolve('已作废的上一轮答复'), {
            once: true,
          });
          return firstRun.promise;
        }
        return secondRun.promise;
      },
    );
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    const first = pipeline.handle(messageEvent(id, 'first'));
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });

    const second = pipeline.handle(messageEvent(id, 'second'));
    await vi.waitFor(() => {
      expect(firstSignals[0]?.aborted).toBe(true);
    });
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(2);
    });

    secondRun.resolve('reply second');
    await Promise.all([first, second]);

    // 被抢占那一轮的答复必须丢弃：用户只应看到「已打断上一轮」与最新一条的答案。
    expect(sendMessage.mock.calls.map((call) => call[1])).toEqual([
      expect.stringContaining('**已打断上一轮**'),
      'reply second',
    ]);
  });

  it('排队中的消息被更新的消息抢占：整轮跳过，一条回复都不发', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-interrupt-queued';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ message }: { readonly message: string }) =>
      message === 'first' ? firstRun.promise : Promise.resolve(`reply ${message}`),
    );
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    const first = pipeline.handle(messageEvent(id, 'first'));
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });

    // 第二条抢占第一条后排队；第三条再把第二条一起打断。让出一个宏任务，
    // 确保每条的入队都已完成，再发下一条。
    const second = pipeline.handle(messageEvent(id, 'second'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const third = pipeline.handle(messageEvent(id, 'third'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    firstRun.resolve('已作废的上一轮答复');
    await Promise.all([first, second, third]);

    // 只有最新一条真正执行：'second' 被跳过，不产生任何调用。
    expect(onAgentRun.mock.calls.map((call) => call[0]?.message)).toEqual(['first', 'third']);
    expect(sendMessage.mock.calls.map((call) => call[1])).toEqual([
      expect.stringContaining('**已打断上一轮**'),
      expect.stringContaining('**已打断上一轮**'),
      'reply third',
    ]);
  });

  it('关闭插话开关时上一轮未结束会回执排队状态，并在开始执行时记录队列深度与等待时长', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-queued-feedback';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ message }: { readonly message: string }) => {
      return message === 'first' ? firstRun.promise : Promise.resolve('reply second');
    });
    const pipeline = new AutoReplyPipeline({
      interruptOnNewMessage: false,
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    const first = pipeline.handle(messageEvent(id, 'first'));
    await vi.waitFor(() => {
      expect(onAgentRun).toHaveBeenCalledTimes(1);
    });

    const second = pipeline.handle(messageEvent(id, 'second'));

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('**消息已排队**'));
    });
    // 回执只表示「已收下、在排队」，此时第二条仍未开始执行。
    expect(onAgentRun).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('auto-reply queued behind running session task'),
      expect.objectContaining({ queuedAhead: 1 }),
    );

    firstRun.resolve('reply first');
    await Promise.all([first, second]);

    const queuedRunLog = infoSpy.mock.calls.find((call) => {
      const details = call[1] as { queuedAhead?: number } | undefined;
      return (
        typeof call[0] === 'string' &&
        call[0].includes('auto-reply agent run started') &&
        details?.queuedAhead === 1
      );
    });
    expect(queuedRunLog?.[1]).toMatchObject({ queuedAhead: 1 });
    expect(typeof (queuedRunLog?.[1] as { waitMs?: unknown } | undefined)?.waitMs).toBe('number');
    expect(sendMessage.mock.calls.map((call) => call[1])).toEqual([
      expect.stringContaining('**消息已排队**'),
      'reply first',
      'reply second',
    ]);
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

  it('关闭插话开关时同一通道会话队列超过上限才回复忙碌提示，避免无限积压 agent run', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const id = 'tg-queue-depth-limit';
    await installFakeService(id, new FakeService(id, { sendMessage }));
    const firstRun = createDeferred<string>();
    const onAgentRun = vi.fn(({ message }: { readonly message: string }) => {
      return message === 'msg-1' ? firstRun.promise : Promise.resolve(`reply ${message}`);
    });
    const pipeline = new AutoReplyPipeline({
      interruptOnNewMessage: false,
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
      expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('**会话繁忙**'));
    });
    expect(onAgentRun).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();

    firstRun.resolve('reply msg-1');
    await Promise.all(tasks);

    expect(onAgentRun).toHaveBeenCalledTimes(8);
    expect(sendMessage.mock.calls.some((call) => call[1]?.includes('**会话繁忙**'))).toBe(true);

    await pipeline.handle(messageEvent(id, 'msg-10'));

    expect(onAgentRun).toHaveBeenCalledTimes(9);
    expect(sendMessage).toHaveBeenCalledWith('chat-1', 'reply msg-10');
  });

  it('关闭插话开关时 streaming 自动回复也在同一通道会话内串行创建 handle 和运行 agent', async () => {
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
      interruptOnNewMessage: false,
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

  it('关闭插话开关时 streaming handle 创建失败不会毒化同一通道会话后续队列任务', async () => {
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
      interruptOnNewMessage: false,
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
  it('/help 和帮助关键词都会直接回复统一命令列表', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const id = 'tg-help';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '帮助'));

    expect(onAgentRun).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const firstCall = sendMessage.mock.calls[0];
    const sentContent = firstCall ? firstCall[1] : '';
    expect(sentContent).toContain('**快捷指令**');
    expect(sentContent).toContain('`/help`');
    expect(sentContent).toContain('`/new`');
    expect(sentContent).toContain('当前平台：Telegram');
    expect(sentContent).toContain('输入框里输入 `/`');
    expect(sentContent).toContain('关键词兜底：直接发送 `帮助`');
  });

  it('英文回复语言下 /help 直接返回英文命令列表', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const id = 'tg-help-en';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance(id, 'en-US'),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '/help'));

    expect(onAgentRun).not.toHaveBeenCalled();
    const sentContent = sendMessage.mock.calls[0]?.[1] ?? '';
    expect(sentContent).toContain('**Quick commands**');
    expect(sentContent).toContain('Platform: Telegram');
    expect(sentContent).toContain('Universal fallback: send `/help` as a normal message');
  });

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
    expect(commandActions.getUsageStats).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: makeInstance(id),
        chatId: 'chat-1',
        replyLanguage: 'zh-CN',
      }),
    );
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
    expect(commandActions.compactConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: makeInstance(id),
        chatId: 'chat-1',
        replyLanguage: 'zh-CN',
      }),
    );
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
    expect(sentContent).toContain('**通道状态**');
    expect(sentContent).toContain('**概览**');
    expect(sentContent).toContain(`- 名称：\`${id}\``);
    expect(sentContent).toContain('- 类型：`telegram`');
    expect(sentContent).toContain('- Provider：`openai`');
    expect(sentContent).toContain('- Model：`gpt-5-mini`');
    expect(sentContent).toContain('- 当前会话：`chat-1`');
    expect(sentContent).toContain('- 自动回复：`开启`');
  });

  it('英文回复语言下 /status 返回英文状态信息', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const id = 'tg-status-en';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => ({
        ...makeInstance(id, 'en-US'),
        model: 'gpt-5-mini',
        providerId: 'openai',
      }),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '/status'));

    expect(onAgentRun).not.toHaveBeenCalled();
    const sentContent = sendMessage.mock.calls[0]?.[1] ?? '';
    expect(sentContent).toContain('**Channel status**');
    expect(sentContent).toContain(`- Name: \`${id}\``);
    expect(sentContent).toContain('- Reply language: `English (en-US)`');
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
    expect(commandActions.getUsageStats).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: makeInstance(id),
        chatId: 'chat-1',
        replyLanguage: 'zh-CN',
      }),
    );
  });

  it('Telegram 群聊 /command@bot 形式也会命中内置命令', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const commandActions = makeCommandActions();
    const id = 'tg-native-command';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      commandActions,
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '/stats@OpenAWorkBot'));

    expect(onAgentRun).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentContent = sendMessage.mock.calls[0]?.[1] ?? '';
    expect(sentContent).toContain('Usage statistics');
    expect(commandActions.getUsageStats).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: makeInstance(id),
        chatId: 'chat-1',
        replyLanguage: 'zh-CN',
      }),
    );
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
    expect(commandActions.resetConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: makeInstance(id),
        chatId: 'chat-1',
        replyLanguage: 'zh-CN',
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith('chat-1', 'Session cleared.');
  });

  it('新对话 作为文本兜底也会清空当前 channel conversation', async () => {
    const sendMessage = vi.fn(async (_chatId: string, _content: string) => ({ messageId: 'ok' }));
    const onAgentRun = vi.fn(async () => 'should not run');
    const commandActions = makeCommandActions();
    const id = 'tg-new-keyword';
    await installFakeService(id, new FakeService(id, { sendMessage }));

    const pipeline = new AutoReplyPipeline({
      commandActions,
      resolveChannel: () => makeInstance(id),
      onAgentRun,
    });

    await pipeline.handle(messageEvent(id, '新对话'));

    expect(onAgentRun).not.toHaveBeenCalled();
    expect(commandActions.resetConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: makeInstance(id),
        chatId: 'chat-1',
        replyLanguage: 'zh-CN',
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith('chat-1', 'Session cleared.');
  });
});
