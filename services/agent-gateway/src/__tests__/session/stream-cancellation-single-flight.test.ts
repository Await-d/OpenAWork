import { afterEach, describe, expect, it } from 'vitest';
import {
  clearInFlightStreamRequest,
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
