/**
 * Regression coverage for {@link cancelDescendantSessionStreams}.
 *
 * Mirrors opencode #25798: when a parent session's stream is aborted
 * the helper must:
 *   - traverse every descendant in the lineage (BFS, no duplicates,
 *     visited-set protects against cycles)
 *   - call the per-session stop function and `await` its result so
 *     each child's stream has a chance to drain run events / tool
 *     results before the parent's "cancelled" state is committed
 *   - tolerate per-child stop failures (log + count zero, keep going)
 *   - bound the total wait at `timeoutMs` so a stuck child cannot
 *     hang the user's stop UX
 *
 * The helper accepts a `deps` object so the tests can supply a fake
 * sessions table and a controllable stop function without touching
 * SQLite or the real `inFlightStreamRequests` map.
 */

import { describe, expect, it } from 'vitest';

import {
  cancelDescendantSessionStreams,
  type CancelDescendantSessionStreamsDeps,
} from '../../session/cancel-descendant-streams.js';

interface FakeSession {
  id: string;
  metadata_json: string;
}

function makeSession(id: string, parentSessionId?: string): FakeSession {
  return {
    id,
    metadata_json: JSON.stringify(parentSessionId ? { parentSessionId } : {}),
  };
}

describe('cancelDescendantSessionStreams', () => {
  it('returns zero descendants when the root has no children', async () => {
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1' },
      {
        loadUserSessions: () => [makeSession('parent'), makeSession('unrelated')],
        stopForSession: async () => {
          throw new Error('stop should not be called');
        },
      },
    );
    expect(result.visitedDescendantSessionIds).toEqual([]);
    expect(result.cancelledStreamCount).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.reason).toBe('parent_aborted');
  });

  it('cancels a single child and reports the count', async () => {
    const stops: string[] = [];
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1' },
      {
        loadUserSessions: () => [makeSession('parent'), makeSession('child', 'parent')],
        stopForSession: async ({ sessionId }) => {
          stops.push(sessionId);
          return 1;
        },
      },
    );
    expect(stops).toEqual(['child']);
    expect(result.visitedDescendantSessionIds).toEqual(['child']);
    expect(result.cancelledStreamCount).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it('recurses into grandchildren in BFS order', async () => {
    const stops: string[] = [];
    const sessions = [
      makeSession('parent'),
      makeSession('child-a', 'parent'),
      makeSession('child-b', 'parent'),
      makeSession('grandchild-a1', 'child-a'),
      makeSession('grandchild-b1', 'child-b'),
      makeSession('great-a1-1', 'grandchild-a1'),
    ];
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1' },
      {
        loadUserSessions: () => sessions,
        stopForSession: async ({ sessionId }) => {
          stops.push(sessionId);
          return 1;
        },
      },
    );
    // BFS layered: children first, then grandchildren, then great-grandchildren.
    expect(stops).toEqual(['child-a', 'child-b', 'grandchild-a1', 'grandchild-b1', 'great-a1-1']);
    expect(result.visitedDescendantSessionIds).toEqual(stops);
    expect(result.cancelledStreamCount).toBe(5);
    expect(result.timedOut).toBe(false);
  });

  it('does not visit the same descendant twice when the lineage forms a cycle', async () => {
    // Defensive: if the metadata_json somehow declares a cycle the
    // visited-set must keep us from looping forever.
    const stops: string[] = [];
    const sessions = [
      makeSession('parent'),
      makeSession('child', 'parent'),
      makeSession('grandchild', 'child'),
      // Bogus cycle: grandchild claims parent as its parent again.
      { id: 'parent-2', metadata_json: JSON.stringify({ parentSessionId: 'grandchild' }) },
    ];
    // Mutate the parent row to point back at the grandchild.
    sessions[0] = {
      ...sessions[0]!,
      metadata_json: JSON.stringify({ parentSessionId: 'grandchild' }),
    };
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1' },
      {
        loadUserSessions: () => sessions,
        stopForSession: async ({ sessionId }) => {
          stops.push(sessionId);
          return 1;
        },
        // Fail the test if the loop runs longer than expected.
        now: () => 0,
      },
    );
    expect(stops).toEqual(['child', 'grandchild', 'parent-2']);
    expect(result.visitedDescendantSessionIds).toEqual(stops);
  });

  it('continues after a per-descendant stop rejects, counting it as zero', async () => {
    const stops: Array<{ sessionId: string; ok: boolean }> = [];
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1' },
      {
        loadUserSessions: () => [
          makeSession('parent'),
          makeSession('child-a', 'parent'),
          makeSession('child-b', 'parent'),
        ],
        stopForSession: async ({ sessionId }) => {
          if (sessionId === 'child-a') {
            stops.push({ sessionId, ok: false });
            throw new Error('child-a runtime offline');
          }
          stops.push({ sessionId, ok: true });
          return 2;
        },
      },
    );
    expect(stops.map((s) => s.sessionId)).toEqual(['child-a', 'child-b']);
    // child-a threw → counted as 0; child-b returned 2.
    expect(result.cancelledStreamCount).toBe(2);
    expect(result.timedOut).toBe(false);
  });

  it('honours the timeout budget across the cascade', async () => {
    let virtualNow = 0;
    const result = await cancelDescendantSessionStreams(
      {
        rootSessionId: 'parent',
        userId: 'u1',
        timeoutMs: 100,
      },
      {
        loadUserSessions: () => [
          makeSession('parent'),
          makeSession('child-a', 'parent'),
          makeSession('child-b', 'parent'),
          makeSession('child-c', 'parent'),
        ],
        // Each fake stop "consumes" 60ms of virtual time so two stops
        // exhaust the 100ms budget before the third even starts.
        stopForSession: async () => {
          virtualNow += 60;
          return 1;
        },
        now: () => virtualNow,
      },
    );
    // child-a (elapsed 0 < 100) → runs, virtualNow becomes 60
    // child-b (elapsed 60 < 100) → runs, virtualNow becomes 120
    // child-c (elapsed 120 ≥ 100) → skipped, timedOut flag flips on
    expect(result.visitedDescendantSessionIds).toEqual(['child-a', 'child-b', 'child-c']);
    expect(result.cancelledStreamCount).toBe(2);
    expect(result.timedOut).toBe(true);
  });

  it('flags timedOut when the per-child stop never resolves within the remaining budget', async () => {
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1', timeoutMs: 25 },
      {
        loadUserSessions: () => [makeSession('parent'), makeSession('child', 'parent')],
        // Never resolves within the budget — race against the timer.
        stopForSession: () => new Promise<number>(() => undefined),
      },
    );
    expect(result.timedOut).toBe(true);
    expect(result.cancelledStreamCount).toBe(0);
  });

  it('skips descendants whose metadata_json is malformed', async () => {
    const stops: string[] = [];
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1' },
      {
        loadUserSessions: () => [
          { id: 'parent', metadata_json: '' },
          { id: 'child', metadata_json: 'not-json{' },
          { id: 'orphan', metadata_json: JSON.stringify({ parentSessionId: 'unknown' }) },
        ],
        stopForSession: async ({ sessionId }) => {
          stops.push(sessionId);
          return 1;
        },
      },
    );
    expect(stops).toEqual([]);
    expect(result.visitedDescendantSessionIds).toEqual([]);
  });

  it('forwards the supplied reason tag in the result', async () => {
    const result = await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1', reason: 'ancestor_aborted' },
      {
        loadUserSessions: () => [makeSession('parent')],
      } satisfies CancelDescendantSessionStreamsDeps,
    );
    expect(result.reason).toBe('ancestor_aborted');
  });

  it('passes the reason tag through to each per-descendant stop call', async () => {
    // T-CANCEL-08 (workflow 260509): each descendant's `done.cancellation`
    // toast depends on the helper forwarding the cascade reason all
    // the way to `stopAllInFlightStreamRequestsForSession`. A regression
    // here would let descendant streams emit `user_aborted` even
    // though the root was the one that triggered the cascade.
    const observedReasons: Array<string | undefined> = [];
    await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1', reason: 'parent_aborted' },
      {
        loadUserSessions: () => [
          makeSession('parent'),
          makeSession('child', 'parent'),
          makeSession('grandchild', 'child'),
        ],
        stopForSession: async ({ reason }) => {
          observedReasons.push(reason);
          return 1;
        },
      } satisfies CancelDescendantSessionStreamsDeps,
    );
    expect(observedReasons).toEqual(['parent_aborted', 'parent_aborted']);
  });

  it('treats sessions with empty parentSessionId string as orphans', async () => {
    const stops: string[] = [];
    const sessions = [
      makeSession('parent'),
      // Empty string is invalid but should not be treated as "child of ''".
      { id: 'rogue', metadata_json: JSON.stringify({ parentSessionId: '' }) },
    ];
    await cancelDescendantSessionStreams(
      { rootSessionId: 'parent', userId: 'u1' },
      {
        loadUserSessions: () => sessions,
        stopForSession: async ({ sessionId }) => {
          stops.push(sessionId);
          return 1;
        },
      },
    );
    expect(stops).toEqual([]);
  });
});
