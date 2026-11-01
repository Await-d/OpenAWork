import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMultiSessionAttach } from './use-multi-session-attach.js';
import { useLayerStore } from './team-events.js';
import { useMultiAttachStore } from './multi-attach-store.js';
import type { MultiAttachCallbacks } from '@openAwork/web-client';

const { streams } = vi.hoisted(() => ({
  streams: [] as {
    close: ReturnType<typeof vi.fn>;
    callbacks: MultiAttachCallbacks;
    token: string;
    afterSeq?: number;
  }[],
}));
vi.mock('@openAwork/web-client', async (original) => ({
  ...(await original<typeof import('@openAwork/web-client')>()),
  createMultiAttachStream: (options: {
    callbacks: MultiAttachCallbacks;
    token: string;
    afterSeq?: number;
  }) => {
    const stream = { ...options, close: vi.fn() };
    streams.push(stream);
    return { close: stream.close };
  },
}));

function seed(count = 5) {
  useLayerStore.getState().replaceAll(
    Array.from({ length: count }, (_, index) => ({
      sessionId: `session-${index}`,
      roleLayer: 'executor' as const,
      parentSessionId: null,
      state: 'running' as const,
    })),
  );
}
const options = { enabled: true, token: 'token', gatewayUrl: 'http://gateway.test' };
afterEach(() => {
  cleanup();
  useLayerStore.getState().replaceAll([]);
  useMultiAttachStore.setState({ sessions: new Map() });
  streams.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('multi-session connection budget and cleanup', () => {
  it('reserves HTTP/1 slots and closes all streams when the cached page is inactive', () => {
    seed();
    const { rerender } = renderHook((props) => useMultiSessionAttach(props), {
      initialProps: options,
    });
    expect(streams).toHaveLength(3);
    rerender({ ...options, enabled: false });
    expect(streams.every((stream) => stream.close.mock.calls.length === 1)).toBe(true);
    expect(
      [...useMultiAttachStore.getState().sessions.values()].every(
        (session) => session.state === 'closed',
      ),
    ).toBe(true);
    act(() => {
      seed(6);
    });
    expect(streams).toHaveLength(3);
    rerender(options);
    expect(streams).toHaveLength(6);
  });

  it('token replacement closes old streams before opening replacements, preserving cursors', () => {
    seed(1);
    const { rerender, unmount } = renderHook((props) => useMultiSessionAttach(props), {
      initialProps: options,
    });
    act(() => {
      useMultiAttachStore.getState().setLastRowId('session-0', 12809);
    });
    rerender({ ...options, token: 'refreshed-token' });
    expect(streams).toHaveLength(2);
    expect(streams[0]?.close).toHaveBeenCalledOnce();
    expect(streams[1]?.token).toBe('refreshed-token');
    expect(streams[1]?.afterSeq).toBe(12809);
    unmount();
    expect(streams[1]?.close).toHaveBeenCalledOnce();
  });

  it('an ended stream reconnects without refresh while its session is still running', () => {
    vi.useFakeTimers();
    seed(1);
    renderHook(() => useMultiSessionAttach(options));
    act(() => {
      streams[0]?.callbacks.onDone();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(streams).toHaveLength(2);
  });

  it('disabling the page cancels pending retries instead of reopening hidden streams', () => {
    vi.useFakeTimers();
    seed(1);
    const { rerender } = renderHook((props) => useMultiSessionAttach(props), {
      initialProps: options,
    });
    act(() => {
      streams[0]?.callbacks.onError?.('DISCONNECTED', 'network');
    });
    rerender({ ...options, enabled: false });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(streams).toHaveLength(1);
    expect(streams[0]?.close).toHaveBeenCalledOnce();
  });
});
