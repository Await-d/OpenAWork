import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QQChannelService } from '../../channels/qq.js';
import type * as DbModule from '../../infra/db.js';
import type { ChannelEvent, ChannelInstance } from '../../channels/types.js';

const originalFetch = globalThis.fetch;
let dbModule: typeof DbModule;

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
    this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test-close' }));
  }
}

function makeQQChannel(): ChannelInstance {
  return {
    id: 'qq-gateway-1',
    type: 'qq',
    name: 'QQ Gateway',
    enabled: true,
    config: {
      appId: 'app-id',
      clientSecret: 'client-secret',
      gatewayUrl: 'wss://qq-gateway.test/ws',
    },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'u-qq',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function mockQQGatewayFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    if (url === 'https://bots.qq.com/app/getAppAccessToken') {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'gateway-token', expires_in: 7200 }), {
          status: 200,
        }),
      );
    }
    if (url === 'https://api.sgroup.qq.com/gateway') {
      return Promise.resolve(
        new Response(JSON.stringify({ url: 'wss://qq-gateway-from-api.test/ws' }), {
          status: 200,
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch call: ${url}`));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function parseSentFrame(socket: FakeWebSocket | undefined, op: number): Record<string, unknown> {
  const raw = socket?.sent.find((payload) => JSON.parse(payload).op === op);
  if (!raw) {
    throw new Error(`expected sent QQ gateway frame op=${op}`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

async function waitForSocket(index: number): Promise<FakeWebSocket> {
  await vi.waitFor(() => {
    expect(FakeWebSocket.instances[index]).toBeDefined();
  });
  const socket = FakeWebSocket.instances[index];
  if (!socket) {
    throw new Error(`expected QQ fake websocket at index ${index}`);
  }
  return socket;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings WHERE key LIKE ?', ['qq_gateway_session:%']);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    'u-qq',
    'u-qq@example.com',
  ]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  FakeWebSocket.instances = [];
});

describe('QQChannelService Gateway 入站', () => {
  it('启动后连接 Gateway，收到群聊消息时派发统一 channel message', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const fetchMock = mockQQGatewayFetch();
    const events: ChannelEvent[] = [];
    const service = new QQChannelService(makeQQChannel(), (event) => {
      events.push(event);
    });

    const startPromise = service.start();
    const socket = await waitForSocket(0);
    expect(socket?.url).toBe('wss://qq-gateway.test/ws');

    socket?.emitOpen();
    socket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await vi.waitFor(() => {
      expect(socket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.sgroup.qq.com/gateway',
      expect.objectContaining({
        headers: {
          Authorization: 'QQBot gateway-token',
        },
      }),
    );
    socket?.emitMessage({ op: 0, t: 'READY', d: { session_id: 'session-1' } });
    await startPromise;

    expect(service.getDiagnostics()).toMatchObject({
      running: true,
      status: 'running',
      transport: 'gateway',
      currentIntent: 'full',
      identified: true,
      note: expect.stringContaining('还没有收到任何消息事件'),
    });

    await vi.waitFor(() => {
      expect(socket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    });
    const identify = parseSentFrame(socket, 2);
    expect(identify).toMatchObject({
      op: 2,
      d: {
        token: 'QQBot gateway-token',
      },
    });
    expect((identify['d'] as Record<string, unknown>)['intents']).toBe(
      (1 << 30) | (1 << 12) | (1 << 25),
    );

    socket?.emitMessage({
      op: 0,
      s: 42,
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'qq-msg-1',
        group_openid: 'group-open-id',
        content: '<@123> 做一个计划',
        timestamp: '2026-07-08T12:00:00.000Z',
        author: { member_openid: 'member-open-id', username: 'QQ User' },
      },
    });
    await Promise.resolve();

    expect(service.getDiagnostics()).toMatchObject({
      lastDispatchType: 'GROUP_AT_MESSAGE_CREATE',
      lastMessageChatId: 'group:group-open-id',
    });
    expect(events).toContainEqual({
      type: 'message',
      pluginId: 'qq-gateway-1',
      message: expect.objectContaining({
        id: 'group:group-open-id|qq-msg-1',
        chatId: 'group:group-open-id',
        senderId: 'member-open-id',
        senderName: 'QQ User',
        content: '做一个计划',
      }),
    });

    await service.stop();
    expect(socket?.closeCount).toBe(1);
  });

  it('启动必须等到 Gateway READY，不能只创建 WebSocket 或发送 Identify 就标记运行', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    mockQQGatewayFetch();
    const service = new QQChannelService(makeQQChannel(), () => undefined);
    let resolved = false;

    const startPromise = service.start().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    const socket = await waitForSocket(0);
    socket?.emitOpen();
    await Promise.resolve();
    expect(resolved).toBe(false);

    socket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.waitFor(() => {
      expect(socket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    });

    socket?.emitMessage({ op: 0, t: 'READY', d: { session_id: 'session-1' } });
    await startPromise;

    expect(resolved).toBe(true);
    expect(socket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    await service.stop();
  });

  it('Gateway 标记当前 intents 无效时降级后重连，避免一直假运行在无消息状态', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    mockQQGatewayFetch();
    const events: ChannelEvent[] = [];
    const service = new QQChannelService(makeQQChannel(), (event) => {
      events.push(event);
    });

    const startPromise = service.start();
    const firstSocket = await waitForSocket(0);
    firstSocket?.emitOpen();
    firstSocket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await vi.waitFor(() => {
      expect(firstSocket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    });

    const firstIdentify = parseSentFrame(firstSocket, 2);
    expect((firstIdentify['d'] as Record<string, unknown>)['intents']).toBe(
      (1 << 30) | (1 << 12) | (1 << 25),
    );

    firstSocket?.emitMessage({ op: 9, d: false });
    await Promise.resolve();
    expect(events).toContainEqual({
      type: 'error',
      pluginId: 'qq-gateway-1',
      error: expect.stringContaining('QQ Gateway invalid session'),
    });

    await vi.advanceTimersByTimeAsync(3_000);
    const secondSocket = await waitForSocket(1);
    secondSocket?.emitOpen();
    secondSocket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });

    await vi.waitFor(() => {
      const secondIdentify = secondSocket?.sent.find((payload) => JSON.parse(payload).op === 2);
      expect(JSON.parse(secondIdentify ?? '{}').d.intents).toBe((1 << 30) | (1 << 25));
    });

    secondSocket?.emitMessage({ op: 0, t: 'READY', d: { session_id: 'session-1' } });
    await startPromise;
    await service.stop();
  });

  it('READY 后保存 session，普通断线重连时按 OpenCowork 发送 op=6 resume', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    mockQQGatewayFetch();
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    const startPromise = service.start();
    const firstSocket = await waitForSocket(0);
    firstSocket?.emitOpen();
    firstSocket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await vi.waitFor(() => {
      expect(firstSocket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    });
    firstSocket?.emitMessage({
      op: 0,
      s: 42,
      t: 'READY',
      d: { session_id: 'session-1' },
    });
    await startPromise;

    firstSocket?.close();
    await vi.advanceTimersByTimeAsync(1_000);
    const secondSocket = await waitForSocket(1);
    secondSocket?.emitOpen();
    secondSocket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });

    await vi.waitFor(() => {
      const resume = parseSentFrame(secondSocket, 6);
      expect(resume).toMatchObject({
        op: 6,
        d: {
          token: 'QQBot gateway-token',
          session_id: 'session-1',
          seq: 42,
        },
      });
    });
    secondSocket?.emitMessage({ op: 0, t: 'RESUMED' });

    expect(service.getDiagnostics()).toMatchObject({
      running: true,
      identified: true,
    });
    await service.stop();
  });

  it('所有 intent 降级都 invalid 后按 OpenCowork 清 token cache 再重连', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const fetchMock = mockQQGatewayFetch();
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    const startPromise = service.start();
    const firstSocket = await waitForSocket(0);
    firstSocket?.emitOpen();
    firstSocket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
    await vi.waitFor(() => {
      expect(firstSocket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
    });
    for (let index = 0; index < 3; index += 1) {
      const socket = await waitForSocket(index);
      socket?.emitMessage({ op: 9, d: false });
      await vi.advanceTimersByTimeAsync(3_000);
      const nextSocket = await waitForSocket(index + 1);
      nextSocket?.emitOpen();
      nextSocket?.emitMessage({ op: 10, d: { heartbeat_interval: 30_000 } });
      await vi.waitFor(() => {
        expect(nextSocket?.sent.some((payload) => JSON.parse(payload).op === 2)).toBe(true);
      });
    }

    const finalSocket = await waitForSocket(3);
    finalSocket.emitMessage({ op: 0, t: 'READY', d: { session_id: 'session-final' } });
    await startPromise;

    const tokenFetchCount = fetchMock.mock.calls.filter(
      (call) => call[0] === 'https://bots.qq.com/app/getAppAccessToken',
    ).length;
    expect(tokenFetchCount).toBeGreaterThanOrEqual(2);
    await service.stop();
  });
});
