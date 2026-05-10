/**
 * Tests for the workspace-rebind guard that backs the
 * `PATCH /sessions/:id/workspace` route's default-deny behaviour
 * (P3-WARP stage 0, workflow 260509).
 *
 * The route uses `isSessionWorkspaceRebindingAttempt` to decide
 * whether the request needs the explicit `force: true` opt-in.
 * Anything that returns `true` here without `force` becomes a 409
 * `SESSION_WORKSPACE_IMMUTABLE_ERROR`. Everything that returns
 * `false` is a no-op or an additive bind that flows through.
 *
 * Coverage focuses on the boundary cases the route depends on:
 *   - Sessions with no workspace yet (the additive-bind path).
 *   - Sessions already bound, considering an unrelated path.
 *   - Sessions already bound, asked to clear the binding.
 *   - Same-path requests (an idempotent re-bind, not a rebind).
 *   - `undefined` next path (the partial-update path the metadata
 *     PATCH route uses when the caller did not include
 *     `workingDirectory` at all).
 */

import { describe, expect, it } from 'vitest';

import {
  extractSessionWorkingDirectory,
  isSessionWorkspaceRebindingAttempt,
} from '../session-workspace-metadata.js';

describe('isSessionWorkspaceRebindingAttempt', () => {
  it('returns false when the session has no workspace yet (additive bind)', () => {
    expect(isSessionWorkspaceRebindingAttempt({}, '/home/me/proj')).toBe(false);
    expect(isSessionWorkspaceRebindingAttempt({}, null)).toBe(false);
  });

  it('returns false when the next path matches the current binding (idempotent)', () => {
    const meta = { workingDirectory: '/home/me/proj' };
    expect(isSessionWorkspaceRebindingAttempt(meta, '/home/me/proj')).toBe(false);
  });

  it('returns true when the request switches an already-bound session to a different path', () => {
    const meta = { workingDirectory: '/home/me/proj' };
    expect(isSessionWorkspaceRebindingAttempt(meta, '/home/me/other')).toBe(true);
  });

  it('returns true when the request clears an already-bound session', () => {
    // null is treated as "explicit clear" by the warp endpoint and
    // must trip the lock — clearing the workspace would silently
    // break every later tool call that resolved the original path.
    const meta = { workingDirectory: '/home/me/proj' };
    expect(isSessionWorkspaceRebindingAttempt(meta, null)).toBe(true);
  });

  it('returns false when the next path is undefined (partial PATCH)', () => {
    // The generic `/sessions/:id` PATCH delegates to this helper too;
    // when the caller did not even include workingDirectory in the
    // body we must not pretend they tried to rebind.
    const meta = { workingDirectory: '/home/me/proj' };
    expect(isSessionWorkspaceRebindingAttempt(meta, undefined)).toBe(false);
  });

  it('treats malformed metadata as "no current workspace"', () => {
    // The metadata blob can carry non-string workingDirectory after
    // a botched migration; the helper must not throw and must allow
    // any forward-bind to proceed in that degraded state.
    const meta: Record<string, unknown> = { workingDirectory: 42 };
    expect(extractSessionWorkingDirectory(meta)).toBeNull();
    expect(isSessionWorkspaceRebindingAttempt(meta, '/home/me/proj')).toBe(false);
    expect(isSessionWorkspaceRebindingAttempt(meta, null)).toBe(false);
  });
});
