/**
 * Regression coverage for the `pendingCancelReason` hint in the
 * in-flight stream registry (T-CANCEL-08, workflow 260509).
 *
 * Cascade-driven stops carry a `reason` (`parent_aborted` /
 * `ancestor_aborted`) that the descendant stream's own abort
 * handler reads through `readPendingCancelReason` to label its
 * emitted `done.cancellation.reason`. Ordinary user stops omit the
 * hint and the helper falls back to the legacy `user_aborted`.
 *
 * We deliberately avoid Fastify here — these helpers are pure
 * registry mutations and are easier to verify directly.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearInFlightStreamRequest,
  readPendingCancelReason,
  registerInFlightStreamRequest,
  stopAnyInFlightStreamRequestForSession,
  stopInFlightStreamRequest,
} from '../../routes/stream-cancellation.js';

interface FixtureHandle {
  abortController: AbortController;
  clientRequestId: string;
  execution: Promise<{ statusCode: number }>;
  sessionId: string;
  userId: string;
}

function registerFixture(sessionId: string, clientRequestId: string, userId = 'u1'): FixtureHandle {
  const abortController = new AbortController();
  // The execution promise resolves immediately on abort — that lets
  // `stop*` helpers `await` it without hanging the test.
  const execution = new Promise<{ statusCode: number }>((resolve) => {
    abortController.signal.addEventListener('abort', () => resolve({ statusCode: 200 }), {
      once: true,
    });
  });
  registerInFlightStreamRequest({
    abortController,
    clientRequestId,
    execution,
    sessionId,
    userId,
  });
  return { abortController, clientRequestId, execution, sessionId, userId };
}

afterEach(() => {
  // Helpers under test only expose targeted clear; iterate any
  // leftover registry entries by brute-forcing stops on the well-
  // known fixture session ids used below. This keeps state
  // isolation cheap without exporting an internal registry handle.
  for (const sessionId of ['s-user', 's-parent', 's-child', 's-fallback']) {
    void stopAnyInFlightStreamRequestForSession({ sessionId, userId: 'u1' });
  }
});

describe('readPendingCancelReason', () => {
  it('falls back to user_aborted when no entry exists', () => {
    expect(readPendingCancelReason('missing-session', 'missing-req')).toBe('user_aborted');
  });

  it('keeps user_aborted when a stop is issued with no reason hint', async () => {
    const fx = registerFixture('s-user', 'req-user');
    await stopInFlightStreamRequest({
      sessionId: fx.sessionId,
      clientRequestId: fx.clientRequestId,
      userId: fx.userId,
    });
    // The entry stays in the map until clearInFlightStreamRequest
    // runs (which the real stream loop calls in finally), so the
    // pending hint is still readable post-abort.
    expect(readPendingCancelReason(fx.sessionId, fx.clientRequestId)).toBe('user_aborted');
    clearInFlightStreamRequest({
      clientRequestId: fx.clientRequestId,
      execution: fx.execution,
      sessionId: fx.sessionId,
    });
  });

  it('records parent_aborted when a cascade stops the entry by clientRequestId', async () => {
    const fx = registerFixture('s-parent', 'req-parent');
    await stopInFlightStreamRequest({
      sessionId: fx.sessionId,
      clientRequestId: fx.clientRequestId,
      userId: fx.userId,
      reason: 'parent_aborted',
    });
    expect(readPendingCancelReason(fx.sessionId, fx.clientRequestId)).toBe('parent_aborted');
    clearInFlightStreamRequest({
      clientRequestId: fx.clientRequestId,
      execution: fx.execution,
      sessionId: fx.sessionId,
    });
  });

  it('records ancestor_aborted when a session-wide stop forwards the hint', async () => {
    const fx = registerFixture('s-child', 'req-child');
    await stopAnyInFlightStreamRequestForSession({
      sessionId: fx.sessionId,
      userId: fx.userId,
      reason: 'ancestor_aborted',
    });
    expect(readPendingCancelReason(fx.sessionId, fx.clientRequestId)).toBe('ancestor_aborted');
    clearInFlightStreamRequest({
      clientRequestId: fx.clientRequestId,
      execution: fx.execution,
      sessionId: fx.sessionId,
    });
  });

  it('falls back to user_aborted again after the entry is cleared', async () => {
    const fx = registerFixture('s-fallback', 'req-fallback');
    await stopInFlightStreamRequest({
      sessionId: fx.sessionId,
      clientRequestId: fx.clientRequestId,
      userId: fx.userId,
      reason: 'parent_aborted',
    });
    clearInFlightStreamRequest({
      clientRequestId: fx.clientRequestId,
      execution: fx.execution,
      sessionId: fx.sessionId,
    });
    // Once the registry has dropped the entry the helper returns the
    // legacy default — important so a stale read after cleanup does
    // not mislabel a brand-new run.
    expect(readPendingCancelReason(fx.sessionId, fx.clientRequestId)).toBe('user_aborted');
  });
});
