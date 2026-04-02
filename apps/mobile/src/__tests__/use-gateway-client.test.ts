import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import { MobileGatewayClient } from '../hooks/useGatewayClient.js';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { wasClean: boolean }) => void) | null = null;
  readonly send = vi.fn<(payload: string) => void>();
  readonly close = vi.fn<(code?: number, reason?: string) => void>(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ wasClean: true });
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(event: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MobileGatewayClient', () => {
  it('connects with token in websocket query string', () => {
    const client = new MobileGatewayClient('http://localhost:3000', 'token-123');

    client.connect('session-1', {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
    });

    expect(MockWebSocket.instances[0]?.url).toBe(
      'ws://localhost:3000/sessions/session-1/stream?token=token-123',
    );
  });

  it('queues request payload until socket opens and omits authorization in body', () => {
    const client = new MobileGatewayClient('http://localhost:3000', 'token-123');
    client.connect('session-1', {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
    });
    const ws = MockWebSocket.instances[0]!;

    client.send('hello mobile');
    expect(ws.send).not.toHaveBeenCalled();

    ws.emitOpen();

    const payload = JSON.parse(ws.send.mock.calls[0]?.[0] ?? '{}') as Record<string, unknown>;
    expect(payload).toMatchObject({ message: 'hello mobile' });
    expect(typeof payload['clientRequestId']).toBe('string');
    expect(payload['authorization']).toBeUndefined();
  });

  it('emits task_update as mobile activity events', () => {
    const activities: Array<Record<string, unknown>> = [];
    const client = new MobileGatewayClient('http://localhost:3000', 'token-123');
    client.connect('session-1', {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
      onActivity: (event) => activities.push(event as unknown as Record<string, unknown>),
    });
    const ws = MockWebSocket.instances[0]!;

    ws.emitMessage({
      type: 'task_update',
      taskId: 'task-1',
      label: '分析目录结构',
      status: 'done',
      assignedAgent: 'explore',
      sessionId: 'child-1',
      result: '目录结构已分析完成。',
    });

    expect(activities).toEqual([
      {
        kind: 'task_update',
        id: 'task-1',
        name: '@explore · 分析目录结构',
        status: 'done',
        assignedAgent: 'explore',
        sessionId: 'child-1',
        output: '目录结构已分析完成。',
      },
    ]);
  });

  it('invokes onConnected when websocket opens', () => {
    const onConnected = vi.fn();
    const client = new MobileGatewayClient('http://localhost:3000', 'token-123');

    client.connect('session-1', {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
      onConnected,
    });

    MockWebSocket.instances[0]?.emitOpen();

    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});
