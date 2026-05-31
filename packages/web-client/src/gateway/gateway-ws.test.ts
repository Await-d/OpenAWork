import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayWebSocketClient } from './gateway-ws.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CLOSED = 3;
  static readonly OPEN = 1;

  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = MockWebSocket.OPEN;
  sentPayloads: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sentPayloads.push(payload);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

afterEach(() => {
  MockWebSocket.instances.length = 0;
  vi.unstubAllGlobals();
});

describe('GatewayWebSocketClient', () => {
  it('WebSocket onerror 时发出中文错误事件', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);

    client.connect('session-1');

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    ws?.onerror?.();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        code: 'WS_ERROR',
        message: 'WebSocket 连接异常。',
      }),
    );
  });

  it('WebSocket 收到损坏的 JSON chunk 时发出中文解析错误并关闭连接', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);

    client.connect('session-1');

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    ws?.onmessage?.({ data: '{broken-json' } as MessageEvent);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        code: 'WS_INVALID_PAYLOAD',
        message: 'WebSocket 数据解析失败。',
      }),
    );
    expect(ws?.readyState).toBe(MockWebSocket.CLOSED);
  });
});

describe('GatewayWebSocketClient pending payload buffer', () => {
  it('socket 未 OPEN 时缓冲发送，open 后按序冲刷', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    client.connect('session-1');
    const ws = MockWebSocket.instances[0]!;
    // Simulate the CONNECTING window: not yet OPEN.
    ws.readyState = 0;

    client.send('first');
    client.send('second');
    // Nothing sent while connecting.
    expect(ws.sentPayloads).toHaveLength(0);

    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    expect(ws.sentPayloads).toHaveLength(2);
    expect(ws.sentPayloads[0]).toContain('"message":"first"');
    expect(ws.sentPayloads[1]).toContain('"message":"second"');
  });

  it('socket 长期未 OPEN 时缓冲有界，丢最旧、保留最近的 intent', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    client.connect('session-1');
    const ws = MockWebSocket.instances[0]!;
    // Gateway down: socket never opens.
    ws.readyState = 0;

    // Fire well past the 64-entry cap.
    for (let i = 0; i < 200; i++) {
      client.send(`msg-${i}`);
    }

    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    // Buffer was capped at 64; oldest were evicted, newest kept.
    expect(ws.sentPayloads).toHaveLength(64);
    expect(ws.sentPayloads[0]).toContain('"message":"msg-136"');
    expect(ws.sentPayloads[63]).toContain('"message":"msg-199"');
  });
});

describe('GatewayWebSocketClient onclose terminal safety', () => {
  it('服务端静默关闭（无前置终态 chunk）时发出一次 WS_CLOSED 终态错误', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);
    client.connect('session-1');

    const ws = MockWebSocket.instances[0]!;
    // Gateway restart / proxy idle-drop / 1001 going-away: only onclose fires,
    // no prior done/error chunk.
    ws.onclose?.();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        code: 'WS_CLOSED',
        message: 'WebSocket 连接已关闭。',
      }),
    );

    // A second onclose (browser may fire once, but guard must dedupe) stays silent.
    ws.onclose?.();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('收到终态 done chunk 后再关闭不重复发错', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);
    client.connect('session-1');

    const ws = MockWebSocket.instances[0]!;
    ws.onmessage?.({ data: JSON.stringify({ type: 'done' }) } as MessageEvent);
    expect(handler).toHaveBeenCalledTimes(1);

    // Clean shutdown after the terminal chunk must NOT emit a synthetic error.
    ws.onclose?.();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WS_CLOSED' }),
    );
  });

  it('调用方 disconnect() 触发的关闭不发合成错误', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);
    client.connect('session-1');

    const ws = MockWebSocket.instances[0]!;
    client.disconnect();
    // Even if the browser still fires onclose for the now-detached socket,
    // the manualClose + superseded guards keep it silent.
    ws.onclose?.();

    expect(handler).not.toHaveBeenCalled();
  });

  it('被后续 connect() 取代的旧 socket 关闭不影响新连接', () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);
    client.connect('session-1');
    const first = MockWebSocket.instances[0]!;

    // Reconnect: a fresh socket supersedes the first.
    client.connect('session-1');
    const second = MockWebSocket.instances[1]!;
    expect(second).toBeTruthy();

    // The stale socket's close must be ignored (no synthetic error).
    first.onclose?.();
    expect(handler).not.toHaveBeenCalled();

    // The live socket's silent close still surfaces a terminal error.
    second.onclose?.();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WS_CLOSED' }),
    );
  });
});
