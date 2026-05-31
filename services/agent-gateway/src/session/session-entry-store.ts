/**
 * SessionEntry store — persists `SessionEvent`s to the `session_entry`
 * SQLite table and reconstructs `SessionEntry[]` aggregates for replay.
 *
 * The store is intentionally append-only: every `appendSessionEvent`
 * call adds a new row, ordered by an auto-incrementing `seq` per session.
 * Aggregation into `SessionEntry` happens at read time via
 * `aggregateSessionEntries()` (see ./session-entry.ts).
 */

import type { RunEvent, StreamChunk } from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import {
  type SessionEvent,
  type SessionEventID,
  type SessionEventType,
  isSessionEventType,
  makeSessionEventId,
} from './session-event.js';
import { aggregateSessionEntries, type SessionEntry } from './session-entry.js';

interface SessionEntryRow {
  id: string;
  session_id: string;
  user_id: string;
  client_request_id: string | null;
  seq: number;
  type: string;
  timestamp: number;
  data: string;
}

interface MaxSeqRow {
  max_seq: number | null;
}

interface SessionOwnerRow {
  user_id: string;
}

// ─── Internal helpers ───

function getSessionOwnerUserId(sessionId: string): string | null {
  return (
    sqliteGet<SessionOwnerRow>('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [sessionId])
      ?.user_id ?? null
  );
}

function nextSeq(sessionId: string): number {
  const row = sqliteGet<MaxSeqRow>(
    'SELECT MAX(seq) AS max_seq FROM session_entry WHERE session_id = ?',
    [sessionId],
  );
  return (row?.max_seq ?? 0) + 1;
}

// ─── Retention ───
//
// `session_entry` is written one row per stream-time delta
// (`text.delta` / `reasoning.delta` / `tool.input.delta` via
// `persistStreamChunkAsSessionEvents`) plus post-stream tool/compaction
// events — the same per-token volume as `session_run_events`, and unlike
// that table it is NOT cleared on failed runs. Cascade-delete only fires
// when the parent session is deleted, so a long-lived user who never
// deletes sessions grows this table without bound. We bound it the same
// way as §0.54: keep the most recent N request scopes per session and
// drop older completed scopes wholesale.
//
// Safety: rows are grouped by `(session_id, client_request_id)`. Replay
// (`replaySessionEntries`) aggregates a whole session, so dropping an
// older scope's rows entirely removes that turn's fine-grained event
// trail but never corrupts a partially-kept scope. Keeping the highest
// `MAX(seq)` scopes preserves the most recent / in-flight runs. NULL
// (legacy / unscoped) rows are never pruned.
const DEFAULT_SESSION_ENTRY_MAX_SCOPES_PER_SESSION = 50;
export const SESSION_ENTRY_PRUNE_CHECK_INTERVAL = 200;

let sessionEntryRetentionOverride: number | null = null;
let sessionEntryPruneCheckInterval = SESSION_ENTRY_PRUNE_CHECK_INTERVAL;
let sessionEntryInsertsSincePrune = 0;
let sessionEntryStoreDisabled = false;

function resolveSessionEntryRetention(): number {
  if (sessionEntryRetentionOverride !== null) {
    return sessionEntryRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_SESSION_ENTRY_MAX_SCOPES_PER_SESSION'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_SESSION_ENTRY_MAX_SCOPES_PER_SESSION;
  }
  const parsed = Number(raw);
  // Non-positive / NaN means "retention disabled", matching the env
  // dead-switch semantics of the sibling retention stores.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneSessionEntryScopes(sessionId: string, maxScopes: number): void {
  // Keep the `maxScopes` scopes whose latest seq is highest (most recently
  // active, which includes any in-flight run); delete every older scope's
  // rows wholesale. Scope = distinct non-null client_request_id.
  sqliteRun(
    `DELETE FROM session_entry
      WHERE session_id = ?
        AND client_request_id IS NOT NULL
        AND client_request_id NOT IN (
          SELECT client_request_id FROM (
            SELECT client_request_id, MAX(seq) AS last_seq
              FROM session_entry
             WHERE session_id = ? AND client_request_id IS NOT NULL
             GROUP BY client_request_id
             ORDER BY last_seq DESC
             LIMIT ?
          )
        )`,
    [sessionId, sessionId, maxScopes],
  );
}

function maybePruneSessionEntries(sessionId: string): void {
  if (sessionEntryStoreDisabled) {
    return;
  }
  const limit = resolveSessionEntryRetention();
  if (limit <= 0) {
    // Retention disabled: reset the counter so re-enabling later doesn't
    // trigger one giant catch-up prune.
    sessionEntryInsertsSincePrune = 0;
    return;
  }
  sessionEntryInsertsSincePrune += 1;
  if (sessionEntryInsertsSincePrune < sessionEntryPruneCheckInterval) {
    return;
  }
  sessionEntryInsertsSincePrune = 0;
  try {
    pruneSessionEntryScopes(sessionId, limit);
  } catch (error) {
    // A prune failure must never break event persistence or the live
    // stream. On DB corruption disable the prune path entirely, consistent
    // with the sibling retention stores.
    if (isSqliteMalformedError(error)) {
      sessionEntryStoreDisabled = true;
      return;
    }
    console.warn(
      `[session-entry] retention prune failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Test-only: override the per-session scope cap (null clears the override). */
export function __setSessionEntryRetentionForTesting(
  limit: number | null,
  checkInterval?: number,
): void {
  sessionEntryRetentionOverride = limit;
  sessionEntryPruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : SESSION_ENTRY_PRUNE_CHECK_INTERVAL;
  sessionEntryInsertsSincePrune = 0;
  sessionEntryStoreDisabled = false;
}

/**
 * Encode a SessionEvent into the `(type, timestamp, data)` triple stored in
 * the table. We omit `id`/`type`/`timestamp` from the JSON blob since they
 * are first-class columns; everything else (variant-specific fields) goes
 * into `data` verbatim.
 */
function encodeEventData(event: SessionEvent): string {
  const {
    id: _id,
    type: _type,
    timestamp: _ts,
    ...rest
  } = event as {
    id: SessionEventID;
    type: SessionEventType;
    timestamp: number;
    [key: string]: unknown;
  };
  return JSON.stringify(rest);
}

function decodeRow(row: SessionEntryRow): SessionEvent | null {
  if (!isSessionEventType(row.type)) return null;
  let extra: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.data) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      extra = parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return {
    ...extra,
    id: row.id as SessionEventID,
    type: row.type,
    timestamp: row.timestamp,
  } as SessionEvent;
}

// ─── Public API ───

export interface AppendSessionEventInput {
  sessionId: string;
  /** Override the session owner user id; falls back to `sessions.user_id`. */
  userId?: string;
  /** Bind the event to a request scope so replays can be filtered. */
  clientRequestId?: string | null;
  event: SessionEvent;
}

/**
 * Persist a single SessionEvent. Returns the stored event with the
 * (possibly auto-assigned) id and timestamp.
 */
export function appendSessionEvent(input: AppendSessionEventInput): SessionEvent | null {
  const userId = input.userId ?? getSessionOwnerUserId(input.sessionId);
  if (!userId) return null;

  const event: SessionEvent = {
    ...input.event,
    id: input.event.id ?? makeSessionEventId(input.event.timestamp),
    timestamp: input.event.timestamp ?? Date.now(),
  } as SessionEvent;

  const seq = nextSeq(input.sessionId);

  try {
    sqliteRun(
      `INSERT INTO session_entry
         (id, session_id, user_id, client_request_id, seq, type, timestamp, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        event.id,
        input.sessionId,
        userId,
        input.clientRequestId ?? null,
        seq,
        event.type,
        event.timestamp,
        encodeEventData(event),
      ],
    );
  } catch (err) {
    if (isForeignKeyError(err)) {
      // Late event for a deleted session — drop silently like the message
      // projector does, no replay value once the parent row is gone.
      return null;
    }
    throw err;
  }

  maybePruneSessionEntries(input.sessionId);

  return event;
}

function isForeignKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY')
    return true;
  if ('message' in err && typeof (err as { message: string }).message === 'string') {
    return (err as { message: string }).message.includes('FOREIGN KEY constraint failed');
  }
  return false;
}

export interface ListSessionEventsInput {
  sessionId: string;
  clientRequestId?: string;
  /** Inclusive lower bound on `seq`. */
  afterSeq?: number;
}

export function listSessionEvents(input: ListSessionEventsInput): SessionEvent[] {
  const conditions = ['session_id = ?'];
  const params: (string | number)[] = [input.sessionId];
  if (input.clientRequestId !== undefined) {
    conditions.push('client_request_id = ?');
    params.push(input.clientRequestId);
  }
  if (typeof input.afterSeq === 'number') {
    conditions.push('seq > ?');
    params.push(input.afterSeq);
  }

  const rows = sqliteAll<SessionEntryRow>(
    `SELECT id, session_id, user_id, client_request_id, seq, type, timestamp, data
     FROM session_entry
     WHERE ${conditions.join(' AND ')}
     ORDER BY seq ASC, timestamp ASC`,
    params,
  );

  const events: SessionEvent[] = [];
  for (const row of rows) {
    const event = decodeRow(row);
    if (event) events.push(event);
  }
  return events;
}

/**
 * Convenience wrapper: read all SessionEvents for a session, then collapse
 * them into the high-level SessionEntry[] aggregate (User / Synthetic /
 * Assistant / Compaction). Mirrors opencode's `SessionEntry.fromSession`.
 */
export function replaySessionEntries(sessionId: string): SessionEntry[] {
  return aggregateSessionEntries(listSessionEvents({ sessionId }));
}

// ─── RunEvent → SessionEvent translator ───

/**
 * Translate one of OpenAWork's high-level `RunEvent`s into a `SessionEvent`.
 *
 * `publishSessionRunEvent` carries the post-stream events (tool results,
 * compaction markers, task updates, permission requests, ...). The mappings
 * below cover the ones that have a direct opencode counterpart:
 *   tool_result (success)   → tool.success
 *   tool_result (error)     → tool.error
 *   compaction (completed)  → compacted
 *
 * Stream-time events (`text_delta`, `tool_call_delta`, `thinking_*`) flow
 * through `writeChunk` rather than `publishSessionRunEvent`, so they are
 * persisted by a separate hook in the stream pipeline (see Phase 2.2 follow-up
 * in stream-model-round.ts). Returning `null` here lets callers skip
 * persistence without branching.
 */
export function translateRunEventToSessionEvent(input: {
  event: RunEvent;
  /** Owning eventId (from the RunEvent meta) — reused as the SessionEvent id when present. */
  fallbackEventId?: string | null;
  /** Owning timestamp — defaults to event.occurredAt or now. */
  fallbackTimestamp?: number;
}): SessionEvent | null {
  const event = input.event;
  const timestamp = input.fallbackTimestamp ?? event.occurredAt ?? Date.now();
  const id = (event.eventId ??
    input.fallbackEventId ??
    makeSessionEventId(timestamp)) as SessionEventID;

  switch (event.type) {
    case 'tool_result': {
      if (event.isError) {
        return {
          id,
          type: 'tool.error',
          timestamp,
          callID: event.toolCallId,
          error:
            typeof event.output === 'string'
              ? event.output
              : safeStringify(event.output ?? event.reason ?? 'tool failed'),
          provider: { executed: true },
        };
      }
      return {
        id,
        type: 'tool.success',
        timestamp,
        callID: event.toolCallId,
        title: event.toolName,
        output: typeof event.output === 'string' ? event.output : safeStringify(event.output ?? ''),
        provider: { executed: true },
      };
    }
    case 'compaction': {
      if (event.phase && event.phase !== 'completed') return null;
      return {
        id,
        type: 'compacted',
        timestamp,
        auto: event.trigger === 'automatic',
        ...(event.cause === 'usage_overflow' || event.cause === 'provider_overflow'
          ? { overflow: true }
          : {}),
      };
    }
    default:
      return null;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Stream-time chunk → SessionEvent persistence ───

/**
 * Per-round state tracker for stream chunk → SessionEvent translation.
 *
 * `text.delta` and `reasoning.delta` need a corresponding `started` event
 * so the aggregator can open a fresh content slot. `tool.input.delta`
 * needs a `tool.input.started` once per callID. We track which boundary
 * events have already been emitted so the persistence layer can stay
 * idempotent within the lifetime of a single round.
 */
export interface StreamSessionEventState {
  textStarted: boolean;
  reasoningStarted: boolean;
  toolInputStarted: Set<string>;
}

export function createStreamSessionEventState(): StreamSessionEventState {
  return {
    textStarted: false,
    reasoningStarted: false,
    toolInputStarted: new Set<string>(),
  };
}

/**
 * Translate a single `StreamChunk` into zero or more `SessionEvent`s.
 *
 * The translator is intentionally state-aware (via `StreamSessionEventState`)
 * so it can synthesise the missing opencode boundary events
 * (`text.started`, `reasoning.started`, `tool.input.started`) that
 * OpenAWork's StreamChunk model does not emit explicitly.
 *
 * The function is pure with respect to side effects — callers receive an
 * array of events and decide how to persist them.
 */
export function translateStreamChunkToSessionEvents(
  chunk: StreamChunk,
  state: StreamSessionEventState,
  fallbackTimestamp?: number,
): SessionEvent[] {
  const timestamp = fallbackTimestamp ?? chunk.occurredAt ?? Date.now();
  const events: SessionEvent[] = [];

  switch (chunk.type) {
    case 'text_delta': {
      if (!state.textStarted) {
        events.push({
          id: makeSessionEventId(timestamp),
          type: 'text.started',
          timestamp,
        });
        state.textStarted = true;
      }
      events.push({
        id: makeSessionEventId(timestamp),
        type: 'text.delta',
        timestamp,
        delta: chunk.delta,
      });
      break;
    }
    case 'thinking_start': {
      if (!state.reasoningStarted) {
        events.push({
          id: makeSessionEventId(timestamp),
          type: 'reasoning.started',
          timestamp,
        });
        state.reasoningStarted = true;
      }
      break;
    }
    case 'thinking_delta': {
      if (!state.reasoningStarted) {
        events.push({
          id: makeSessionEventId(timestamp),
          type: 'reasoning.started',
          timestamp,
        });
        state.reasoningStarted = true;
      }
      events.push({
        id: makeSessionEventId(timestamp),
        type: 'reasoning.delta',
        timestamp,
        delta: chunk.delta,
      });
      break;
    }
    case 'thinking_end': {
      // Without a buffered text snapshot we cannot emit the canonical
      // `reasoning.ended.text`; opencode's aggregator will use the
      // accumulated deltas if no `ended.text` arrives, so emitting an
      // explicit ended event with empty text would just clobber the
      // aggregated reasoning. Skip.
      state.reasoningStarted = false;
      break;
    }
    case 'tool_call_delta': {
      if (!state.toolInputStarted.has(chunk.toolCallId)) {
        events.push({
          id: makeSessionEventId(timestamp),
          type: 'tool.input.started',
          timestamp,
          callID: chunk.toolCallId,
          name: chunk.toolName,
        });
        state.toolInputStarted.add(chunk.toolCallId);
      }
      events.push({
        id: makeSessionEventId(timestamp),
        type: 'tool.input.delta',
        timestamp,
        callID: chunk.toolCallId,
        delta: chunk.inputDelta,
      });
      break;
    }
    default:
      break;
  }

  return events;
}

/**
 * Convenience: translate + persist in one shot. Failures are swallowed so
 * stream-time persistence cannot disrupt the live SSE pipeline.
 */
export function persistStreamChunkAsSessionEvents(input: {
  sessionId: string;
  userId?: string | null;
  clientRequestId?: string | null;
  chunk: StreamChunk;
  state: StreamSessionEventState;
}): void {
  try {
    const events = translateStreamChunkToSessionEvents(input.chunk, input.state);
    for (const event of events) {
      appendSessionEvent({
        sessionId: input.sessionId,
        userId: input.userId ?? undefined,
        clientRequestId: input.clientRequestId ?? null,
        event,
      });
    }
  } catch {
    // Best-effort persistence; never fail the SSE pipeline because of it.
  }
}
