/**
 * Regression coverage for `deriveRunEventBookend` cancellation
 * forwarding (T-CANCEL-07, workflow 260509).
 *
 * The historical `run_cancelled` envelope only carried `stopReason:
 * 'cancelled'`, which meant a UI replaying persisted run events
 * could never reconstruct the cascade summary that the live `done`
 * chunk surfaced. The fix forwards the optional `cancellation`
 * field onto the envelope so timeline / transcript renderers see
 * the same payload as the live stream.
 *
 * Tests stay focused on the cancellation branch — coverage for the
 * other RunEvent kinds would belong with their own targeted tests.
 */

import { describe, expect, it } from 'vitest';

import { deriveRunEventBookend } from '../../session/run-event-envelope.js';

describe('deriveRunEventBookend — cancellation', () => {
  it('forwards a populated cancellation summary onto the run_cancelled envelope', () => {
    const envelope = deriveRunEventBookend({
      type: 'done',
      stopReason: 'cancelled',
      cancellation: {
        reason: 'parent_aborted',
        descendantSessions: 3,
        cancelledStreams: 2,
        cascadeDurationMs: 120,
        timedOut: false,
      },
    });
    // The narrowing here is for the test reader — `kind` already
    // disambiguates the union, so accessing `cancellation` is sound.
    expect(envelope?.kind).toBe('run_cancelled');
    expect(envelope).toMatchObject({
      kind: 'run_cancelled',
      terminal: true,
      replayable: true,
      stopReason: 'cancelled',
      cancellation: {
        reason: 'parent_aborted',
        descendantSessions: 3,
        cancelledStreams: 2,
        cascadeDurationMs: 120,
        timedOut: false,
      },
    });
  });

  it('omits cancellation entirely when the source done chunk has none', () => {
    const envelope = deriveRunEventBookend({
      type: 'done',
      stopReason: 'cancelled',
    });
    expect(envelope?.kind).toBe('run_cancelled');
    // Spread-only forwarding: no cascade summary → no key on the
    // envelope. We assert the absence rather than `undefined` so a
    // future regression that emits `cancellation: undefined`
    // (which serialises to `null` over JSON) gets caught.
    expect(envelope && 'cancellation' in envelope).toBe(false);
  });

  it('keeps the non-cancelled run_completed branch untouched', () => {
    const envelope = deriveRunEventBookend({
      type: 'done',
      stopReason: 'end_turn',
      // Even if a producer accidentally attaches cancellation to a
      // non-cancelled done chunk, the envelope must not leak it
      // onto a `run_completed` shape — the union does not declare
      // a slot there and the UI relies on that invariant.
      cancellation: {
        reason: 'user_aborted',
        descendantSessions: 0,
        cancelledStreams: 0,
        cascadeDurationMs: 0,
        timedOut: false,
      },
    });
    expect(envelope?.kind).toBe('run_completed');
    expect(envelope && 'cancellation' in envelope).toBe(false);
  });
});
