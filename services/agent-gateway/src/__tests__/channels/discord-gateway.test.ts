import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordChannelService } from '../../channels/discord.js';
import type { ChannelEvent, ChannelInstance } from '../../channels/types.js';

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
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

  emitMessage(payload: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

function makeDiscordChannel(configOverride: Record<string, string> = {}): ChannelInstance {
  return {
    id: 'discord-gateway-1',
    type: 'discord',
    name: 'Discord Gateway',
    enabled: true,
    config: {
      token: 'bot-token',
      gatewayUrl: 'wss://discord-gateway.test/?v=10&encoding=json',
      ...configOverride,
    },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'u-discord',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWebSocket.instances = [];
});

describe('DiscordChannelService Gateway 入站', () => {
  it('启动后连接 Gateway，收到 MESSAGE_CREATE 时派发统一 channel message', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const events: ChannelEvent[] = [];
    const service = new DiscordChannelService(makeDiscordChannel(), (event) => {
      events.push(event);
    });

    const startPromise = service.start();
    const socket = FakeWebSocket.instances[0];
    expect(socket?.url).toBe('wss://discord-gateway.test/?v=10&encoding=json');

    socket?.emitOpen();
    socket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await startPromise;

    const identify = socket?.sent.find((payload) => JSON.parse(payload).op === 2);
    expect(identify).toBeTruthy();
    expect(JSON.parse(identify ?? '{}')).toMatchObject({
      op: 2,
      d: { token: 'bot-token' },
    });

    socket?.emitMessage({
      op: 0,
      t: 'READY',
      d: {
        user: { id: 'discord-bot-1', username: 'OpenAWork Bot' },
      },
    });

    socket?.emitMessage({
      op: 0,
      t: 'MESSAGE_CREATE',
      d: {
        id: 'discord-message-1',
        channel_id: 'discord-channel-1',
        content: 'hello from discord',
        timestamp: '2026-07-08T12:00:00.000Z',
        author: { id: 'discord-user-1', username: 'Discord User' },
      },
    });
    await Promise.resolve();

    expect(events).toContainEqual({
      type: 'message',
      pluginId: 'discord-gateway-1',
      message: expect.objectContaining({
        id: 'discord-message-1',
        chatId: 'discord-channel-1',
        senderId: 'discord-user-1',
        senderName: 'Discord User',
        content: 'hello from discord',
      }),
    });

    await service.stop();
    expect(socket?.closeCount).toBe(1);
  });

  it('配置群聊必须 @ 后，仅接受提及当前机器人的 guild 消息', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const events: ChannelEvent[] = [];
    const service = new DiscordChannelService(
      makeDiscordChannel({ requireMentionInGroup: 'true' }),
      (event) => {
        events.push(event);
      },
    );

    const startPromise = service.start();
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await startPromise;

    socket?.emitMessage({
      op: 0,
      t: 'READY',
      d: {
        user: { id: 'discord-bot-1', username: 'OpenAWork Bot' },
      },
    });
    socket?.emitMessage({
      op: 0,
      t: 'MESSAGE_CREATE',
      d: {
        id: 'discord-ignored-1',
        guild_id: 'guild-1',
        channel_id: 'discord-channel-1',
        content: 'not addressed',
        timestamp: '2026-07-08T12:00:00.000Z',
        author: { id: 'discord-user-1', username: 'Discord User' },
      },
    });
    socket?.emitMessage({
      op: 0,
      t: 'MESSAGE_CREATE',
      d: {
        id: 'discord-mentioned-1',
        guild_id: 'guild-1',
        channel_id: 'discord-channel-1',
        content: '<@discord-bot-1> help me',
        timestamp: '2026-07-08T12:00:01.000Z',
        mentions: [{ id: 'discord-bot-1' }],
        author: { id: 'discord-user-1', username: 'Discord User' },
      },
    });
    await Promise.resolve();

    const messageEvents = events.filter((event) => event.type === 'message');
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0]).toMatchObject({
      type: 'message',
      pluginId: 'discord-gateway-1',
      message: expect.objectContaining({
        id: 'discord-mentioned-1',
        chatId: 'discord-channel-1',
        content: 'help me',
      }),
    });

    await service.stop();
  });

  it('启动必须等到 Gateway hello 并发送 Identify，不能只创建 WebSocket 就标记运行', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const service = new DiscordChannelService(makeDiscordChannel(), () => undefined);
    let resolved = false;

    const startPromise = service.start().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    await Promise.resolve();
    expect(resolved).toBe(false);

    socket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await startPromise;

    expect(resolved).toBe(true);
    expect(socket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    await service.stop();
  });
});
