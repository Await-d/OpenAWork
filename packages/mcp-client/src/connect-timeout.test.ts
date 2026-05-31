import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWithTimeout } from './adapter.js';
import { MCPTimeoutError } from './error-handler.js';

/**
 * Minimal SDK-client stand-in. `connectWithTimeout` only touches
 * `connect` and `close`, so we model just those.
 */
function makeFakeClient(input: {
  connect: () => Promise<void>;
  onClose?: () => void;
}): Parameters<typeof connectWithTimeout>[1] {
  return {
    connect: input.connect,
    close: async () => {
      input.onClose?.();
    },
  } as unknown as Parameters<typeof connectWithTimeout>[1];
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('connectWithTimeout', () => {
  it('握手挂起超过阈值时抛 MCPTimeoutError 并关闭半开连接', async () => {
    vi.useFakeTimers();
    let closed = false;
    const client = makeFakeClient({
      // Never resolves — simulates a server that accepts the socket but
      // never answers `initialize`.
      connect: () => new Promise<void>(() => undefined),
      onClose: () => {
        closed = true;
      },
    });

    const promise = connectWithTimeout('srv-hang', client, {});
    // Attach a rejection handler synchronously so advancing timers doesn't
    // surface an unhandled rejection before we await.
    const settled = expect(promise).rejects.toBeInstanceOf(MCPTimeoutError);

    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
    expect(closed).toBe(true);
  });

  it('正常握手直接透传，不触发关闭', async () => {
    let closed = false;
    const client = makeFakeClient({
      connect: () => Promise.resolve(),
      onClose: () => {
        closed = true;
      },
    });

    await expect(connectWithTimeout('srv-ok', client, {})).resolves.toBeUndefined();
    expect(closed).toBe(false);
  });

  it('握手以非超时错误失败时原样抛出，不触发关闭', async () => {
    let closed = false;
    const client = makeFakeClient({
      connect: () => Promise.reject(new Error('ECONNREFUSED')),
      onClose: () => {
        closed = true;
      },
    });

    await expect(connectWithTimeout('srv-refused', client, {})).rejects.toThrow('ECONNREFUSED');
    expect(closed).toBe(false);
  });
});
