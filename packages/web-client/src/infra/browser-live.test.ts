import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createBrowserLiveClient } from './browser-live.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  onopen: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readyState = MockWebSocket.OPEN;
  sentPayloads: string[] = [];
  closeCalls = 0;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
  }
}

const originalFetch = globalThis.fetch;
type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn<FetchHandler>(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  MockWebSocket.instances.length = 0;
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createBrowserLiveClient WebSocket', () => {
  it('connect 使用协议替换后的 WS 路径并挂载 token 查询串', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = createBrowserLiveClient('http://localhost:3000');
    client.connect({ token: 'token-1', callbacks: { onEnvelope: vi.fn() } });

    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toBe('ws://localhost:3000/browser-live?token=token-1');
  });

  it('https 网关地址替换为 wss', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = createBrowserLiveClient('https://gateway.example.com');
    client.connect({ token: 'token-2', callbacks: { onEnvelope: vi.fn() } });

    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toBe('wss://gateway.example.com/browser-live?token=token-2');
  });

  it('CONNECTING 期间缓存上行消息，open 后按序冲刷', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = createBrowserLiveClient('http://localhost:3000');
    const connection = client.connect({ token: 'token-1', callbacks: { onEnvelope: vi.fn() } });
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = MockWebSocket.CONNECTING;

    connection.send({ ch: 'ack', frameSessionId: 1 });
    connection.send({ ch: 'control', action: 'reload' });
    expect(ws.sentPayloads).toHaveLength(0);

    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    expect(ws.sentPayloads).toEqual([
      JSON.stringify({ ch: 'ack', frameSessionId: 1 }),
      JSON.stringify({ ch: 'control', action: 'reload' }),
    ]);
  });

  it('未 OPEN 期间缓存有界，超过上限丢最旧、保留最近', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = createBrowserLiveClient('http://localhost:3000');
    const connection = client.connect({ token: 'token-1', callbacks: { onEnvelope: vi.fn() } });
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = MockWebSocket.CONNECTING;

    // 远超过 64 条上限，模拟网关不可达、socket 永不打开。
    for (let i = 0; i < 200; i++) {
      connection.send({ ch: 'ack', frameSessionId: i });
    }

    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    expect(ws.sentPayloads).toHaveLength(64);
    expect(ws.sentPayloads[0]).toBe(JSON.stringify({ ch: 'ack', frameSessionId: 136 }));
    expect(ws.sentPayloads[63]).toBe(JSON.stringify({ ch: 'ack', frameSessionId: 199 }));
  });

  it('open 时先冲刷缓存再触发 onOpen', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    const onOpen = vi.fn();

    const client = createBrowserLiveClient('http://localhost:3000');
    const connection = client.connect({
      token: 'token-1',
      callbacks: { onEnvelope: vi.fn(), onOpen },
    });
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = MockWebSocket.CONNECTING;
    connection.send({ ch: 'control', action: 'ping' });

    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    expect(ws.sentPayloads).toHaveLength(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('已 OPEN 时立即发送', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = createBrowserLiveClient('http://localhost:3000');
    const connection = client.connect({ token: 'token-1', callbacks: { onEnvelope: vi.fn() } });
    const ws = MockWebSocket.instances[0]!;

    connection.send({ ch: 'control', action: 'reload' });

    expect(ws.sentPayloads).toEqual([JSON.stringify({ ch: 'control', action: 'reload' })]);
  });

  it('入站合法信封派发到 onEnvelope', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    const onEnvelope = vi.fn();

    const client = createBrowserLiveClient('http://localhost:3000');
    client.connect({ token: 'token-1', callbacks: { onEnvelope } });
    const ws = MockWebSocket.instances[0]!;

    const envelope = { ch: 'hello', seq: 1, ts: 123, payload: { available: true } };
    ws.onmessage?.({ data: JSON.stringify(envelope) } as MessageEvent);

    expect(onEnvelope).toHaveBeenCalledWith(envelope);
  });

  it('入站损坏 JSON 时上报 BROWSER_LIVE_INVALID_PAYLOAD 且保持连接', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    const onEnvelope = vi.fn();
    const onError = vi.fn();

    const client = createBrowserLiveClient('http://localhost:3000');
    client.connect({ token: 'token-1', callbacks: { onEnvelope, onError } });
    const ws = MockWebSocket.instances[0]!;

    ws.onmessage?.({ data: '{broken-json' } as MessageEvent);

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('BROWSER_LIVE_INVALID_PAYLOAD');
    expect(onEnvelope).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
  });

  it('onclose 只派发一次并透传 code 与 reason', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    const onClose = vi.fn();

    const client = createBrowserLiveClient('http://localhost:3000');
    client.connect({ token: 'token-1', callbacks: { onEnvelope: vi.fn(), onClose } });
    const ws = MockWebSocket.instances[0]!;

    ws.onclose?.({ code: 1006, reason: '异常关闭' } as CloseEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith({ code: 1006, reason: '异常关闭' });

    // 浏览器可能重复触发 onclose，守卫必须去重。
    ws.onclose?.({ code: 1006, reason: '异常关闭' } as CloseEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close 幂等，关闭后 send 直接丢弃', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = createBrowserLiveClient('http://localhost:3000');
    const connection = client.connect({ token: 'token-1', callbacks: { onEnvelope: vi.fn() } });
    const ws = MockWebSocket.instances[0]!;

    connection.close();
    connection.close();
    expect(ws.closeCalls).toBe(1);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);

    connection.send({ ch: 'control', action: 'reload' });
    expect(ws.sentPayloads).toHaveLength(0);
  });
});

describe('createBrowserLiveClient REST', () => {
  it('getStatus 解析状态并携带 Bearer 鉴权头', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({ available: true, engine: 'chromium', screencast: true }),
    );

    const client = createBrowserLiveClient('http://localhost:3000');
    const status = await client.getStatus('token-1');

    expect(status).toEqual({ available: true, engine: 'chromium', screencast: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/browser-live/status',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-1' } }),
    );
  });

  it('screenshot 以 POST 发送入参并解析 artifact 描述符', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({
        artifactId: 'artifact-1',
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
      }),
    );

    const client = createBrowserLiveClient('http://localhost:3000');
    const result = await client.screenshot('token-1', { sessionId: 'session-1', fullPage: true });

    expect(result).toEqual({
      artifactId: 'artifact-1',
      fileName: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/browser-live/screenshot',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-1', fullPage: true }),
      }),
    );
  });

  it('start 以 POST 发送 url', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));

    const client = createBrowserLiveClient('http://localhost:3000');
    await expect(client.start('token-1', { url: 'https://example.com' })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/browser-live/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com' }),
      }),
    );
  });

  it('stop 容忍 204 空响应', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    const client = createBrowserLiveClient('http://localhost:3000');
    await expect(client.stop('token-1')).resolves.toBeUndefined();
  });

  it('stop 携带可解析的 JSON body（JSON content-type 不能配空 body）', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));

    const client = createBrowserLiveClient('http://localhost:3000');
    await client.stop('token-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/browser-live/stop',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
      }),
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({});
  });

  it('非 2xx 响应抛出携带 status 的 HttpError', async () => {
    stubFetch(async () => jsonResponse({ error: 'engine unavailable' }, 503));

    const client = createBrowserLiveClient('http://localhost:3000');

    await expect(client.getStatus('token-1')).rejects.toBeInstanceOf(HttpError);
    await expect(client.getStatus('token-1')).rejects.toMatchObject({ status: 503 });
  });
});
