import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  MessagingChannelService,
} from '../../channels/types.js';

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCount = 0;

  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  emitMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

class FakeService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'telegram';
  private running = false;

  constructor(pluginId: string) {
    this.pluginId = pluginId;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(): Promise<{ messageId: string }> {
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

function makeChannel(id: string): ChannelInstance {
  return {
    id,
    type: 'telegram',
    name: 'Relay Telegram',
    enabled: true,
    config: { wsUrl: 'wss://relay.example/ws' },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    createdAt: 0,
    updatedAt: 0,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
});

describe('ChannelManager relay wiring', () => {
  it('启动配置了 wsUrl 和 parser 的通道时连接 relay 并派发入站消息', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const manager = new ChannelManager();
    const events: ChannelEvent[] = [];
    manager.registerFactory('telegram', (instance) => new FakeService(instance.id));
    manager.registerParser('telegram', (raw) => {
      if (typeof raw !== 'string') {
        return null;
      }
      const data = JSON.parse(raw) as { chatId: string; content: string; messageId: string };
      return {
        id: data.messageId,
        chatId: data.chatId,
        senderId: 'relay-user',
        senderName: 'Relay User',
        content: data.content,
        timestamp: Date.now(),
      };
    });

    await manager.startPlugin(makeChannel('relay-1'), (event) => {
      events.push(event);
    });
    const socket = FakeWebSocket.instances[0];
    expect(socket?.url).toBe('wss://relay.example/ws');

    socket?.emitOpen();
    socket?.emitMessage(JSON.stringify({ chatId: 'chat-1', content: 'hello', messageId: 'm1' }));
    await Promise.resolve();

    expect(events).toContainEqual({
      type: 'status',
      pluginId: 'relay-1',
      status: 'running',
    });
    const messageEvent = events.find((event) => event.type === 'message');
    expect(messageEvent).toMatchObject({
      type: 'message',
      pluginId: 'relay-1',
      message: { id: 'm1', chatId: 'chat-1', content: 'hello' },
    });

    await manager.stopPlugin('relay-1');
    expect(socket?.closeCount).toBe(1);
  });

  it('没有 parser 时不连接 relay，避免无法解析的入站流触发 Agent', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const manager = new ChannelManager();
    manager.registerFactory('telegram', (instance) => new FakeService(instance.id));

    await manager.startPlugin(makeChannel('relay-no-parser'), () => undefined);

    expect(FakeWebSocket.instances).toHaveLength(0);
    await manager.stopAll();
  });
});
