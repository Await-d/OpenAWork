import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LSPWebSocketClient } from './ws-client.js';

/**
 * Minimal scriptable WebSocket stand-in. Captures instances so a test
 * can drive `onopen` / `onclose` / `onmessage` deterministically.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(1); // jitter → upper bound, deterministic
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWebSocket;
});

describe('LSPWebSocketClient reconnect backoff', () => {
  it('断开后按指数退避重连，并在 onopen 后重置退避', () => {
    const client = new LSPWebSocketClient({
      gatewayUrl: 'http://gw.test',
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 30_000,
    });
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // 第 1 次断开 → attempt=1 → base*2^0 = 1000ms（random=1 → 满抖动取上界）
    FakeWebSocket.instances[0]!.drop();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // 第 2 次断开 → attempt=2 → 2000ms
    FakeWebSocket.instances[1]!.drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    // 成功 open 重置退避；下一次断开重新从 1000ms 起算
    FakeWebSocket.instances[2]!.open();
    FakeWebSocket.instances[2]!.drop();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('退避封顶在 maxReconnectDelayMs', () => {
    const client = new LSPWebSocketClient({
      gatewayUrl: 'http://gw.test',
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 4000,
    });
    client.connect();

    // 连续断开数次，指数增长应被 4000 封顶
    for (let i = 0; i < 6; i++) {
      const latest = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
      latest.drop();
      vi.advanceTimersByTime(4000);
    }
    // 仍在持续重连（未卡死），实例数随每次封顶延迟增加
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(6);
  });

  it('disconnect 后不再重连', () => {
    const client = new LSPWebSocketClient({ gatewayUrl: 'http://gw.test', reconnectDelayMs: 1000 });
    client.connect();
    client.disconnect();
    FakeWebSocket.instances[0]!.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('onDiagnostics 回调抛错被隔离，转为 onError 而不冒泡', () => {
    const onError = vi.fn();
    const client = new LSPWebSocketClient({
      gatewayUrl: 'http://gw.test',
      onDiagnostics: () => {
        throw new Error('consumer blew up');
      },
      onError,
    });
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    expect(() => ws.emit({ type: 'diagnostics', path: '/a.ts', diagnostics: [] })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
