// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import type { RunEvent, StreamChunk } from '@openAwork/shared';
import { useGatewayClient } from './useGatewayClient.js';
import { useAuthStore } from '../stores/auth.js';

const fetchMock = vi.fn();

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly send = vi.fn<(payload: string) => void>();
  readonly close = vi.fn<() => void>(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitChunk(chunk: StreamChunk | RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(chunk) });
  }

  emitError(): void {
    this.onerror?.();
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly close = vi.fn<() => void>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emitChunk(chunk: StreamChunk | RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(chunk) });
  }

  emitError(): void {
    this.onerror?.();
  }
}

function HookHarness({
  token,
  onReady,
}: {
  token: string | null;
  onReady: (client: ReturnType<typeof useGatewayClient>) => void;
}) {
  const client = useGatewayClient(token);

  useEffect(() => {
    onReady(client);
  }, [client, onReady]);

  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  MockWebSocket.instances = [];
  MockEventSource.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal('fetch', fetchMock as typeof fetch);
  useAuthStore.setState({ gatewayUrl: 'http://localhost:3000' });
  fetchMock.mockReset();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  vi.unstubAllGlobals();
});

describe('useGatewayClient', () => {
  it('streams chunks over websocket when WS succeeds', async () => {
    let client: ReturnType<typeof useGatewayClient> | null = null;
    await act(async () => {
      root!.render(
        <HookHarness
          token="token-123"
          onReady={(value) => {
            client = value;
          }}
        />,
      );
    });

    const deltas: string[] = [];
    const eventTypes: string[] = [];
    const done: string[] = [];

    expect(client!.getActiveStreamSessionId()).toBeNull();

    act(() => {
      client!.stream('session-1', 'hello', {
        providerId: 'openai',
        model: 'gpt-4o',
        onEvent: (event) => eventTypes.push(event.type),
        onDelta: (delta) => deltas.push(delta),
        onDone: (stopReason) => done.push(stopReason ?? 'none'),
        onError: () => {
          throw new Error('should not error');
        },
      });
    });

    expect(client!.getActiveStreamSessionId()).toBe('session-1');

    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain('token=token-123');

    act(() => {
      ws.emitOpen();
      ws.emitChunk({ type: 'text_delta', delta: '你好' });
      ws.emitChunk({ type: 'done', stopReason: 'end_turn' });
    });

    const payload = JSON.parse(ws.send.mock.calls[0]?.[0] ?? '{}') as Record<string, unknown>;
    expect(payload).toMatchObject({
      message: 'hello',
      model: 'gpt-4o',
      providerId: 'openai',
      webSearchEnabled: false,
    });
    expect(typeof payload['clientRequestId']).toBe('string');

    expect(MockEventSource.instances).toHaveLength(0);
    expect(deltas).toEqual(['你好']);
    expect(eventTypes).toEqual(['done']);
    expect(done).toEqual(['end_turn']);
    expect(client!.getActiveStreamSessionId()).toBeNull();
  });

  it('falls back to SSE and still delivers tool chunks', async () => {
    let client: ReturnType<typeof useGatewayClient> | null = null;
    await act(async () => {
      root!.render(
        <HookHarness
          token="token-123"
          onReady={(value) => {
            client = value;
          }}
        />,
      );
    });

    const toolNames: string[] = [];
    const toolResults: unknown[] = [];
    const done: string[] = [];

    act(() => {
      client!.stream('session-1', 'hello', {
        model: 'gpt-4o',
        onDelta: () => undefined,
        onEvent: (event) => {
          if (event.type === 'tool_result') {
            toolResults.push(event.output);
          }
        },
        onToolCall: (chunk) => toolNames.push(chunk.toolName),
        onDone: (stopReason) => done.push(stopReason ?? 'none'),
        onError: () => {
          throw new Error('should not error');
        },
      });
    });

    act(() => {
      MockWebSocket.instances[0]!.emitError();
    });

    const es = MockEventSource.instances[0]!;
    expect(es.url).toContain('token=token-123');

    act(() => {
      es.emitChunk({
        type: 'tool_call_delta',
        toolCallId: 'call_1',
        toolName: 'web_search',
        inputDelta: '{"query":"上海天气"}',
      });
      es.emitChunk({
        type: 'tool_result',
        toolCallId: 'call_1',
        toolName: 'web_search',
        output: { city: '上海' },
        isError: false,
      });
      es.emitChunk({ type: 'done', stopReason: 'end_turn' });
    });

    expect(toolNames).toEqual(['web_search']);
    expect(toolResults).toEqual([{ city: '上海' }]);
    expect(done).toEqual(['end_turn']);
  });

  it('delivers thinking deltas from websocket streams', async () => {
    let client: ReturnType<typeof useGatewayClient> | null = null;
    await act(async () => {
      root!.render(
        <HookHarness
          token="token-123"
          onReady={(value) => {
            client = value;
          }}
        />,
      );
    });

    const thinking: string[] = [];
    const done: string[] = [];

    act(() => {
      client!.stream('session-thinking', '请先思考', {
        onDelta: () => undefined,
        onThinkingDelta: (delta) => thinking.push(delta),
        onDone: (stopReason) => done.push(stopReason ?? 'none'),
        onError: () => {
          throw new Error('should not error');
        },
      });
    });

    act(() => {
      MockWebSocket.instances[0]!.emitOpen();
      MockWebSocket.instances[0]!.onmessage?.({
        data: JSON.stringify({ type: 'thinking_delta', delta: '先列出判断标准。' }),
      });
      MockWebSocket.instances[0]!.emitChunk({ type: 'done', stopReason: 'end_turn' });
    });

    expect(thinking).toEqual(['先列出判断标准。']);
    expect(done).toEqual(['end_turn']);
  });

  it('stops the active stream through the authenticated session route', async () => {
    let client: ReturnType<typeof useGatewayClient> | null = null;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stopped: true }),
    } satisfies Partial<Response>);

    await act(async () => {
      root!.render(
        <HookHarness
          token="token-123"
          onReady={(value) => {
            client = value;
          }}
        />,
      );
    });

    act(() => {
      client!.stream('session-9', '停止这次对话', {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      });
    });

    expect(client!.getActiveStreamSessionId()).toBe('session-9');

    await expect(client!.stopStream()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sessions/session-9/stream/stop',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      clientRequestId: expect.any(String),
    });
  });

  it('settles as cancelled when stop was requested and websocket closes before done arrives', async () => {
    let client: ReturnType<typeof useGatewayClient> | null = null;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stopped: true }),
    } satisfies Partial<Response>);

    await act(async () => {
      root!.render(
        <HookHarness
          token="token-123"
          onReady={(value) => {
            client = value;
          }}
        />,
      );
    });

    const done: string[] = [];
    const errors: string[] = [];

    act(() => {
      client!.stream('session-5', '停止后关闭连接', {
        onDelta: () => undefined,
        onDone: (stopReason) => done.push(stopReason ?? 'none'),
        onError: (code) => errors.push(code),
      });
    });

    await expect(client!.stopStream()).resolves.toBe(true);

    act(() => {
      MockWebSocket.instances[0]!.emitClose();
    });

    expect(done).toEqual(['cancelled']);
    expect(errors).toEqual([]);
  });

  it('treats SSE failure after a stop request as cancelled instead of an error', async () => {
    let client: ReturnType<typeof useGatewayClient> | null = null;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stopped: true }),
    } satisfies Partial<Response>);

    await act(async () => {
      root!.render(
        <HookHarness
          token="token-123"
          onReady={(value) => {
            client = value;
          }}
        />,
      );
    });

    const done: string[] = [];
    const errors: string[] = [];

    act(() => {
      client!.stream('session-6', 'SSE 停止后报错', {
        onDelta: () => undefined,
        onDone: (stopReason) => done.push(stopReason ?? 'none'),
        onError: (code) => errors.push(code),
      });
    });

    act(() => {
      MockWebSocket.instances[0]!.emitError();
    });

    await expect(client!.stopStream()).resolves.toBe(true);

    act(() => {
      MockEventSource.instances[0]!.emitError();
    });

    expect(done).toEqual(['cancelled']);
    expect(errors).toEqual([]);
  });
});
