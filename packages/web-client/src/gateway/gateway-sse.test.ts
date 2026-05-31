import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewaySSEClient } from './gateway-sse.js';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

afterEach(() => {
  MockEventSource.instances.length = 0;
  vi.unstubAllGlobals();
});

describe('GatewaySSEClient', () => {
  it('SSE onerror 时发出中文错误事件', () => {
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

    const client = new GatewaySSEClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);

    client.connectAndStream('session-1', 'hello');

    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();
    es?.onerror?.();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        code: 'SSE_ERROR',
        message: 'SSE 连接异常。',
      }),
    );
  });

  it('SSE 收到损坏的 JSON chunk 时发出中文解析错误并关闭连接', () => {
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

    const client = new GatewaySSEClient('http://localhost:3000', 'token-1');
    const handler = vi.fn();
    client.onChunk(handler);

    client.connectAndStream('session-1', 'hello');

    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();
    es?.onmessage?.({ data: '{broken-json' } as MessageEvent);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        code: 'SSE_INVALID_PAYLOAD',
        message: 'SSE 数据解析失败。',
      }),
    );
    expect(es?.closed).toBe(true);
  });
});
