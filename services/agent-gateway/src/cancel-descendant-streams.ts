/**
 * cancel-descendant-streams — when a parent session's stream is aborted
 * (user clicks stop, EventSource disconnects, etc.) we must propagate
 * the abort to any in-flight child / grandchild session streams instead
 * of leaving them running. The children stream into their own session
 * IDs (delegate_task / look_at / call_omo_agent etc.) and would
 * otherwise keep consuming tokens, writing tool results, and blocking
 * `inFlightStreamRequests` slots.
 *
 * Mirrors opencode `75d141b574` (#25798): "task tool abort must await
 * child cleanup before returning". OpenAWork's analogue is DB-driven
 * (children are independent stream sessions linked by
 * `metadata_json.parentSessionId`) so the propagation runs at the
 * stream-runtime layer rather than inside an Effect ensuring block.
 *
 * The canonical entry point {@link cancelDescendantSessionStreams}:
 *
 *   1. Loads the user's sessions, builds the parent → children map
 *      from `metadata_json.parentSessionId`, and BFS-traverses the
 *      subtree rooted at `rootSessionId`.
 *   2. For each descendant calls
 *      `stopAllInFlightStreamRequestsForSession` which already
 *      `abort()`s the stream's `AbortController` and `await`s the
 *      execution promise — that guarantees the child fully drains
 *      (database writes, run-event emission) before we return.
 *   3. Caps the overall wait at `timeoutMs` (default 10s) so a stuck
 *      child cannot hang the parent's "stop" UX indefinitely; the
 *      remainder is left for `stopAnyInFlightStreamRequestForSession`
 *      to eventually finish on its own.
 *   4. Visited-set protects against accidental cycles in the lineage
 *      graph (the schema is a tree but defence in depth is cheap).
 *
 * The helper takes optional `deps` so tests can inject session rows
 * and a fake `stopForSession` without touching the global SQLite +
 * inFlightStreamRequests singletons.
 */

import { sqliteAll } from './db.js';
import { stopAllInFlightStreamRequestsForSession } from './routes/stream-cancellation.js';

export type CancelDescendantReason = 'parent_aborted' | 'ancestor_aborted' | 'user_aborted';

export interface CancelDescendantSessionStreamsResult {
  /** Total number of in-flight stream slots cancelled across descendants. */
  cancelledStreamCount: number;
  /** Descendant session ids visited (depth-first BFS order, root excluded). */
  visitedDescendantSessionIds: string[];
  /** True iff the overall budget was exhausted before all descendants ran. */
  timedOut: boolean;
  /** Wall clock time spent in the cascade, milliseconds. */
  durationMs: number;
  /** Diagnostic reason tag forwarded by the caller. */
  reason: CancelDescendantReason;
}

export interface CancelDescendantSessionStreamsDeps {
  loadUserSessions?: (userId: string) => Array<{ id: string; metadata_json: string }>;
  /**
   * `reason` is the per-call cancellation hint propagated down to the
   * stream-cancellation registry so each descendant's abort handler
   * can label its emitted `done.cancellation.reason` precisely
   * (T-CANCEL-08, workflow 260509). Existing callers that ignore it
   * remain compatible — the field is optional in the resolved signature.
   */
  stopForSession?: (input: {
    sessionId: string;
    userId: string;
    reason?: CancelDescendantReason;
  }) => Promise<number>;
  now?: () => number;
}

export interface CancelDescendantSessionStreamsInput {
  rootSessionId: string;
  userId: string;
  reason?: CancelDescendantReason;
  /**
   * Maximum total wall-clock time (ms) the cascade is allowed to spend.
   * Defaults to 10_000ms. Once the budget is exhausted the loop stops
   * and the result reports `timedOut: true`; remaining descendants are
   * left in their current state.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function cancelDescendantSessionStreams(
  input: CancelDescendantSessionStreamsInput,
  deps?: CancelDescendantSessionStreamsDeps,
): Promise<CancelDescendantSessionStreamsResult> {
  const now = deps?.now ?? Date.now;
  const start = now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const loadSessions = deps?.loadUserSessions ?? defaultLoadUserSessions;
  const stop = deps?.stopForSession ?? defaultStopForSession;
  const reason: CancelDescendantReason = input.reason ?? 'parent_aborted';

  const sessions = loadSessions(input.userId);
  const childrenByParent = buildChildrenIndex(sessions);
  const descendants = collectDescendants(input.rootSessionId, childrenByParent);

  let cancelledStreamCount = 0;
  let timedOut = false;

  for (const descendantId of descendants) {
    const elapsed = now() - start;
    if (elapsed >= timeoutMs) {
      timedOut = true;
      break;
    }
    const remaining = timeoutMs - elapsed;
    // Cascade descendants are by definition NOT user-aborted from
    // their own POV — the user pulled the plug on the root, the
    // child is collateral. Forward the helper's `reason` so each
    // child labels its `done.cancellation.reason` accordingly.
    // For the root's direct children that's `parent_aborted`; deeper
    // descendants get the same tag because OpenAWork has no
    // grandparent stop-API distinction (`ancestor_aborted` is
    // reserved for cross-tree cascades).
    const stopped = await runWithTimeout(
      stop({ sessionId: descendantId, userId: input.userId, reason }),
      remaining,
    );
    if (stopped === TIMEOUT_SENTINEL) {
      timedOut = true;
      break;
    }
    cancelledStreamCount += stopped;
  }

  return {
    cancelledStreamCount,
    visitedDescendantSessionIds: descendants,
    timedOut,
    durationMs: now() - start,
    reason,
  };
}

const TIMEOUT_SENTINEL = -1 as const;

async function runWithTimeout(promise: Promise<number>, budgetMs: number): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<number>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), budgetMs);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([
      promise.catch((err) => {
        // Per-descendant stop failures must not bubble up — log and
        // count as zero cancellations so the loop can continue.
        console.warn('[CANCEL_DESCENDANT_STREAMS] stopForSession threw', String(err));
        return 0;
      }),
      timeout,
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function defaultLoadUserSessions(userId: string): Array<{ id: string; metadata_json: string }> {
  return sqliteAll<{ id: string; metadata_json: string }>(
    'SELECT id, metadata_json FROM sessions WHERE user_id = ?',
    [userId],
  );
}

function defaultStopForSession(input: { sessionId: string; userId: string }): Promise<number> {
  return stopAllInFlightStreamRequestsForSession(input);
}

function buildChildrenIndex(
  sessions: ReadonlyArray<{ id: string; metadata_json: string }>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const map = new Map<string, string[]>();
  for (const session of sessions) {
    const parent = parseParentSessionId(session.metadata_json);
    if (!parent) continue;
    const existing = map.get(parent);
    if (existing) {
      existing.push(session.id);
    } else {
      map.set(parent, [session.id]);
    }
  }
  return map;
}

function collectDescendants(
  rootSessionId: string,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<string>>,
): string[] {
  const visited = new Set<string>([rootSessionId]);
  const order: string[] = [];
  const queue: string[] = [rootSessionId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const child of childrenByParent.get(current) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      order.push(child);
      queue.push(child);
    }
  }
  return order;
}

function parseParentSessionId(metadataJson: string): string | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as { parentSessionId?: unknown };
    return typeof parsed.parentSessionId === 'string' && parsed.parentSessionId.length > 0
      ? parsed.parentSessionId
      : null;
  } catch {
    return null;
  }
}
