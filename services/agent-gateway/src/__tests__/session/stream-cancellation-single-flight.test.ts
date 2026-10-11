import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STREAM_REQUEST_LOCK_TTL_MS,
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  getInFlightStreamRequest,
  reserveInFlightStreamRequest,
} from '../../routes/stream-cancellation.js';

describe('stream request single-flight reservation', () => {
  const sessionId = 'single-flight-session';
  const clientRequestId = 'single-flight-request';
  const userId = 'single-flight-user';

  afterEach(() => {
    const current = getInFlightStreamRequest(sessionId, clientRequestId);
    if (current) {
      clearInFlightStreamRequest({
        clientRequestId,
        execution: current.execution,
        sessionId,
      });
    }
  });

  it('same request id reserves one owner before asynchronous preparation completes', async () => {
    const first = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    const second = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });

    expect(first.owner).toBe(true);
    expect(second.owner).toBe(false);
    expect(second.execution).toBe(first.execution);

    first.resolve({ statusCode: 200 });
    await expect(second.execution).resolves.toEqual({ statusCode: 200 });
  });

  it('releases a failed reservation so a retry can become the next owner', async () => {
    const first = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    const follower = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    const failure = new Error('准备阶段失败');

    first.reject(failure);
    await expect(follower.execution).rejects.toThrow(failure);
    clearInFlightStreamRequest({
      clientRequestId,
      execution: first.execution,
      sessionId,
    });

    const retry = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    expect(retry.owner).toBe(true);
    retry.resolve({ statusCode: 200 });
  });
});

describe('stream request run lock TTL', () => {
  const sessionId = 'ttl-session';
  const clientRequestId = 'ttl-request';
  const userId = 'ttl-user';

  afterEach(() => {
    vi.useRealTimers();
    const current = getInFlightStreamRequest(sessionId, clientRequestId);
    if (current) {
      clearInFlightStreamRequest({
        clientRequestId,
        execution: current.execution,
        sessionId,
      });
    }
  });

  it('TTL 内仍是单飞:同 clientRequestId 复用同一 execution', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const first = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    vi.setSystemTime(new Date(Date.now() + STREAM_REQUEST_LOCK_TTL_MS - 1));
    const follower = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });

    expect(follower.owner).toBe(false);
    expect(follower.execution).toBe(first.execution);

    first.resolve({ statusCode: 200 });
  });

  it('超过 TTL 的死亡锁被回收:同会话不再被判定为「正在运行」', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const first = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    expect(getAnyInFlightStreamRequestForSession({ sessionId, userId })).toBeDefined();

    vi.setSystemTime(new Date(Date.now() + STREAM_REQUEST_LOCK_TTL_MS));

    expect(getAnyInFlightStreamRequestForSession({ sessionId, userId })).toBeUndefined();
    expect(getInFlightStreamRequest(sessionId, clientRequestId)).toBeUndefined();

    first.resolve({ statusCode: 200 });
  });

  it('超过 TTL 后同 clientRequestId 重试可成为新的 owner', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const first = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    vi.setSystemTime(new Date(Date.now() + STREAM_REQUEST_LOCK_TTL_MS));

    const retry = reserveInFlightStreamRequest({ sessionId, clientRequestId, userId });
    expect(retry.owner).toBe(true);
    expect(retry.execution).not.toBe(first.execution);

    retry.resolve({ statusCode: 200 });
    first.resolve({ statusCode: 200 });
  });
});
