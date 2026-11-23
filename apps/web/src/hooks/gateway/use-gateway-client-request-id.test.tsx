// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useGatewayClient } from './useGatewayClient.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = MockWebSocket.OPEN;
  sentPayloads: string[] = [];

  constructor(_url: string) {
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

let previousAuthState: ReturnType<typeof useAuthStore.getState>;

beforeEach(() => {
  previousAuthState = useAuthStore.getState();
  sessionStorage.clear();
  vi.stubGlobal('WebSocket', MockWebSocket);
  useAuthStore.setState({
    accessToken: 'token-test',
    gatewayUrl: 'https://gw.test',
    tokenExpiresAt: null,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useAuthStore.setState(previousAuthState, true);
  sessionStorage.clear();
  MockWebSocket.instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useGatewayClient 请求 ID', () => {
  it('stream 返回后同步提供新请求 ID，且 WS 打开后发送同一 ID', () => {
    const { result } = renderHook(() => useGatewayClient('token-test'));

    expect(result.current.getActiveStreamClientRequestId()).toBeNull();

    act(() => {
      result.current.stream('session-sync-request-id', 'hello', {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      });
      // 必须在同一同步调用栈读取，不能依赖重渲染、连接打开或服务端确认。
      const clientRequestId = result.current.getActiveStreamClientRequestId();
      expect(clientRequestId).toEqual(expect.stringMatching(/\S/));

      const ws = MockWebSocket.instances[0];
      expect(ws?.sentPayloads).toEqual([]);
      ws?.onopen?.();

      expect(ws?.sentPayloads).toHaveLength(1);
      expect(JSON.parse(ws?.sentPayloads[0] ?? '{}')).toEqual(
        expect.objectContaining({
          clientRequestId,
          message: 'hello',
        }),
      );
    });
  });

  it('连接建立前停止会取消本次发送，晚到的连接事件不会发送旧消息', async () => {
    const fetchMock = vi.fn(async () => Response.json({ stopped: false }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const { result } = renderHook(() => useGatewayClient('token-test'));

    act(() => {
      result.current.stream('session-quick-stop', '第一条消息', {
        onDelta: vi.fn(),
        onDone,
        onError: vi.fn(),
      });
    });
    const firstSocket = MockWebSocket.instances[0];

    await act(async () => {
      expect(await result.current.stopStream()).toBe(true);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(result.current.getActiveStreamClientRequestId()).toBeNull();

    act(() => {
      result.current.stream('session-quick-stop', '下一条消息', {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      });
      firstSocket?.onopen?.();
      MockWebSocket.instances[1]?.onopen?.();
    });
    expect(firstSocket?.sentPayloads).toEqual([]);
    expect(MockWebSocket.instances[1]?.sentPayloads).toEqual([
      expect.stringContaining('下一条消息'),
    ]);
  });

  it('消息刚发出但网关尚未登记请求时，停止会短暂重试直到网关确认', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ stopped: false }))
      .mockResolvedValueOnce(Response.json({ stopped: true }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const { result } = renderHook(() => useGatewayClient('token-test'));

    act(() => {
      result.current.stream('session-stop-race', '快速发送', {
        onDelta: vi.fn(),
        onDone,
        onError: vi.fn(),
      });
      MockWebSocket.instances[0]?.onopen?.();
    });

    const clientRequestId = result.current.getActiveStreamClientRequestId();
    await act(async () => {
      const stopPromise = result.current.stopStream();
      await vi.advanceTimersByTimeAsync(100);
      expect(await stopPromise).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, request] of fetchMock.mock.calls) {
      expect(request?.body).toBe(JSON.stringify({ clientRequestId }));
    }

    act(() => {
      MockWebSocket.instances[0]?.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'done', stopReason: 'cancelled' }),
        }),
      );
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0]).toBe('cancelled');
    expect(result.current.getActiveStreamClientRequestId()).toBeNull();
  });

  it('停止确认前流连接断开，仍会重试停止原请求', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ stopped: false }))
      .mockResolvedValueOnce(Response.json({ stopped: true }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const { result } = renderHook(() => useGatewayClient('token-test'));

    act(() => {
      result.current.stream('session-stop-disconnect', '快速发送', {
        onDelta: vi.fn(),
        onDone,
        onError: vi.fn(),
      });
      MockWebSocket.instances[0]?.onopen?.();
    });

    await act(async () => {
      const stopPromise = result.current.stopStream();
      MockWebSocket.instances[0]?.close();
      expect(onDone).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(await stopPromise).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledExactlyOnceWith('cancelled');
  });

  it.each([true, false])('切换会话后仍重试停止原请求，网关确认结果为 %s', async (stopped) => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ stopped: false }))
      .mockImplementation(async () => Response.json({ stopped }));
    vi.stubGlobal('fetch', fetchMock);
    const oldOnDone = vi.fn();
    const newOnDone = vi.fn();
    const { result } = renderHook(() => useGatewayClient('token-test'));

    act(() => {
      result.current.stream('session-before-switch', '原消息', {
        onDelta: vi.fn(),
        onDone: oldOnDone,
        onError: vi.fn(),
      });
      MockWebSocket.instances[0]?.onopen?.();
    });
    const clientRequestId = result.current.getActiveStreamClientRequestId();

    await act(async () => {
      const stopPromise = result.current.stopStream();
      await vi.advanceTimersByTimeAsync(0);
      result.current.closeTransports();
      result.current.stream('session-after-switch', '新消息', {
        onDelta: vi.fn(),
        onDone: newOnDone,
        onError: vi.fn(),
      });
      MockWebSocket.instances[1]?.onopen?.();
      const newRequestId = result.current.getActiveStreamClientRequestId();

      await vi.advanceTimersByTimeAsync(1850);
      expect(await stopPromise).toBe(stopped);
      expect(newRequestId).not.toBe(clientRequestId);
      expect(result.current.getActiveStreamClientRequestId()).toBe(newRequestId);
    });

    expect(fetchMock).toHaveBeenCalledTimes(stopped ? 2 : 5);
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe('https://gw.test/sessions/session-before-switch/stream/stop');
      expect(request?.body).toBe(JSON.stringify({ clientRequestId }));
    }
    expect(oldOnDone).not.toHaveBeenCalled();
    expect(newOnDone).not.toHaveBeenCalled();
    expect(MockWebSocket.instances[1]?.readyState).toBe(MockWebSocket.OPEN);
  });
});
