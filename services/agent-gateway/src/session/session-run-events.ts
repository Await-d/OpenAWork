import type { RunEvent, ToolCallObservabilityAnnotation } from '@openAwork/shared';
import { buildAssistantEventMessageContent } from './assistant-event-message.js';
import {
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqliteRunWithRowId,
  sqliteTransaction,
} from '../infra/db.js';
import { buildNotificationFromRunEvent } from './notification-store.js';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import { appendSessionEvent, translateRunEventToSessionEvent } from './session-entry-store.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import { getSessionOwnerUserId } from '../infra/session-owner-cache.js';

type RunEventHandler = (event: RunEvent, meta?: PublishRunEventMeta) => void;

const sessionHandlers = new Map<string, Set<RunEventHandler>>();

interface SessionRunEventRow {
  seq?: number | null;
  payload_json: string;
}

interface SessionRunEventSeqRow {
  max_seq: number | null;
}

export interface PublishRunEventMeta {
  clientRequestId?: string;
  seq?: number;
  rowId?: number;
  toolCallId?: string;
  observability?: ToolCallObservabilityAnnotation;
}

export interface PersistedRunEventMeta {
  seq: number | null;
  rowId: number | null;
}

/**
 * Per-session retention for the durable run-event replay log.
 *
 * `session_run_events` stores one row per emitted RunEvent — including every
 * `text_delta`, so a single streamed turn writes hundreds/thousands of rows.
 * Only *failed* runs clear their rows (clearRetryableFailedRequestArtifacts);
 * every successful run's deltas stay forever. Over a long-lived session that
 * is a monotonically growing, replay-critical table (the §0.36/§0.40/§0.42
 * retention family covers the other only-grows tables; this was the last one
 * on the hot streaming path without a bound).
 *
 * Rows are grouped into all-or-nothing replay scopes keyed by
 * `(session_id, client_request_id)`: the fast replay path
 * (replayPersistedAssistantResponse) reads an entire scope and replays it
 * verbatim, and when a scope is absent it transparently falls back to
 * reconstructing from `session_messages`. So pruning *whole older scopes*
 * only downgrades those turns from fast-replay to message-reconstruction —
 * no conversation data is lost — while truncating a scope's head would
 * corrupt replay. We therefore keep the N most-recently-active scopes per
 * session (ordered by each scope's max row id) and delete older complete
 * scopes wholesale. The in-flight run is always the newest scope, so it is
 * never touched as long as the cap is >= 1. NULL-`client_request_id` rows
 * (legacy / unscoped) are never pruned.
 */
const DEFAULT_SESSION_RUN_EVENT_MAX_SCOPES_PER_SESSION = 50;
export const SESSION_RUN_EVENT_PRUNE_CHECK_INTERVAL = 200;
let sessionRunEventPruneCheckInterval = SESSION_RUN_EVENT_PRUNE_CHECK_INTERVAL;

let sessionRunEventRetentionOverride: number | null = null;
let sessionRunEventInsertsSincePrune = 0;
let sessionRunEventStoreDisabled = false;

function resolveSessionRunEventRetention(): number {
  if (sessionRunEventRetentionOverride !== null) {
    return sessionRunEventRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_SESSION_RUN_EVENT_MAX_SCOPES_PER_SESSION'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_SESSION_RUN_EVENT_MAX_SCOPES_PER_SESSION;
  }
  const parsed = Number(raw);
  // Non-positive / NaN means "retention disabled", matching the env
  // dead-switch semantics of the sibling retention stores.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneSessionRunEventScopes(sessionId: string, maxScopes: number): void {
  // Keep the `maxScopes` scopes whose latest row id is highest (most recently
  // active, which includes any in-flight run), delete every older scope's
  // rows wholesale. Scope = distinct non-null client_request_id.
  sqliteRun(
    `DELETE FROM session_run_events
      WHERE session_id = ?
        AND client_request_id IS NOT NULL
        AND client_request_id NOT IN (
          SELECT client_request_id FROM (
            SELECT client_request_id, MAX(id) AS last_id
              FROM session_run_events
             WHERE session_id = ? AND client_request_id IS NOT NULL
             GROUP BY client_request_id
             ORDER BY last_id DESC
             LIMIT ?
          )
        )`,
    [sessionId, sessionId, maxScopes],
  );
}

function maybePruneSessionRunEvents(sessionId: string): void {
  if (sessionRunEventStoreDisabled) {
    return;
  }
  const limit = resolveSessionRunEventRetention();
  if (limit <= 0) {
    // Retention disabled: reset the counter so re-enabling later doesn't
    // trigger one giant catch-up prune.
    sessionRunEventInsertsSincePrune = 0;
    return;
  }
  sessionRunEventInsertsSincePrune += 1;
  if (sessionRunEventInsertsSincePrune < sessionRunEventPruneCheckInterval) {
    return;
  }
  sessionRunEventInsertsSincePrune = 0;
  try {
    pruneSessionRunEventScopes(sessionId, limit);
  } catch (error) {
    // A prune failure must never break run-event persistence or the live
    // stream. On DB corruption disable the prune path entirely, consistent
    // with the sibling retention stores.
    if (isSqliteMalformedError(error)) {
      sessionRunEventStoreDisabled = true;
      return;
    }
    console.warn(
      `[session-run-events] retention prune failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Test-only: override the per-session scope cap (null clears the override). */
export function __setSessionRunEventRetentionForTesting(
  limit: number | null,
  checkInterval?: number,
): void {
  sessionRunEventRetentionOverride = limit;
  sessionRunEventPruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : SESSION_RUN_EVENT_PRUNE_CHECK_INTERVAL;
  sessionRunEventInsertsSincePrune = 0;
  sessionRunEventStoreDisabled = false;
}

// ─── Streaming write batching ───
//
// The hot path emits one RunEvent per upstream chunk (≈ per token). Giving
// every chunk its own implicit transaction makes SQLite the throughput
// limiter of the whole stream, so "delayable" delta chunks are buffered and
// flushed as one transaction (plus one broadcast pass) every
// `RUN_EVENT_FLUSH_INTERVAL_MS` or once `RUN_EVENT_FLUSH_BATCH_SIZE` chunks
// accumulate — whichever comes first.
//
// Ordering contract:
//   - Every synchronous write entry point (`publishSessionRunEvent`,
//     `persistSessionRunEventForRequest`) flushes the session's pending deltas
//     first, so a queued delta always lands before an event that causally
//     follows it. `seq` therefore stays ordered by occurrence.
//   - `seq` is reserved from an in-memory cursor per (session, request) that is
//     initialised from the DB and advanced by *every* writer (batched or not),
//     so the cursor handed to the client at enqueue time matches the seq the
//     row later receives.
//
// Durability trade-off: a crash can drop at most the last flush window of
// delta chunks. Those rows are a replay accelerator, not conversation state —
// the transcript itself is persisted when the round completes — so a small
// best-effort window is acceptable, matching the session_entry mirror.

const DELAYABLE_RUN_EVENT_TYPES: ReadonlySet<RunEvent['type']> = new Set<RunEvent['type']>([
  'text_delta',
  'thinking_delta',
  'tool_call_delta',
  'tool_progress',
  'terminal_output',
]);

export const RUN_EVENT_FLUSH_INTERVAL_MS = 50;
export const RUN_EVENT_FLUSH_BATCH_SIZE = 200;
const RUN_EVENT_SEQ_CURSOR_TTL_MS = 10 * 60 * 1000;
const RUN_EVENT_SEQ_CURSOR_SWEEP_THRESHOLD = 64;

interface SequencedRunEvent {
  event: RunEvent;
  meta: PublishRunEventMeta;
  sessionId: string;
  seq: number;
}

interface PendingRunEventQueue {
  queue: SequencedRunEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

interface RunEventSeqCursor {
  lastSeq: number;
  touchedAt: number;
}

const pendingRunEventQueues = new Map<string, PendingRunEventQueue>();
const runEventSeqCursors = new Map<string, RunEventSeqCursor>();

function buildRunEventQueueKey(sessionId: string, clientRequestId: string): string {
  return `${sessionId}\u0000${clientRequestId}`;
}

function noteRunEventSeq(sessionId: string, clientRequestId: string, seq: number): void {
  const key = buildRunEventQueueKey(sessionId, clientRequestId);
  const existing = runEventSeqCursors.get(key);
  runEventSeqCursors.set(key, {
    // Math.max: out-of-order writers must never rewind the cursor, or the
    // next reservation would reuse a seq the client has already seen.
    lastSeq: Math.max(existing?.lastSeq ?? 0, seq),
    touchedAt: Date.now(),
  });
}

function resolveRunEventSeqCursor(sessionId: string, clientRequestId: string): number {
  const existing = runEventSeqCursors.get(buildRunEventQueueKey(sessionId, clientRequestId));
  if (existing) return existing.lastSeq;
  // Backed by `idx_session_run_events_request_seq` (infra/db.ts).
  const row = sqliteGet<SessionRunEventSeqRow>(
    `SELECT MAX(seq) AS max_seq FROM session_run_events WHERE session_id = ? AND client_request_id = ?`,
    [sessionId, clientRequestId],
  );
  return row?.max_seq ?? 0;
}

function sweepRunEventSeqCursors(now = Date.now()): void {
  if (runEventSeqCursors.size <= RUN_EVENT_SEQ_CURSOR_SWEEP_THRESHOLD) return;
  for (const [key, cursor] of runEventSeqCursors) {
    if (now - cursor.touchedAt > RUN_EVENT_SEQ_CURSOR_TTL_MS) {
      runEventSeqCursors.delete(key);
    }
  }
}

/** Test-only: drop all batching state (queues, timers, seq cursors). */
export function __resetSessionRunEventBatchingForTesting(): void {
  for (const entry of pendingRunEventQueues.values()) {
    if (entry.timer !== null) clearTimeout(entry.timer);
  }
  pendingRunEventQueues.clear();
  runEventSeqCursors.clear();
}

/**
 * Reserve `seq` for a streamed chunk and queue it for the next batched flush.
 * Delayable delta types are buffered; everything else (bookends, tool
 * results, permissions, ...) flushes the queue and persists synchronously.
 * Returns the seq the row will carry (null when the event is unscoped).
 */
export function queueSessionRunEvent(
  sessionId: string,
  event: RunEvent,
  meta?: PublishRunEventMeta,
): { seq: number | null } {
  const clientRequestId =
    typeof meta?.clientRequestId === 'string' && meta.clientRequestId.length > 0
      ? meta.clientRequestId
      : null;

  if (!clientRequestId || !DELAYABLE_RUN_EVENT_TYPES.has(event.type)) {
    const persisted = publishSessionRunEvent(sessionId, event, meta);
    return { seq: persisted.seq };
  }

  const seq = resolveRunEventSeqCursor(sessionId, clientRequestId) + 1;
  noteRunEventSeq(sessionId, clientRequestId, seq);

  const key = buildRunEventQueueKey(sessionId, clientRequestId);
  const entry = pendingRunEventQueues.get(key) ?? { queue: [], timer: null };
  entry.queue.push({ event, meta: { ...(meta ?? {}), clientRequestId }, sessionId, seq });
  pendingRunEventQueues.set(key, entry);

  if (entry.queue.length >= RUN_EVENT_FLUSH_BATCH_SIZE) {
    flushPendingRunEventQueue(key);
  } else if (entry.timer === null) {
    const timer = setTimeout(() => {
      const current = pendingRunEventQueues.get(key);
      if (current) current.timer = null;
      flushPendingRunEventQueue(key);
    }, RUN_EVENT_FLUSH_INTERVAL_MS);
    // A pending flush must never keep the process alive on its own.
    const timerHandle = timer as unknown as { unref?: () => void };
    timerHandle.unref?.();
    entry.timer = timer;
  }

  return { seq };
}

/**
 * Flush queued deltas (one session, or every session when omitted) as a
 * single transaction. Safe to call when nothing is queued.
 */
export function flushSessionRunEventQueue(sessionId?: string): void {
  if (pendingRunEventQueues.size === 0) return;
  if (sessionId === undefined) {
    for (const key of [...pendingRunEventQueues.keys()]) {
      flushPendingRunEventQueue(key);
    }
    return;
  }
  const prefix = `${sessionId}\u0000`;
  for (const key of [...pendingRunEventQueues.keys()]) {
    if (key.startsWith(prefix)) flushPendingRunEventQueue(key);
  }
}

function flushPendingRunEventQueue(key: string): void {
  const entry = pendingRunEventQueues.get(key);
  if (!entry) return;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  const queued = entry.queue.splice(0, entry.queue.length);
  pendingRunEventQueues.delete(key);
  sweepRunEventSeqCursors();
  if (queued.length === 0) return;

  const delivered: SequencedRunEvent[] = [];
  try {
    sqliteTransaction(() => {
      for (const item of queued) {
        // `seq` was reserved at enqueue time so the client cursor and the
        // persisted row agree; persistRunEventRow picks it up from meta.
        const persisted = persistRunEventRow(item.sessionId, item.event, {
          ...item.meta,
          seq: item.seq,
        });
        delivered.push({
          ...item,
          seq: persisted.seq ?? item.seq,
          meta: {
            ...item.meta,
            seq: persisted.seq ?? item.seq,
            ...(persisted.rowId !== null ? { rowId: persisted.rowId } : {}),
          },
        });
      }
    });
  } catch (error) {
    // A batched flush runs off the timer, so there is no caller to rethrow to:
    // log and drop this batch. The seq cursor is intentionally NOT rewound —
    // reusing a seq the client already saw would make its dedupe drop new
    // events — so a failed flush leaves a gap instead of a duplicate.
    console.error('[session-run-events] batched flush failed', {
      error: error instanceof Error ? error.message : String(error),
      key,
      queued: queued.length,
    });
    return;
  }

  // Broadcast after persistence, mirroring publishSessionRunEvent's contract.
  for (const item of delivered) {
    broadcastPersistedSessionRunEvent(item.sessionId, item.event, item.meta);
  }
}

const PERSISTED_RUN_EVENT = Symbol('persistedRunEvent');

export function getRunEventRunId(event: RunEvent): string | null {
  const runId = Reflect.get(event, 'runId');
  return typeof runId === 'string' && runId.length > 0 ? runId : null;
}

function computeNextSeq(sessionId: string, clientRequestId: string): number {
  // Runs once per streamed chunk on the hot path — the MIN/MAX index
  // optimisation is what keeps it an index seek rather than a full scan.
  // Depends on `idx_session_run_events_request_seq` (infra/db.ts); do not
  // drop that index without replacing this query.
  const row = sqliteGet<SessionRunEventSeqRow>(
    `SELECT MAX(seq) AS max_seq FROM session_run_events WHERE session_id = ? AND client_request_id = ?`,
    [sessionId, clientRequestId],
  );
  return (row?.max_seq ?? 0) + 1;
}

function markPersisted(event: RunEvent): void {
  Object.defineProperty(event, PERSISTED_RUN_EVENT, {
    value: true,
    enumerable: false,
    configurable: true,
  });
}

export function hasPersistedRunEvent(event: RunEvent): boolean {
  return Boolean((event as unknown as Record<PropertyKey, unknown>)[PERSISTED_RUN_EVENT]);
}

function persistRunEventRow(
  sessionId: string,
  event: RunEvent,
  meta?: PublishRunEventMeta,
): { seq: number | null; rowId: number | null } {
  const userId = getSessionOwnerUserId(sessionId);
  const occurredAt = event.occurredAt ?? Date.now();
  const runId = getRunEventRunId(event);
  const seq =
    meta?.seq ??
    (typeof meta?.clientRequestId === 'string' && meta.clientRequestId.length > 0
      ? computeNextSeq(sessionId, meta.clientRequestId)
      : null);
  if (
    seq !== null &&
    typeof meta?.clientRequestId === 'string' &&
    meta.clientRequestId.length > 0
  ) {
    // Keep the reservation cursor in lock-step with sync writers so queued
    // chunks never reserve a seq that a synchronous write already used.
    noteRunEventSeq(sessionId, meta.clientRequestId, seq);
  }
  const rowId = sqliteRunWithRowId(
    `INSERT INTO session_run_events
     (session_id, user_id, client_request_id, seq, event_type, event_id, run_id, occurred_at_ms, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      sessionId,
      userId,
      meta?.clientRequestId ?? null,
      seq,
      event.type,
      event.eventId ?? null,
      runId,
      occurredAt,
      JSON.stringify(event),
    ],
  );
  mirrorDisplayableRunEventAsMessage({ sessionId, userId, event, meta, occurredAt, seq });
  if (userId) {
    const notificationScope = meta?.clientRequestId ?? event.eventId ?? runId ?? event.type;
    buildNotificationFromRunEvent({
      event,
      id: `notification:${sessionId}:${event.type}:${notificationScope}:${seq ?? occurredAt}`,
      sessionId,
      userId,
    });

    // Phase 2.2: dual-write into the session_entry typed event log so
    // replaySessionEntries can reconstruct the conversation in opencode's
    // SessionEntry shape. Translation is opt-in per RunEvent type and
    // never throws — failures are isolated to keep the legacy run-event
    // pipeline's invariants untouched.
    try {
      const sessionEvent = translateRunEventToSessionEvent({
        event,
        fallbackEventId: event.eventId ?? null,
        fallbackTimestamp: occurredAt,
      });
      if (sessionEvent) {
        appendSessionEvent({
          sessionId,
          userId,
          clientRequestId: meta?.clientRequestId ?? null,
          event: sessionEvent,
        });
      }
    } catch {
      // Swallow — SessionEvent persistence is a best-effort mirror.
    }
  }
  markPersisted(event);
  // Bound the per-session replay log so a long-lived session's successful
  // runs don't accumulate delta rows without limit (see retention block).
  maybePruneSessionRunEvents(sessionId);
  return { seq, rowId };
}

function mirrorDisplayableRunEventAsMessage(input: {
  sessionId: string;
  userId: string | null;
  event: RunEvent;
  meta?: PublishRunEventMeta;
  occurredAt: number;
  seq: number | null;
}): void {
  if (!input.userId) {
    return;
  }

  const content = buildAssistantEventMessageContent(input.event);
  if (!content) {
    return;
  }

  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    clientRequestId: buildMirroredAssistantEventClientRequestId(input),
    content,
    createdAt: input.occurredAt,
    replaceExisting: true,
  });
}

function buildMirroredAssistantEventClientRequestId(input: {
  event: RunEvent;
  meta?: PublishRunEventMeta;
  occurredAt: number;
  seq: number | null;
}): string {
  const runId = getRunEventRunId(input.event);
  // All phases of one compaction run (started/completed/failed) must replace
  // the same persisted assistant-event mirror. Event IDs are phase-specific,
  // so using them here creates duplicate transcript cards.
  if (input.event.type === 'compaction') {
    if (runId) {
      return `assistant_event:compaction:${runId}`;
    }
    if (typeof input.meta?.clientRequestId === 'string' && input.meta.clientRequestId.length > 0) {
      return `assistant_event:compaction:${input.meta.clientRequestId}`;
    }
  }

  if (typeof input.event.eventId === 'string' && input.event.eventId.length > 0) {
    return `assistant_event:${input.event.eventId}`;
  }

  if (typeof input.meta?.clientRequestId === 'string' && input.meta.clientRequestId.length > 0) {
    const suffix =
      typeof input.seq === 'number'
        ? `seq:${input.seq}`
        : runId
          ? `run:${runId}`
          : `at:${input.occurredAt}`;
    return `assistant_event:${input.meta.clientRequestId}:${suffix}:${input.event.type}`;
  }

  if (runId) {
    return `assistant_event:${runId}:${input.event.type}:${input.occurredAt}`;
  }

  return `assistant_event:${input.event.type}:${input.occurredAt}`;
}

export function subscribeSessionRunEvents(sessionId: string, handler: RunEventHandler): () => void {
  const handlers = sessionHandlers.get(sessionId) ?? new Set<RunEventHandler>();
  handlers.add(handler);
  sessionHandlers.set(sessionId, handlers);

  return () => {
    const current = sessionHandlers.get(sessionId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      sessionHandlers.delete(sessionId);
    }
  };
}

export function publishSessionRunEvent(
  sessionId: string,
  event: RunEvent,
  meta?: PublishRunEventMeta,
): PersistedRunEventMeta {
  // Queued stream deltas must land before the event that causally follows
  // them, so occurrence order and persisted (seq) order stay identical.
  flushSessionRunEventQueue(sessionId);
  const persisted = persistRunEventRow(sessionId, event, meta);
  const handlers = sessionHandlers.get(sessionId);
  if (!handlers) return persisted;
  // Forward the DB-assigned seq and rowId into the broadcast meta so subscribers
  // (notably the /stream/attach and /stream/multi-attach endpoints) can filter
  // and order live events even when the caller didn't provide a seq.
  const broadcastMeta: PublishRunEventMeta = {
    ...(meta ?? {}),
    ...(persisted.seq !== null && meta?.seq === undefined ? { seq: persisted.seq } : {}),
    ...(persisted.rowId !== null ? { rowId: persisted.rowId } : {}),
  };
  // Snapshot the subscriber set before dispatch. A handler may unsubscribe
  // itself (attach's terminal-event cleanup runs synchronously) or trigger a
  // new subscription mid-dispatch; iterating the live Set would otherwise
  // skip survivors or leak this event to a subscriber that joined this tick.
  for (const handler of [...handlers]) {
    notifyRunEventHandler({
      event,
      handler,
      meta: broadcastMeta,
      sessionId,
    });
  }
  return persisted;
}

export function broadcastPersistedSessionRunEvent(
  sessionId: string,
  event: RunEvent,
  meta?: PublishRunEventMeta,
): void {
  const handlers = sessionHandlers.get(sessionId);
  if (!handlers) return;
  // Snapshot before dispatch — see publishSessionRunEvent for rationale.
  for (const handler of [...handlers]) {
    notifyRunEventHandler({ event, handler, meta, sessionId });
  }
}

function notifyRunEventHandler(input: {
  event: RunEvent;
  handler: RunEventHandler;
  meta?: PublishRunEventMeta;
  sessionId: string;
}): void {
  try {
    input.handler(input.event, input.meta);
  } catch (error) {
    console.error('session run event handler failed', {
      error: error instanceof Error ? error.message : String(error),
      eventType: input.event.type,
      sessionId: input.sessionId,
    });
  }
}

export function persistSessionRunEventForRequest(
  sessionId: string,
  event: RunEvent,
  meta?: PublishRunEventMeta,
): { seq: number | null; rowId: number | null } {
  // Same ordering contract as publishSessionRunEvent: pending deltas first.
  flushSessionRunEventQueue(sessionId);
  return persistRunEventRow(sessionId, event, meta);
}

export function listSessionRunEvents(sessionId: string): RunEvent[] {
  // Read-your-writes: pending batched deltas must be visible to a replay that
  // runs before the next timer flush.
  flushSessionRunEventQueue(sessionId);
  return sqliteAll<SessionRunEventRow>(
    `SELECT payload_json FROM session_run_events WHERE session_id = ? ORDER BY COALESCE(seq, 2147483647) ASC, occurred_at_ms ASC, id ASC`,
    [sessionId],
  ).flatMap((row) => {
    try {
      return [JSON.parse(row.payload_json) as RunEvent];
    } catch {
      return [];
    }
  });
}

/**
 * List recent session run events WITH their row id (as seq) and client_request_id.
 * Used by the multi-attach endpoint to replay recent events before going live.
 * Unlike listSessionRunEventsByRequestAfterSeq, this spans ALL clientRequestIds
 * for the session, ordered by row id (which approximates chronological order).
 */
export function listRecentSessionRunEventsWithMeta(input: {
  sessionId: string;
  afterRowId: number;
  limit: number;
}): Array<{ event: RunEvent; seq: number; clientRequestId: string | null }> {
  // Read-your-writes: attach replay must include deltas still sitting in the
  // batch queue, otherwise the reconnect would silently skip them.
  flushSessionRunEventQueue(input.sessionId);
  return sqliteAll<SessionRunEventRow & { id: number; client_request_id: string | null }>(
    `SELECT payload_json, id, client_request_id
     FROM session_run_events
     WHERE session_id = ? AND id > ?
     ORDER BY id ASC
     LIMIT ?`,
    [input.sessionId, input.afterRowId, input.limit],
  ).flatMap((row) => {
    if (typeof row.id !== 'number') {
      return [];
    }
    try {
      return [
        {
          event: JSON.parse(row.payload_json) as RunEvent,
          seq: row.id,
          clientRequestId: row.client_request_id,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function listSessionRunEventsByRequest(input: {
  sessionId: string;
  clientRequestId: string;
}): RunEvent[] {
  flushSessionRunEventQueue(input.sessionId);
  return sqliteAll<SessionRunEventRow>(
    `SELECT payload_json
     FROM session_run_events
     WHERE session_id = ? AND client_request_id = ?
     ORDER BY COALESCE(seq, 2147483647) ASC, occurred_at_ms ASC, id ASC`,
    [input.sessionId, input.clientRequestId],
  ).flatMap((row) => {
    try {
      return [JSON.parse(row.payload_json) as RunEvent];
    } catch {
      return [];
    }
  });
}

export interface PersistedSessionRunEvent {
  event: RunEvent;
  seq: number;
}

export function listSessionRunEventsByRequestAfterSeq(input: {
  sessionId: string;
  clientRequestId: string;
  afterSeq: number;
}): PersistedSessionRunEvent[] {
  // Read-your-writes: a reconnecting client replays from its cursor, so the
  // in-flight batch must be flushed before the replay window is computed.
  flushSessionRunEventQueue(input.sessionId);
  return sqliteAll<SessionRunEventRow>(
    `SELECT payload_json, seq
     FROM session_run_events
     WHERE session_id = ? AND client_request_id = ? AND COALESCE(seq, 0) > ?
     ORDER BY COALESCE(seq, 2147483647) ASC, occurred_at_ms ASC, id ASC`,
    [input.sessionId, input.clientRequestId, input.afterSeq],
  ).flatMap((row) => {
    if (typeof row.seq !== 'number') {
      return [];
    }

    try {
      return [{ event: JSON.parse(row.payload_json) as RunEvent, seq: row.seq }];
    } catch {
      return [];
    }
  });
}

export function getLatestSessionRunEventSeqByRequest(input: {
  sessionId: string;
  clientRequestId: string;
}): number {
  // Read-your-writes: callers use this to sync a client cursor, so pending
  // deltas must be visible (and counted) before answering.
  flushSessionRunEventQueue(input.sessionId);
  const row = sqliteGet<SessionRunEventSeqRow>(
    `SELECT MAX(seq) AS max_seq
     FROM session_run_events
     WHERE session_id = ? AND client_request_id = ?`,
    [input.sessionId, input.clientRequestId],
  );
  return row?.max_seq ?? 0;
}

export function deleteSessionRunEventsByRequest(input: {
  sessionId: string;
  clientRequestId: string;
}): void {
  // Flush first: a later timer flush would otherwise resurrect rows this call
  // just deleted.
  flushSessionRunEventQueue(input.sessionId);
  sqliteRun('DELETE FROM session_run_events WHERE session_id = ? AND client_request_id = ?', [
    input.sessionId,
    input.clientRequestId,
  ]);
  // The cursor must re-derive from the (now truncated) table, not from a stale
  // in-memory high-water mark.
  runEventSeqCursors.delete(buildRunEventQueueKey(input.sessionId, input.clientRequestId));
}
