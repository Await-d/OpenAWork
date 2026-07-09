import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoReplyPipeline, type ChannelCommandActions } from '../../channels/auto-reply.js';
import { channelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  MessagingChannelService,
} from '../../channels/types.js';

interface FakeServiceOptions {
  supportsStreaming?: boolean;
  pluginType?: string;
  sendMessage?: (chatId: string, content: string) => Promise<{ messageId: string }>;
  replyMessage?: (messageId: string, content: string) => Promise<{ messageId: string }>;
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
