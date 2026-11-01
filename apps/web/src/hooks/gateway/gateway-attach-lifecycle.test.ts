import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { useGatewayClient, connectAttachEventSource } from './useGatewayClient.js';
import type {
  ActiveStreamSnapshot,
  AttachEventSourceLike,
  AttachableActiveStream,
} from './useGatewayClient.js';
import { useAuthStore } from '../../stores/auth/auth.js';

class TestSource {
  static instances: TestSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    TestSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}
const active = (sessionId: string): AttachableActiveStream => ({
  sessionId,
  clientRequestId: `request-${sessionId}`,
  lastSeq: 0,
  startedAtMs: 1,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  TestSource.instances = [];
});

describe('attach session lifecycle', () => {
  it.each(['close', 'unmount'] as const)(
    '%s settles an unopened attach and releases its connection',
    async (action) => {
      useAuthStore.setState({ gatewayUrl: 'http://gateway.test', accessToken: 'token' });
      vi.stubGlobal('EventSource', TestSource);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ active: active('A') }), { status: 200 })),
      );
      const { result, unmount } = renderHook(() => useGatewayClient('token'));
      let pending: ReturnType<typeof result.current.attachToActiveStream>;
      act(() => {
        pending = result.current.attachToActiveStream('A', {
          onDelta: vi.fn(),
          onDone: vi.fn(),
          onError: vi.fn(),
        });
      });
      await vi.waitFor(() => expect(TestSource.instances).toHaveLength(1));
      if (action === 'close')
        act(() => {
          result.current.closeTransports();
        });
      else unmount();
      await expect(pending!).resolves.toEqual({ status: 'stale' });
      expect(TestSource.instances[0]?.closed).toBe(true);
    },
  );

  it('unmount aborts the active-query HTTP request before it can create a connection', async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('EventSource', TestSource);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init.signal;
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const { result, unmount } = renderHook(() => useGatewayClient('token'));
    let pending: ReturnType<typeof result.current.attachToActiveStream>;
    act(() => {
      pending = result.current.attachToActiveStream('A', {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      });
    });
    unmount();
    expect(signal?.aborted).toBe(true);
    await expect(pending!).resolves.toEqual({ status: 'stale' });
    expect(TestSource.instances).toHaveLength(0);
  });

  it('opening timeout releases a stalled connection and a later attach works without refresh', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', TestSource);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ active: active('A') }), { status: 200 })),
    );
    const { result } = renderHook(() => useGatewayClient('token'));
    const callbacks = { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    let pending: ReturnType<typeof result.current.attachToActiveStream>;
    await act(async () => {
      pending = result.current.attachToActiveStream('A', callbacks);
    });
    expect(TestSource.instances).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await expect(pending!).resolves.toEqual({ status: 'transport_failed' });
    expect(TestSource.instances[0]?.closed).toBe(true);
    await act(async () => {
      pending = result.current.attachToActiveStream('A', callbacks);
    });
    await act(async () => {
      TestSource.instances[1]?.onopen?.();
    });
    await expect(pending!).resolves.toEqual({ status: 'attached' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(TestSource.instances[1]?.closed).toBe(false);
  });

  it('a late A query cannot take over a B attachment or its callbacks', async () => {
    let resolveA: ((response: Response) => void) | undefined;
    useAuthStore.setState({ gatewayUrl: 'http://gateway.test', accessToken: 'token' });
    vi.stubGlobal('EventSource', TestSource);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/A/'))
          return new Promise<Response>((resolve) => {
            resolveA = resolve;
          });
        return Promise.resolve(
          new Response(JSON.stringify({ active: active('B') }), { status: 200 }),
        );
      }),
    );
    const { result } = renderHook(() => useGatewayClient('token'));
    const callbacksA = { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    const callbacksB = { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    let a: ReturnType<typeof result.current.attachToActiveStream>;
    let b: ReturnType<typeof result.current.attachToActiveStream>;
    act(() => {
      a = result.current.attachToActiveStream('A', callbacksA);
    });
    await act(async () => {
      b = result.current.attachToActiveStream('B', callbacksB);
      await vi.waitFor(() => expect(TestSource.instances).toHaveLength(1));
      TestSource.instances[0]?.onopen?.();
      expect(await b).toEqual({ status: 'attached' });
    });
    await act(async () => {
      resolveA?.(new Response(JSON.stringify({ active: active('A') }), { status: 200 }));
      expect(await a!).toEqual({ status: 'stale' });
    });
    expect(TestSource.instances).toHaveLength(1);
    expect(TestSource.instances[0]?.closed).toBe(false);
    expect(result.current.getActiveStreamSessionId()).toBe('B');
    act(() => {
      TestSource.instances[0]?.onmessage?.({
        data: JSON.stringify({ type: 'text_delta', delta: 'B tail' }),
      } as MessageEvent);
    });
    expect(callbacksB.onDelta).toHaveBeenCalledWith('B tail');
    expect(callbacksA.onDelta).not.toHaveBeenCalled();
  });

  it('a closed source cannot update a cursor, clear callbacks, or terminate its replacement', async () => {
    const source = new TestSource('A');
    const replacement = new TestSource('B');
    let current: AttachEventSourceLike | null = null;
    const syncActiveRequest = vi.fn();
    const clearCallbacks = vi.fn();
    const resetStopRequested = vi.fn();
    const callbacks = {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onReconnectRequired: vi.fn(),
    };
    const snapshot: ActiveStreamSnapshot = {
      sessionId: 'A',
      clientRequestId: 'request-A',
      lastSeq: 0,
      startedAt: 1,
      transport: 'attach-sse',
    };
    const pending = connectAttachEventSource({
      activeStream: active('A'),
      callbacks,
      createEventSource: () => source,
      gatewayUrl: 'http://gateway.test',
      getCurrentActiveRequest: () => snapshot,
      getCurrentEventSource: () => current,
      isStopRequested: () => false,
      requestedAfterSeq: 0,
      sessionId: 'A',
      setCurrentEventSource: (next) => {
        current = next;
      },
      syncActiveRequest,
      token: 'token',
      clearCallbacks,
      resetStopRequested,
    });
    source.onopen?.();
    expect(await pending).toBe(true);
    current = replacement;
    source.onmessage?.({
      data: JSON.stringify({
        aggregateType: 'run',
        seq: 1,
        payload: { cursor: { seq: 1 }, event: { type: 'text_delta', delta: 'old' } },
      }),
    } as MessageEvent);
    source.onmessage?.({
      data: JSON.stringify({ type: 'done', stopReason: 'end_turn' }),
    } as MessageEvent);
    source.onerror?.();
    expect(syncActiveRequest).not.toHaveBeenCalled();
    expect(clearCallbacks).not.toHaveBeenCalled();
    expect(resetStopRequested).not.toHaveBeenCalled();
    expect(callbacks.onDelta).not.toHaveBeenCalled();
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(callbacks.onReconnectRequired).not.toHaveBeenCalled();
    expect(current).toBe(replacement);
    expect(replacement.closed).toBe(false);
  });
});
