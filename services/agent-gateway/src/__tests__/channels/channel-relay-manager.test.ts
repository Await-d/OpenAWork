import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  ChannelStatus,
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

class RecoverableService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'telegram';
  private running = false;

  constructor(
    pluginId: string,
    private readonly notify: (event: ChannelEvent) => void,
    private readonly startResult: 'ok' | 'fail',
  ) {
    this.pluginId = pluginId;
  }

  async start(): Promise<void> {
    if (this.startResult === 'fail') {
      this.running = false;
      throw new Error(`start failed for ${this.pluginId}`);
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  emitStatus(status: ChannelStatus): void {
    this.running = status === 'running';
    this.notify({ type: 'status', pluginId: this.pluginId, status });
  }

  emitError(error: string): void {
    this.notify({ type: 'error', pluginId: this.pluginId, error });
  }

  async sendMessage(): Promise<{ messageId: string }> {
    return { messageId: 'recoverable' };
  }

  async replyMessage(): Promise<{ messageId: string }> {
    return { messageId: 'recoverable' };
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

function makeAutoStartChannel(id: string): ChannelInstance {
  return {
    ...makeChannel(id),
    features: { autoReply: true, streamingReply: false, autoStart: true },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe('ChannelManager 自动恢复', () => {
  it('autoStart 通道首次启动失败后会按退避自动重试', async () => {
    vi.useFakeTimers();
    const manager = new ChannelManager();
    const events: ChannelEvent[] = [];
    const services: RecoverableService[] = [];
    let startAttempt = 0;

    manager.registerFactory('telegram', (instance, notify) => {
      startAttempt += 1;
      const service = new RecoverableService(
        instance.id,
        notify,
        startAttempt === 1 ? 'fail' : 'ok',
      );
      services.push(service);
      return service;
    });

    await expect(
      manager.startPlugin(makeAutoStartChannel('auto-restart-1'), (event) => {
        events.push(event);
      }),
    ).rejects.toThrow('start failed for auto-restart-1');

    expect(manager.getStatus('auto-restart-1')).toBe('error');
    expect(startAttempt).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(startAttempt).toBe(2);
    expect(manager.getStatus('auto-restart-1')).toBe('running');
    expect(services.at(-1)?.isRunning()).toBe(true);
    expect(events).toContainEqual({
      type: 'error',
      pluginId: 'auto-restart-1',
      error: 'start failed for auto-restart-1',
    });
    expect(events).toContainEqual({
      type: 'status',
      pluginId: 'auto-restart-1',
      status: 'running',
    });

    await manager.stopAll();
  });

  it('服务非人工停止后会自动重新拉起', async () => {
    vi.useFakeTimers();
    const manager = new ChannelManager();
    const services: RecoverableService[] = [];

    manager.registerFactory('telegram', (instance, notify) => {
      const service = new RecoverableService(instance.id, notify, 'ok');
      services.push(service);
      return service;
    });

    await manager.startPlugin(makeAutoStartChannel('auto-restart-2'), () => undefined);
    expect(services).toHaveLength(1);

    services[0]?.emitStatus('stopped');
    expect(manager.getStatus('auto-restart-2')).toBe('error');

    await vi.advanceTimersByTimeAsync(1000);

    expect(services).toHaveLength(2);
    expect(manager.getStatus('auto-restart-2')).toBe('running');
    expect(services[1]?.isRunning()).toBe(true);

    await manager.stopAll();
  });

  it('运行中的服务只上报瞬时 error 事件时不会误触发整实例重启', async () => {
    vi.useFakeTimers();
    const manager = new ChannelManager();
    const events: ChannelEvent[] = [];
    const services: RecoverableService[] = [];

    manager.registerFactory('telegram', (instance, notify) => {
      const service = new RecoverableService(instance.id, notify, 'ok');
      services.push(service);
      return service;
    });

    await manager.startPlugin(makeAutoStartChannel('auto-restart-3'), (event) => {
      events.push(event);
    });

    services[0]?.emitError('transient poll hiccup');
    await vi.advanceTimersByTimeAsync(5000);

    expect(services).toHaveLength(1);
    expect(manager.getStatus('auto-restart-3')).toBe('running');
    expect(events).toContainEqual({
      type: 'error',
      pluginId: 'auto-restart-3',
      error: 'transient poll hiccup',
    });

    await manager.stopAll();
  });
});
