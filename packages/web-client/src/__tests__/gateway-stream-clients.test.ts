import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import { GatewayWebSocketClient } from '../gateway-ws.js';
import { GatewaySSEClient } from '../gateway-sse.js';

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
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

  emitChunk(chunk: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(chunk) });
  }

  emitError(): void {
    this.onerror?.();
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

  emitChunk(chunk: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(chunk) });
  }

  emitError(): void {
    this.onerror?.();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  MockEventSource.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GatewayWebSocketClient', () => {
  it('connects with token in the websocket url', () => {
    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-123');
    client.connect('session-1');

    expect(MockWebSocket.instances[0]?.url).toBe(
      'ws://localhost:3000/sessions/session-1/stream?token=token-123',
    );
  });

  it('sends message payload without duplicating authorization in body', () => {
    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-123');
    client.connect('session-1');
    const ws = MockWebSocket.instances[0]!;

    ws.emitOpen();
    client.send('hello', {
      agentId: 'hephaestus',
      dialogueMode: 'programmer',
      model: 'gpt-4o',
      temperature: 0.3,
      yoloMode: true,
    });

    const payload = JSON.parse(ws.send.mock.calls[0]?.[0] ?? '{}') as Record<string, unknown>;
    expect(payload).toMatchObject({
      agentId: 'hephaestus',
      dialogueMode: 'programmer',
      message: 'hello',
      model: 'gpt-4o',
      temperature: 0.3,
      yoloMode: true,
    });
    expect(typeof payload['clientRequestId']).toBe('string');
  });

  it('dispatches parsed stream chunks to subscribers', () => {
    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-123');
    const received: RunEvent[] = [];
    client.onChunk((chunk) => received.push(chunk));

    client.connect('session-1');
    MockWebSocket.instances[0]!.emitChunk({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });

    expect(received).toEqual([
      {
        type: 'tool_call_delta',
        toolCallId: 'call_1',
        toolName: 'web_search',
        inputDelta: '{"query":"上海天气"}',
      },
    ]);
  });

  it('passes through run events beyond the StreamChunk subset', () => {
    const client = new GatewayWebSocketClient('http://localhost:3000', 'token-123');
    const received: RunEvent[] = [];
    client.onChunk((chunk) => received.push(chunk));

    client.connect('session-1');
    MockWebSocket.instances[0]!.emitChunk({
      type: 'task_update',
      taskId: 'task-1',
      label: '让子代理继续分析',
      status: 'in_progress',
      assignedAgent: 'explore',
      sessionId: 'child-session-1',
      parentSessionId: 'session-1',
    });

    expect(received).toEqual([
      {
        type: 'task_update',
        taskId: 'task-1',
        label: '让子代理继续分析',
        status: 'in_progress',
        assignedAgent: 'explore',
        sessionId: 'child-session-1',
        parentSessionId: 'session-1',
      },
    ]);
  });
});

describe('GatewaySSEClient', () => {
  it('connects with token in the sse query string', () => {
    const client = new GatewaySSEClient('http://localhost:3000', 'token-123');
    client.connectAndStream('session-1', 'hello', {
      agentId: 'sisyphus-junior',
      dialogueMode: 'coding',
      model: 'gpt-4o',
      yoloMode: true,
    });

    const url = new URL(MockEventSource.instances[0]?.url ?? 'http://localhost');
    expect(url.pathname).toBe('/sessions/session-1/stream/sse');
    expect(url.searchParams.get('agentId')).toBe('sisyphus-junior');
    expect(url.searchParams.get('dialogueMode')).toBe('coding');
    expect(url.searchParams.get('message')).toBe('hello');
    expect(url.searchParams.get('model')).toBe('gpt-4o');
    expect(url.searchParams.get('token')).toBe('token-123');
    expect(url.searchParams.get('clientRequestId')).toBeTruthy();
    expect(url.searchParams.get('yoloMode')).toBe('1');
  });

  it('dispatches stream chunks and closes on done', () => {
    const client = new GatewaySSEClient('http://localhost:3000', 'token-123');
    const received: RunEvent[] = [];
    client.onChunk((chunk) => received.push(chunk));
    client.connectAndStream('session-1', 'hello');

    const es = MockEventSource.instances[0]!;
    es.emitChunk({ type: 'done', stopReason: 'end_turn' });

    expect(received).toEqual([{ type: 'done', stopReason: 'end_turn' }]);
    expect(es.close).toHaveBeenCalledTimes(1);
  });

  it('dispatches task updates without eagerly closing the stream', () => {
    const client = new GatewaySSEClient('http://localhost:3000', 'token-123');
    const received: RunEvent[] = [];
    client.onChunk((chunk) => received.push(chunk));
    client.connectAndStream('session-1', 'hello');

    const es = MockEventSource.instances[0]!;
    es.emitChunk({
      type: 'task_update',
      taskId: 'task-2',
      label: '后台子任务运行中',
      status: 'done',
      result: '子代理已经完成。',
      assignedAgent: 'explore',
      sessionId: 'child-session-2',
      parentSessionId: 'session-1',
    });

    expect(received).toEqual([
      {
        type: 'task_update',
        taskId: 'task-2',
        label: '后台子任务运行中',
        status: 'done',
        result: '子代理已经完成。',
        assignedAgent: 'explore',
        sessionId: 'child-session-2',
        parentSessionId: 'session-1',
      },
    ]);
    expect(es.close).not.toHaveBeenCalled();
  });
});
