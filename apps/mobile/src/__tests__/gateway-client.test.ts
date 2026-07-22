import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileGatewayClient, type StreamHandlers } from '../hooks/useGatewayClient';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: { wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  constructor(
    public url: string,
    _protocols?: string | string[],
    _options?: { headers?: Record<string, string> },
  ) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(raw: string): void {
    this.onmessage?.({ data: raw });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

function makeHandlers(overrides: Partial<StreamHandlers> = {}): StreamHandlers {
  return {
    onDelta: () => undefined,
    onDone: () => undefined,
    onError: () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWebSocket;
});

describe('MobileGatewayClient resilience', () => {
  it('坏帧不抛出，转为 WS_INVALID_PAYLOAD 错误', () => {
    const onError = vi.fn();
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect('s1', makeHandlers({ onError }));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();

    expect(() => ws.emit('not-json{')).not.toThrow();
    expect(onError).toHaveBeenCalledWith('WS_INVALID_PAYLOAD', expect.any(String));
  });

  it('handler 抛错被隔离，转为 WS_HANDLER_ERROR', () => {
    const onError = vi.fn();
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect(
      's1',
      makeHandlers({
        onDelta: () => {
          throw new Error('setState on unmounted');
        },
        onError,
      }),
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();

    expect(() => ws.emit(JSON.stringify({ type: 'text_delta', delta: 'hi' }))).not.toThrow();
    expect(onError).toHaveBeenCalledWith('WS_HANDLER_ERROR', expect.any(String));
  });

  it('CONNECTING 期间多次 send 在 onopen 时按序全部 flush，不丢消息', () => {
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect('s1', makeHandlers());
    const ws = FakeWebSocket.instances[0]!;
    // 尚未 open：连续 send 三条
    client.send('first');
    client.send('second');
    client.send('third');
    expect(ws.sent).toHaveLength(0);

    ws.open();
    expect(ws.sent).toHaveLength(3);
    const messages = ws.sent.map((s) => (JSON.parse(s) as { message: string }).message);
    expect(messages).toEqual(['first', 'second', 'third']);
  });

  it('正常 done 帧触发 onDone', () => {
    const onDone = vi.fn();
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect('s1', makeHandlers({ onDone }));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.emit(JSON.stringify({ type: 'done', stopReason: 'end_turn' }));
    expect(onDone).toHaveBeenCalledWith('end_turn');
  });

  it('socket 长期未 OPEN 时缓冲有界，丢最旧、保留最近的 intent', () => {
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect('s1', makeHandlers());
    const ws = FakeWebSocket.instances[0]!;
    // 网关不可达：socket 永不 open，连发远超 64 上限。
    for (let i = 0; i < 200; i++) {
      client.send(`msg-${i}`);
    }
    expect(ws.sent).toHaveLength(0);

    ws.open();
    // 缓冲被限制在 64 条：最旧的被逐出，最近的保留。
    expect(ws.sent).toHaveLength(64);
    const messages = ws.sent.map((s) => (JSON.parse(s) as { message: string }).message);
    expect(messages[0]).toBe('msg-136');
    expect(messages[63]).toBe('msg-199');
  });

  it('服务端中途干净关闭（wasClean）时发出一次 WS_CLOSED 终态错误，不挂死 UI（§0.147）', () => {
    const onError = vi.fn();
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect('s1', makeHandlers({ onError }));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    // 1001 going-away / 网关重启：onclose 带 wasClean=true、无前置 done/error。
    // mobile 不会 re-attach，必须合成一次终态错误让 UI 收尾。
    ws.onclose?.({ wasClean: true });
    expect(onError).toHaveBeenCalledWith('WS_CLOSED', expect.any(String));
    expect(onError).toHaveBeenCalledTimes(1);
    // 干净关闭不触发重连：不会再开新 socket。
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('收到 done 终态帧后再关闭不重复发错', () => {
    const onError = vi.fn();
    const onDone = vi.fn();
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect('s1', makeHandlers({ onError, onDone }));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.emit(JSON.stringify({ type: 'done', stopReason: 'end_turn' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    // 终态已交付，后续干净关闭不得再合成 WS_CLOSED。
    ws.onclose?.({ wasClean: true });
    expect(onError).not.toHaveBeenCalled();
  });

  it('重连预算耗尽后仍发出一次 WS_CLOSED 终态错误（不静默挂死）', () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const client = new MobileGatewayClient('http://gw.test', 'tok');
      client.connect('s1', makeHandlers({ onError }));

      // maxReconnectAttempts=5。模拟「连接尝试反复失败」：每个 socket 在 open 之前就
      // 非干净关闭（open 会把 reconnectAttempts 清零，相当于一次成功连接）。前 5 次
      // 关闭各触发一次重连（开出新 socket），第 6 次预算耗尽 → 合成一次 WS_CLOSED。
      for (let attempt = 0; attempt < 6; attempt++) {
        const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
        ws.onclose?.({ wasClean: false });
        vi.advanceTimersByTime(60_000);
      }

      expect(onError).toHaveBeenCalledWith('WS_CLOSED', expect.any(String));
      // 预算耗尽后不再开新 socket：connect 起共 6 个（1 初始 + 5 重连）。
      expect(FakeWebSocket.instances).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('调用方 disconnect() 后的关闭不发合成终态错误', () => {
    const onError = vi.fn();
    const client = new MobileGatewayClient('http://gw.test', 'tok');
    client.connect('s1', makeHandlers({ onError }));
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    client.disconnect();
    // disconnect 已清 handlers/currentSessionId；迟到的 onclose 必须静默。
    ws.onclose?.({ wasClean: false });
    expect(onError).not.toHaveBeenCalled();
    // 不重连。
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
