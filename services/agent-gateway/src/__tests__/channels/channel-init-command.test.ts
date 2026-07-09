import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoReplyPipeline } from '../../channels/auto-reply.js';
import { channelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  MessagingChannelService,
} from '../../channels/types.js';

class InitCommandService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'telegram';
  readonly sentMessages: Array<{ readonly chatId: string; readonly content: string }> = [];

  constructor(pluginId: string) {
    this.pluginId = pluginId;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  isRunning(): boolean {
    return true;
  }
  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    this.sentMessages.push({ chatId, content });
    return { messageId: `sent-${this.sentMessages.length}` };
  }
  async replyMessage(): Promise<{ messageId: string }> {
    return { messageId: 'reply-1' };
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
    name: 'Init Channel',
    enabled: true,
    config: {},
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'user-1',
    createdAt: 0,
    updatedAt: 0,
  };
}

function messageEvent(pluginId: string, content: string): ChannelEvent {
  return {
    type: 'message',
    pluginId,
    message: {
      id: 'init-message-1',
      senderId: 'sender-1',
      senderName: 'Sender',
      chatId: 'chat-1',
      content,
      timestamp: Date.now(),
    },
  };
}

afterEach(async () => {
  await channelManager.stopAll();
  vi.restoreAllMocks();
});

describe('channel /init command', () => {
  it('Given channel init command When handled Then it acknowledges and delegates enriched init prompt to agent loop', async () => {
    const service = new InitCommandService('channel-init-1');
    channelManager.registerFactory('telegram', () => service);
    await channelManager.startPlugin(makeInstance('channel-init-1'), () => undefined);
    const agentMessages: string[] = [];
    const pipeline = new AutoReplyPipeline({
      resolveChannel: () => makeInstance('channel-init-1'),
      onAgentRun: async (input) => {
        agentMessages.push(input.message);
        return 'init done';
      },
    });

    await pipeline.handle(messageEvent('channel-init-1', '/init keep existing voice notes'));

    expect(service.sentMessages[0]?.content).toContain('Initializing workspace memory templates');
    expect(agentMessages).toHaveLength(1);
    expect(agentMessages[0]).toContain('AGENTS.md');
    expect(agentMessages[0]).toContain('SOUL.md');
    expect(agentMessages[0]).toContain('keep existing voice notes');
    expect(service.sentMessages.at(-1)?.content).toBe('init done');
  });
});
