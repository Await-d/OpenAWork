import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoReplyPipeline } from '../../channels/auto-reply.js';
import { channelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  MessagingChannelService,
} from '../../channels/types.js';

interface FakeServiceOptions {
  supportsStreaming?: boolean;
  sendMessage?: (chatId: string, content: string) => Promise<{ messageId: string }>;
}

class FakeService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'telegram';
  readonly supportsStreaming: boolean;
  private opts: FakeServiceOptions;

  constructor(pluginId: string, opts: FakeServiceOptions) {
    this.pluginId = pluginId;
    this.opts = opts;
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
  async replyMessage(): Promise<{ messageId: string }> {
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

/** Install a fake service into the singleton manager via a one-off factory. */
async function installFakeService(
  id: string,
  service: MessagingChannelService,
): Promise<void> {
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
    const sendMessage = vi.fn(
      (_chatId: string, _content: string): Promise<{ messageId: string }> =>
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
});
