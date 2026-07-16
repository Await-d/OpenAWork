// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachActiveStreamSession,
  useGatewayClient,
  connectAttachEventSource,
  formatGatewayStreamErrorMessage,
  resolveChatWsLivenessAction,
  safeParseGatewayEventData,
  STREAM_CLIENT_ERROR_MESSAGES,
} from './useGatewayClient.js';
import { useAuthStore } from '../../stores/auth/auth.js';

class MockEventSource {
  static instances: MockEventSource[] = [];

  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
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

interface TestActiveStreamSnapshot {
  clientRequestId: string;
  lastSeq: number;
  sessionId: string;
  startedAt: number;
  transport: 'attach-sse' | 'sse' | 'ws';
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
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
    this.onclose?.();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  MockEventSource.instances.length = 0;
  MockWebSocket.instances.length = 0;
});

describe('safeParseGatewayEventData', () => {
  it('在损坏的 SSE 数据上返回 null 并触发中文错误', () => {
    const onError = vi.fn();

    const result = safeParseGatewayEventData({
      rawData: '{broken-json',
      invalidCode: 'SSE_INVALID_PAYLOAD',
      invalidMessage: STREAM_CLIENT_ERROR_MESSAGES.sseInvalidPayload,
      onError,
    });

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith('SSE_INVALID_PAYLOAD', 'SSE 数据解析失败。');
  });

  it('在损坏的 WS 数据上返回 null 并触发中文错误', () => {
    const onError = vi.fn();

    const result = safeParseGatewayEventData({
      rawData: '{broken-json',
      invalidCode: 'WS_INVALID_PAYLOAD',
      invalidMessage: STREAM_CLIENT_ERROR_MESSAGES.wsInvalidPayload,
      onError,
    });

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith('WS_INVALID_PAYLOAD', 'WebSocket 数据解析失败。');
  });
});

describe('formatGatewayStreamErrorMessage', () => {
  it('优先返回服务端 message', () => {
    expect(formatGatewayStreamErrorMessage('SSE_ERROR', '后端给出的具体错误')).toBe(
      '后端给出的具体错误',
    );
  });

  it('能把常见机器码转换为用户文案', () => {
    expect(formatGatewayStreamErrorMessage('REQUEST_REPLAY_FAILED')).toBe('请求重放失败。');
    expect(formatGatewayStreamErrorMessage('SESSION_ALREADY_RUNNING')).toBe(
      '当前会话已有请求正在运行。',
    );
    expect(formatGatewayStreamErrorMessage('MODEL_ERROR')).toBe('模型响应失败，请稍后重试。');
    expect(formatGatewayStreamErrorMessage('STREAM_ERROR')).toBe('流式响应处理中断，请稍后重试。');
    expect(formatGatewayStreamErrorMessage('V2_UPSTREAM_ERROR')).toBe(
      '上游模型服务暂时不可用，请稍后重试。',
    );
    expect(formatGatewayStreamErrorMessage('WS_STREAM_ERROR')).toBe(
      'WebSocket 流式响应处理中断，请稍后重试。',
    );
    expect(formatGatewayStreamErrorMessage('SSE_STREAM_ERROR')).toBe(
      'SSE 流式响应处理中断，请稍后重试。',
    );
    expect(formatGatewayStreamErrorMessage('ATTACH_STREAM_INVALID_PAYLOAD')).toBe(
      '实时流数据解析失败。',
    );
    expect(formatGatewayStreamErrorMessage('SSE_INVALID_PAYLOAD')).toBe('SSE 数据解析失败。');
    expect(formatGatewayStreamErrorMessage('WS_INVALID_PAYLOAD')).toBe('WebSocket 数据解析失败。');
  });
});

describe('connectAttachEventSource', () => {
  it('attach SSE 收到损坏 payload 时走 onError，不抛异常', async () => {
    let currentEventSource: MockEventSource | null = null;
    let currentActiveRequest: TestActiveStreamSnapshot | null = {
      clientRequestId: 'req-attach',
      lastSeq: 0,
      sessionId: 'session-1',
      startedAt: 1,
      transport: 'attach-sse' as const,
    };

    const callbacks = {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    const eventSource = new MockEventSource('https://gw.test/sessions/session-1/stream/attach');

    const connectPromise = connectAttachEventSource({
      activeStream: {
        clientRequestId: 'req-attach',
        lastSeq: 0,
        sessionId: 'session-1',
        startedAtMs: 1,
      },
      callbacks,
      createEventSource: () => eventSource,
      gatewayUrl: 'https://gw.test',
      getCurrentActiveRequest: () => currentActiveRequest,
      getCurrentEventSource: () => currentEventSource,
      isStopRequested: () => false,
      requestedAfterSeq: 0,
      sessionId: 'session-1',
      setCurrentEventSource: (next) => {
        currentEventSource = next as MockEventSource | null;
      },
      syncActiveRequest: (next) => {
        currentActiveRequest = next;
      },
      token: 'token-test',
      clearCallbacks: vi.fn(),
      resetStopRequested: vi.fn(),
    });

    act(() => {
      eventSource.onopen?.();
    });

    await expect(connectPromise).resolves.toBe(true);

    act(() => {
      eventSource.onmessage?.({ data: '{broken-json' } as MessageEvent);
    });

    expect(callbacks.onError).toHaveBeenCalledWith(
      'ATTACH_STREAM_INVALID_PAYLOAD',
      '实时流数据解析失败。',
    );
    expect(eventSource.closed).toBe(true);
  });

  it('attach SSE 收到 run envelope 时会推进 lastSeq，重复 eventId 不重复分发', async () => {
    let currentEventSource: MockEventSource | null = null;
    let currentActiveRequest: TestActiveStreamSnapshot | null = {
      clientRequestId: 'req-attach',
      lastSeq: 2,
      sessionId: 'session-1',
      startedAt: 1,
      transport: 'attach-sse',
    };

    const callbacks = {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    const eventSource = new MockEventSource('https://gw.test/sessions/session-1/stream/attach');
    const connectPromise = connectAttachEventSource({
      activeStream: {
        clientRequestId: 'req-attach',
        lastSeq: 2,
        sessionId: 'session-1',
        startedAtMs: 1,
      },
      callbacks,
      createEventSource: () => eventSource,
      gatewayUrl: 'https://gw.test',
      getCurrentActiveRequest: () => currentActiveRequest,
      getCurrentEventSource: () => currentEventSource,
      isStopRequested: () => false,
      requestedAfterSeq: 2,
      sessionId: 'session-1',
      setCurrentEventSource: (next) => {
        currentEventSource = next as MockEventSource | null;
      },
      syncActiveRequest: (next) => {
        currentActiveRequest = next;
      },
      token: 'token-test',
      clearCallbacks: vi.fn(),
      resetStopRequested: vi.fn(),
    });

    act(() => {
      eventSource.onopen?.();
    });

    await expect(connectPromise).resolves.toBe(true);

    act(() => {
      eventSource.onmessage?.({
        data: JSON.stringify({
          aggregateType: 'run',
          seq: 3,
          payload: {
            cursor: { seq: 3 },
            event: {
              type: 'text_delta',
              delta: 'hello',
              eventId: 'evt-attach-3',
            },
          },
        }),
      } as MessageEvent);
      eventSource.onmessage?.({
        data: JSON.stringify({
          aggregateType: 'run',
          seq: 4,
          payload: {
            cursor: { seq: 4 },
            event: {
              type: 'text_delta',
              delta: 'hello',
              eventId: 'evt-attach-3',
            },
          },
        }),
      } as MessageEvent);
    });

    expect(currentActiveRequest).toMatchObject({
      clientRequestId: 'req-attach',
      lastSeq: 4,
      sessionId: 'session-1',
      transport: 'attach-sse',
    });
    expect(callbacks.onDelta).toHaveBeenCalledTimes(1);
    expect(callbacks.onDelta).toHaveBeenCalledWith('hello');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});

describe('attachActiveStreamSession', () => {
  it('续挂同一 clientRequestId 时会用客户端已见 lastSeq 作为 afterSeq', async () => {
    const connectEventSource = vi.fn(async () => true);
    const clearCallbacks = vi.fn();
    const closeExistingTransports = vi.fn();
    const resetStopRequested = vi.fn();
    const setCallbacks = vi.fn();
    const setCurrentEventSource = vi.fn();
    let currentActiveRequest: TestActiveStreamSnapshot | null = {
      clientRequestId: 'req-attach',
      lastSeq: 7,
      sessionId: 'session-1',
      startedAt: 1,
      transport: 'attach-sse',
    };

    const attached = await attachActiveStreamSession({
      callbacks: {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      },
      clearCallbacks,
      closeExistingTransports,
      connectEventSource,
      gatewayUrl: 'https://gw.test',
      getCurrentActiveRequest: () => currentActiveRequest,
      getCurrentEventSource: () => null,
      hasOpenTransports: () => false,
      isStopRequested: () => false,
      resetStopRequested,
      sessionId: 'session-1',
      sessionsClient: {
        getActiveStream: vi.fn(async () => ({
          clientRequestId: 'req-attach',
          lastSeq: 9,
          sessionId: 'session-1',
          startedAtMs: 10,
        })),
      },
      setCallbacks,
      setCurrentEventSource,
      syncActiveRequest: (next) => {
        currentActiveRequest = next;
      },
      token: 'token-test',
    });

    expect(attached).toBe(true);
    expect(connectEventSource).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedAfterSeq: 7,
      }),
    );
    expect(currentActiveRequest).toMatchObject({
      clientRequestId: 'req-attach',
      lastSeq: 7,
      sessionId: 'session-1',
      transport: 'attach-sse',
    });
    expect(setCallbacks).toHaveBeenCalledTimes(1);
    expect(closeExistingTransports).toHaveBeenCalledTimes(1);
    expect(resetStopRequested).toHaveBeenCalledTimes(1);
    expect(clearCallbacks).not.toHaveBeenCalled();
  });
});

describe('resolveChatWsLivenessAction (§0.153 半开探活)', () => {
  it('服务端活动在容忍窗口内时继续 ping', () => {
    expect(
      resolveChatWsLivenessAction({ msSinceLastServerActivity: 10_000, livenessTimeoutMs: 40_000 }),
    ).toBe('ping');
  });

  it('刚好等于容忍窗口时仍 ping（边界不误杀）', () => {
    expect(
      resolveChatWsLivenessAction({ msSinceLastServerActivity: 40_000, livenessTimeoutMs: 40_000 }),
    ).toBe('ping');
  });

  it('服务端静默超过容忍窗口时判定 reconnect（半开 → 拆除回退 SSE）', () => {
    expect(
      resolveChatWsLivenessAction({ msSinceLastServerActivity: 40_001, livenessTimeoutMs: 40_000 }),
    ).toBe('reconnect');
  });

  it('默认容忍窗口：单次丢 pong（15s）不误判，长期静默才 reconnect', () => {
    expect(resolveChatWsLivenessAction({ msSinceLastServerActivity: 16_000 })).toBe('ping');
    expect(resolveChatWsLivenessAction({ msSinceLastServerActivity: 60_000 })).toBe('reconnect');
  });
});

describe('useGatewayClient', () => {
  it('WS 断开后切到 SSE replay 时，不会重复分发已经收到过的 eventId', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('EventSource', MockEventSource);
    useAuthStore.setState({
      accessToken: 'token-test',
      clearAuth: () => undefined,
      email: 'qa@example.com',
      gatewayUrl: 'https://gw.test',
      refreshAccessToken: async () => undefined,
      refreshToken: null,
      setAuth: () => undefined,
      setGatewayUrl: () => undefined,
      setWebAccess: () => undefined,
      tokenExpiresAt: null,
      webAccessEnabled: false,
      webExposeLan: false,
      webPort: 3000,
    });

    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useGatewayClient('token-test'));

    act(() => {
      result.current.stream('session-1', 'hello', {
        onDelta,
        onDone,
        onError,
      });
    });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    act(() => {
      ws?.onopen?.();
      ws?.onmessage?.({
        data: JSON.stringify({
          type: 'text_delta',
          delta: 'hello',
          eventId: 'evt-1',
        }),
      } as MessageEvent);
      ws?.onclose?.();
    });

    const sse = MockEventSource.instances[0];
    expect(sse?.url).toContain('/sessions/session-1/stream/sse?');

    act(() => {
      sse?.onmessage?.({
        data: JSON.stringify({
          type: 'text_delta',
          delta: 'hello',
          eventId: 'evt-1',
        }),
      } as MessageEvent);
      sse?.onmessage?.({
        data: JSON.stringify({
          type: 'done',
          stopReason: 'end_turn',
          eventId: 'evt-2',
        }),
      } as MessageEvent);
    });

    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('hello');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
