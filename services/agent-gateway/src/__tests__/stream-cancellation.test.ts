import { describe, expect, it } from 'vitest';
import {
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  getInFlightStreamRequest,
  registerInFlightStreamRequest,
  stopAnyInFlightStreamRequestForSession,
  stopInFlightStreamRequest,
} from '../routes/stream-cancellation.js';

describe('stream cancellation registry', () => {
  it('aborts and waits for the matching in-flight request', async () => {
    const abortController = new AbortController();
    const execution = Promise.resolve({ statusCode: 200 });

    registerInFlightStreamRequest({
      abortController,
      clientRequestId: 'req-1',
      execution,
      sessionId: 'session-1',
      userId: 'user-1',
    });

    await expect(
      stopInFlightStreamRequest({
        clientRequestId: 'req-1',
        sessionId: 'session-1',
        userId: 'user-1',
      }),
    ).resolves.toBe(true);
    expect(abortController.signal.aborted).toBe(true);

    clearInFlightStreamRequest({ clientRequestId: 'req-1', execution, sessionId: 'session-1' });
  });

  it('does not stop requests owned by another user', async () => {
    const abortController = new AbortController();
    const execution = Promise.resolve({ statusCode: 200 });

    registerInFlightStreamRequest({
      abortController,
      clientRequestId: 'req-2',
      execution,
      sessionId: 'session-2',
      userId: 'user-2',
    });

    await expect(
      stopInFlightStreamRequest({
        clientRequestId: 'req-2',
        sessionId: 'session-2',
        userId: 'user-1',
      }),
    ).resolves.toBe(false);
    expect(abortController.signal.aborted).toBe(false);

    clearInFlightStreamRequest({ clientRequestId: 'req-2', execution, sessionId: 'session-2' });
  });

  it('clears only the currently registered execution', () => {
    const originalExecution = Promise.resolve({ statusCode: 200 });
    const nextExecution = Promise.resolve({ statusCode: 202 });

    registerInFlightStreamRequest({
      abortController: new AbortController(),
      clientRequestId: 'req-3',
      execution: originalExecution,
      sessionId: 'session-3',
      userId: 'user-3',
    });
    registerInFlightStreamRequest({
      abortController: new AbortController(),
      clientRequestId: 'req-3',
      execution: nextExecution,
      sessionId: 'session-3',
      userId: 'user-3',
    });

    clearInFlightStreamRequest({
      clientRequestId: 'req-3',
      execution: originalExecution,
      sessionId: 'session-3',
    });
    expect(getInFlightStreamRequest('session-3', 'req-3')?.execution).toBe(nextExecution);

    clearInFlightStreamRequest({
      clientRequestId: 'req-3',
      execution: nextExecution,
      sessionId: 'session-3',
    });
    expect(getInFlightStreamRequest('session-3', 'req-3')).toBeUndefined();
  });

  it('finds and stops any in-flight request for a session owner', async () => {
    const abortController = new AbortController();
    const execution = Promise.resolve({ statusCode: 200 });

    registerInFlightStreamRequest({
      abortController,
      clientRequestId: 'req-4',
      execution,
      sessionId: 'session-4',
      userId: 'user-4',
    });

    expect(
      getAnyInFlightStreamRequestForSession({ sessionId: 'session-4', userId: 'user-4' })
        ?.clientRequestId,
    ).toBe('req-4');
    await expect(
      stopAnyInFlightStreamRequestForSession({ sessionId: 'session-4', userId: 'user-4' }),
    ).resolves.toBe(true);
    expect(abortController.signal.aborted).toBe(true);

    clearInFlightStreamRequest({ clientRequestId: 'req-4', execution, sessionId: 'session-4' });
  });
});
