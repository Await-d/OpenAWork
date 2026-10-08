import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLIENT_SYNTHETIC_STREAM_ERROR_CODES,
  isClientSyntheticStreamErrorCode,
} from './client-stream-error-codes.js';
import { GatewaySSEClient } from './gateway-sse.js';
import { GatewayWebSocketClient } from './gateway-ws.js';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close(): void {
    /* no-op */
  }
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 0;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close(): void {
    /* no-op */
  }

  send(): void {
    /* no-op */
  }
}

function collectSseSyntheticCodes(): string[] {
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  const client = new GatewaySSEClient('http://localhost:3000', 'token-1');
  const codes: string[] = [];
  client.onChunk((event) => {
    if (event.type === 'error') codes.push(event.code);
  });
  client.connectAndStream('session-1', 'hello');
  const es = MockEventSource.instances[0];
  es?.onerror?.();
  es?.onmessage?.({ data: '{broken-json' } as MessageEvent);
  return codes;
}

function collectWsSyntheticCodes(): string[] {
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  const client = new GatewayWebSocketClient('http://localhost:3000', 'token-1');
  const codes: string[] = [];
  client.onChunk((event) => {
    if (event.type === 'error') codes.push(event.code);
  });
  client.connect('session-1');
  const ws = MockWebSocket.instances[0];
  ws?.onerror?.();
  ws?.onmessage?.({ data: '{broken-json' } as MessageEvent);
  ws?.onclose?.({ code: 1006, reason: 'abnormal closure' } as CloseEvent);
  return codes;
}

afterEach(() => {
  MockEventSource.instances.length = 0;
  MockWebSocket.instances.length = 0;
  vi.unstubAllGlobals();
});

describe('isClientSyntheticStreamErrorCode', () => {
  it('SSE 客户端合成的错误码全部命中名单', () => {
    for (const code of collectSseSyntheticCodes()) {
      expect(isClientSyntheticStreamErrorCode(code), `SSE 合成码 ${code} 未登记`).toBe(true);
    }
  });

  it('WebSocket 客户端合成的错误码全部命中名单', () => {
    for (const code of collectWsSyntheticCodes()) {
      expect(isClientSyntheticStreamErrorCode(code), `WS 合成码 ${code} 未登记`).toBe(true);
    }
  });

  it('attach 侧在 useGatewayClient 内合成的两个码同样命中名单', () => {
    expect(isClientSyntheticStreamErrorCode('ATTACH_STREAM_DISCONNECTED')).toBe(true);
    expect(isClientSyntheticStreamErrorCode('ATTACH_STREAM_INVALID_PAYLOAD')).toBe(true);
  });

  it('网关侧自己落库的失败码一律不命中，避免重复上报写两条错误消息', () => {
    for (const code of ['MODEL_ERROR', 'STREAM_ERROR', 'V2_UPSTREAM_ERROR', 'ABORTED']) {
      expect(isClientSyntheticStreamErrorCode(code)).toBe(false);
    }
  });

  it('容忍首尾空白，且名单无重复项', () => {
    expect(isClientSyntheticStreamErrorCode(' SSE_ERROR ')).toBe(true);
    expect(isClientSyntheticStreamErrorCode('MODEL_ERROR')).toBe(false);
    expect(new Set(CLIENT_SYNTHETIC_STREAM_ERROR_CODES).size).toBe(
      CLIENT_SYNTHETIC_STREAM_ERROR_CODES.length,
    );
  });
});
