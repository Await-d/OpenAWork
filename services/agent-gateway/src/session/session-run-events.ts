import type { RunEvent, ToolCallObservabilityAnnotation } from '@openAwork/shared';
import { buildAssistantEventMessageContent } from './assistant-event-message.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { buildNotificationFromRunEvent } from './notification-store.js';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import { appendSessionEvent, translateRunEventToSessionEvent } from './session-entry-store.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';

type RunEventHandler = (event: RunEvent, meta?: PublishRunEventMeta) => void;

const sessionHandlers = new Map<string, Set<RunEventHandler>>();

interface SessionOwnerRow {
  user_id: string;
}

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
  toolCallId?: string;
  observability?: ToolCallObservabilityAnnotation;
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

const PERSISTED_RUN_EVENT = Symbol('persistedRunEvent');

export function getRunEventRunId(event: RunEvent): string | null {
  const runId = Reflect.get(event as object, 'runId');
  return typeof runId === 'string' && runId.length > 0 ? runId : null;
}

function computeNextSeq(sessionId: string, clientRequestId: string): number {
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
): { seq: number | null } {
  const userId = getSessionOwnerUserId(sessionId);
  const occurredAt = event.occurredAt ?? Date.now();
  const runId = getRunEventRunId(event);
  const seq =
    meta?.seq ??
    (typeof meta?.clientRequestId === 'string' && meta.clientRequestId.length > 0
      ? computeNextSeq(sessionId, meta.clientRequestId)
      : null);
  sqliteRun(
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
  return { seq };
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

function getSessionOwnerUserId(sessionId: string): string | null {
  return (
    sqliteGet<SessionOwnerRow>('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [sessionId])
      ?.user_id ?? null
  );
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
): void {
  const persisted = persistRunEventRow(sessionId, event, meta);
  const handlers = sessionHandlers.get(sessionId);
  if (!handlers) return;
  // Forward the DB-assigned seq into the broadcast meta so subscribers
  // (notably the /stream/attach endpoint) can filter and order live events
  // even when the caller didn't provide a seq.
  const broadcastMeta: PublishRunEventMeta | undefined =
    meta?.seq !== undefined || persisted.seq === null
      ? meta
      : { ...(meta ?? {}), seq: persisted.seq };
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
): { seq: number | null } {
  return persistRunEventRow(sessionId, event, meta);
}

export function listSessionRunEvents(sessionId: string): RunEvent[] {
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

export function listSessionRunEventsByRequest(input: {
  sessionId: string;
  clientRequestId: string;
}): RunEvent[] {
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
  sqliteRun('DELETE FROM session_run_events WHERE session_id = ? AND client_request_id = ?', [
    input.sessionId,
    input.clientRequestId,
  ]);
}
