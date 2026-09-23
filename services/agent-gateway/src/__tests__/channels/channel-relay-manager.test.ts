import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelRelay } from '../../channels/channel-relay.js';
import { ChannelManager } from '../../channels/manager.js';
import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  ChannelStatus,
  ChannelWsMessageParser,
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

class MediaService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'telegram';
  readonly enrichCalls: ChannelMessage[] = [];
  private running = false;

  constructor(
    pluginId: string,
    private readonly handleEnrich: (message: ChannelMessage) => Promise<ChannelMessage>,
  ) {
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
    return { messageId: 'media' };
  }

  async replyMessage(): Promise<{ messageId: string }> {
    return { messageId: 'media' };
  }

  async getGroupMessages(): Promise<ChannelMessage[]> {
    return [];
  }

  async listGroups(): Promise<[]> {
    return [];
  }

  async enrichInboundMessage(message: ChannelMessage): Promise<ChannelMessage> {
    this.enrichCalls.push(message);
    return this.handleEnrich(message);
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

function makeEnvelopeParser(timestamp?: number): ChannelWsMessageParser {
  return (raw) => {
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
      timestamp: timestamp ?? Date.now(),
    };
  };
}

function findMessageEvent(
  events: readonly ChannelEvent[],
): Extract<ChannelEvent, { type: 'message' }> | undefined {
  return events.find(
    (event): event is Extract<ChannelEvent, { type: 'message' }> => event.type === 'message',
  );
}

async function flushRelayMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
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
    await flushRelayMicrotasks();

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

describe('ChannelRelay 入站媒体 enrich', () => {
  it('提供 enrich 时调用一次并投递补全后的消息', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const events: ChannelEvent[] = [];
    const enrichCalls: ChannelMessage[] = [];
    const relay = new ChannelRelay({
      channel: makeChannel('relay-enrich-direct'),
      parser: makeEnvelopeParser(),
      notify: (event) => {
        events.push(event);
      },
      enrich: async (message) => {
        enrichCalls.push(message);
        return { ...message, images: [{ mediaType: 'image/jpeg', base64: 'aW1n' }] };
      },
    });

    relay.start();
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage(JSON.stringify({ chatId: 'chat-1', content: 'hello', messageId: 'm1' }));

    await vi.waitFor(() => {
      expect(findMessageEvent(events)).toBeDefined();
    });

    expect(enrichCalls).toHaveLength(1);
    expect(enrichCalls[0]).toMatchObject({ id: 'm1', chatId: 'chat-1', content: 'hello' });
    const messageEvent = findMessageEvent(events);
    expect(messageEvent).toMatchObject({
      type: 'message',
      pluginId: 'relay-enrich-direct',
      message: { id: 'm1', chatId: 'chat-1', content: 'hello' },
    });
    expect(messageEvent?.message.images).toEqual([{ mediaType: 'image/jpeg', base64: 'aW1n' }]);

    relay.stop();
  });

  it('enrich 抛错时告警并原样投递，不产生未处理异常', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ChannelEvent[] = [];
    const relay = new ChannelRelay({
      channel: makeChannel('relay-enrich-throw'),
      parser: makeEnvelopeParser(),
      notify: (event) => {
        events.push(event);
      },
      enrich: async () => {
        throw new Error('media download failed');
      },
    });

    relay.start();
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage(JSON.stringify({ chatId: 'chat-1', content: 'hello', messageId: 'm1' }));

    await vi.waitFor(() => {
      expect(findMessageEvent(events)).toBeDefined();
    });

    const messageEvent = findMessageEvent(events);
    expect(messageEvent?.message).toMatchObject({ id: 'm1', chatId: 'chat-1', content: 'hello' });
    expect(messageEvent?.message.images).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[channels] relay inbound media enrich failed',
      expect.objectContaining({ channelId: 'relay-enrich-throw', error: 'media download failed' }),
    );

    relay.stop();
  });

  it('未提供 enrich 时行为与现状一致，直接投递原始消息', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ChannelEvent[] = [];
    const relay = new ChannelRelay({
      channel: makeChannel('relay-no-enrich'),
      parser: makeEnvelopeParser(),
      notify: (event) => {
        events.push(event);
      },
    });

    relay.start();
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage(JSON.stringify({ chatId: 'chat-1', content: 'hello', messageId: 'm1' }));

    await vi.waitFor(() => {
      expect(findMessageEvent(events)).toBeDefined();
    });

    const messageEvent = findMessageEvent(events);
    expect(messageEvent).toMatchObject({
      type: 'message',
      pluginId: 'relay-no-enrich',
      message: { id: 'm1', chatId: 'chat-1', content: 'hello' },
    });
    expect(warnSpy).not.toHaveBeenCalled();

    relay.stop();
  });

  it('stale 消息不调用 enrich 也不投递', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const events: ChannelEvent[] = [];
    const enrichCalls: ChannelMessage[] = [];
    const relay = new ChannelRelay({
      channel: makeChannel('relay-stale'),
      parser: makeEnvelopeParser(Date.now() - 60_000),
      notify: (event) => {
        events.push(event);
      },
      staleMessageWindowMs: 1_000,
      enrich: async (message) => {
        enrichCalls.push(message);
        return message;
      },
    });

    relay.start();
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage(JSON.stringify({ chatId: 'chat-1', content: 'hello', messageId: 'm1' }));
    await flushRelayMicrotasks();

    expect(enrichCalls).toHaveLength(0);
    expect(findMessageEvent(events)).toBeUndefined();

    relay.stop();
  });
});

describe('ChannelManager relay 入站媒体 enrich', () => {
  it('relay 收到消息时调用 service 的 enrichInboundMessage 并投递补全后的消息', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const manager = new ChannelManager();
    const events: ChannelEvent[] = [];
    const service = new MediaService('relay-service-enrich', async (message) => ({
      ...message,
      images: [{ mediaType: 'image/jpeg', base64: 'aW1n' }],
    }));
    manager.registerFactory('telegram', () => service);
    manager.registerParser('telegram', makeEnvelopeParser());

    await manager.startPlugin(makeChannel('relay-service-enrich'), (event) => {
      events.push(event);
    });
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage(JSON.stringify({ chatId: 'chat-1', content: 'hello', messageId: 'm1' }));

    await vi.waitFor(() => {
      expect(findMessageEvent(events)).toBeDefined();
    });

    expect(service.enrichCalls).toHaveLength(1);
    expect(service.enrichCalls[0]).toMatchObject({ id: 'm1', chatId: 'chat-1', content: 'hello' });
    const messageEvent = findMessageEvent(events);
    expect(messageEvent).toMatchObject({
      type: 'message',
      pluginId: 'relay-service-enrich',
      message: { id: 'm1', chatId: 'chat-1', content: 'hello' },
    });
    expect(messageEvent?.message.images).toEqual([{ mediaType: 'image/jpeg', base64: 'aW1n' }]);

    await manager.stopAll();
  });

  it('service enrichInboundMessage 抛错时 manager 兜底告警并投递原始消息', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manager = new ChannelManager();
    const events: ChannelEvent[] = [];
    const service = new MediaService('relay-service-throw', async () => {
      throw new Error('service enrich failed');
    });
    manager.registerFactory('telegram', () => service);
    manager.registerParser('telegram', makeEnvelopeParser());

    await manager.startPlugin(makeChannel('relay-service-throw'), (event) => {
      events.push(event);
    });
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage(JSON.stringify({ chatId: 'chat-1', content: 'hello', messageId: 'm1' }));

    await vi.waitFor(() => {
      expect(findMessageEvent(events)).toBeDefined();
    });

    expect(service.enrichCalls).toHaveLength(1);
    const messageEvent = findMessageEvent(events);
    expect(messageEvent?.message).toMatchObject({ id: 'm1', chatId: 'chat-1', content: 'hello' });
    expect(messageEvent?.message.images).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[channels] relay inbound media enrich failed',
      expect.objectContaining({ channelId: 'relay-service-throw', error: 'service enrich failed' }),
    );

    await manager.stopAll();
  });
});
