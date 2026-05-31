/**
 * SyncEvent — lightweight event sourcing framework (inspired by opencode).
 *
 * Design:
 * - All state mutations emit SyncEvents
 * - Projectors transform events into DB writes (CQRS read model)
 * - Events are persisted for replay/audit
 * - Idempotent: duplicate event IDs are ignored
 */

import { sqliteGet, sqliteRun, sqliteTransaction, sqliteAll } from '../infra/db.js';
import { randomUUID } from 'node:crypto';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';

// ─── BusEvent (Real-time Publish) ───
// Inspired by opencode's BusEvent: after SyncEvent is persisted,
// broadcast to in-process subscribers for real-time SSE push.

type BusEventHandler = (eventType: string, data: unknown) => void;

const busHandlers = new Set<BusEventHandler>();

export function subscribeBusEvents(handler: BusEventHandler): () => void {
  busHandlers.add(handler);
  return () => {
    busHandlers.delete(handler);
  };
}

export function publishBusEvent(eventType: string, data: unknown): void {
  for (const handler of busHandlers) {
    try {
      handler(eventType, data);
    } catch {
      // Swallow bus errors — they should not break the event pipeline
    }
  }
}

// ─── Event Definition ───

export interface SyncEventDefinition<_T = unknown> {
  type: string;
  version: number;
  aggregate: string; // e.g. 'sessionID'
}

export interface SyncEventInstance<T = unknown> {
  id: string;
  seq: number;
  aggregateID: string;
  type: string;
  version: number;
  data: T;
  timestamp: number;
}

// ─── Projector Registry ───

type ProjectorFunc = (event: SyncEventInstance) => void;

const projectorRegistry = new Map<string, ProjectorFunc>();

export function registerProjector(eventType: string, projector: ProjectorFunc): void {
  projectorRegistry.set(eventType, projector);
}

// ─── Sequence Tracking ───

function peekNextSeq(aggregateID: string): number {
  const row = sqliteGet<{ seq: number }>('SELECT seq FROM event_sequences WHERE aggregate_id = ?', [
    aggregateID,
  ]);
  return (row?.seq ?? 0) + 1;
}

function allocateNextSeq(aggregateID: string): number {
  const row = sqliteGet<{ seq: number }>(
    `INSERT INTO event_sequences (aggregate_id, seq)
       VALUES (?, 1)
       ON CONFLICT (aggregate_id) DO UPDATE SET seq = event_sequences.seq + 1
       RETURNING seq`,
    [aggregateID],
  );
  if (!row) {
    throw new Error(`Failed to allocate seq for aggregate ${aggregateID}`);
  }
  return row.seq;
}

function isEventProcessed(eventId: string): boolean {
  // bun:sqlite 在没有匹配行时返回 `null`，而 node:sqlite 返回 `undefined`。
  // 用 `!= null` 同时识别两种 runtime，避免桌面端打包后误判事件已处理、
  // 跳过 projector 写入导致 message_v2/event_log 永远是空。
  const row = sqliteGet<{ id: string }>('SELECT id FROM event_log WHERE id = ?', [eventId]);
  return row != null;
}

// ─── Retention ───

/**
 * Global row cap for the `event_log` table. Every persisted SyncEvent
 * (message/part create/update/delete, including per-delta updates) appends a
 * row, and the table is keyed by a generic `aggregate_id` with NO foreign key
 * to `sessions` — so unlike `session_entry`/`session_run_events` its rows are
 * NOT cascade-deleted when a session is removed; a deleted session orphans its
 * events forever. There is also no other cleanup, so on a long-lived install
 * the table grows without bound.
 *
 * A global keep-most-recent-N cap is safe here because:
 *   1. The live read source of truth is the `message_v2` / `part_v2` projector
 *      tables (written synchronously inside the same transaction); the only
 *      reader of `event_log` itself is `replayEventsForAggregate`, used by
 *      verification, never on a live request path.
 *   2. `seq` comes from the separate monotonic `event_sequences` counter, not
 *      from `MAX(event_log.seq)`, so pruning rows can never cause a
 *      `uq_event_log_aggregate_seq` collision on a later insert.
 *   3. `isEventProcessed` dedupes by random-UUID `id`; pruning old ids cannot
 *      cause a real collision (fresh UUID per emit).
 * Ordering is by the implicit `rowid` (monotonic insertion order, unique) since
 * the primary key is a text UUID rather than an autoincrement integer.
 * Mirrors the retention pattern of `request_workflow_logs` (§0.40) /
 * `audit_logs` (§0.56).
 */
const DEFAULT_EVENT_LOG_MAX_ROWS = 50_000;
export const EVENT_LOG_PRUNE_CHECK_INTERVAL = 500;

let eventLogRetentionOverride: number | null = null;
let eventLogPruneCheckInterval = EVENT_LOG_PRUNE_CHECK_INTERVAL;
let eventLogInsertsSincePrune = 0;
let eventLogStoreDisabled = false;

function resolveEventLogRetention(): number {
  if (eventLogRetentionOverride !== null) {
    return eventLogRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_EVENT_LOG_MAX_ROWS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_EVENT_LOG_MAX_ROWS;
  }
  const parsed = Number(raw);
  // Non-positive / NaN means "retention disabled", matching the env
  // dead-switch semantics of the sibling retention stores.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneEventLog(limit: number): void {
  // Order by the implicit rowid: it is monotonic with insertion order and
  // unique, so "most recent N" is unambiguous even though the PK is a UUID.
  sqliteRun(
    `DELETE FROM event_log
      WHERE rowid NOT IN (
        SELECT rowid FROM event_log
         ORDER BY rowid DESC
         LIMIT ?
      )`,
    [limit],
  );
}

function maybePruneEventLog(): void {
  if (eventLogStoreDisabled) {
    return;
  }
  const limit = resolveEventLogRetention();
  if (limit <= 0) {
    // Retention disabled: reset the counter so re-enabling later doesn't
    // trigger one giant catch-up prune.
    eventLogInsertsSincePrune = 0;
    return;
  }
  eventLogInsertsSincePrune += 1;
  if (eventLogInsertsSincePrune < eventLogPruneCheckInterval) {
    return;
  }
  eventLogInsertsSincePrune = 0;
  try {
    pruneEventLog(limit);
  } catch (error) {
    // A prune failure must never break event persistence or the live stream.
    // On DB corruption disable the prune path entirely, consistent with the
    // sibling retention stores.
    if (isSqliteMalformedError(error)) {
      eventLogStoreDisabled = true;
      return;
    }
    console.warn(
      `[sync-event] event_log retention prune failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Test-only: override the global row cap (null clears the override). */
export function __setEventLogRetentionForTesting(
  limit: number | null,
  checkInterval?: number,
): void {
  eventLogRetentionOverride = limit;
  eventLogPruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : EVENT_LOG_PRUNE_CHECK_INTERVAL;
  eventLogInsertsSincePrune = 0;
  eventLogStoreDisabled = false;
}

// ─── Emit Event ───

export function emitEvent<T>(input: {
  definition: SyncEventDefinition<T>;
  aggregateID: string;
  data: T;
  persist?: boolean;
}): SyncEventInstance<T> {
  const eventId = randomUUID();
  let seq = 0;
  const shouldPersist = input.persist !== false;
  const projector = projectorRegistry.get(input.definition.type);

  if (!shouldPersist) {
    seq = peekNextSeq(input.aggregateID);
  }

  const timestamp = Date.now();
  let event: SyncEventInstance<T> = {
    id: eventId,
    seq,
    aggregateID: input.aggregateID,
    type: input.definition.type,
    version: input.definition.version,
    data: input.data,
    timestamp,
  };

  // Run projector + event persist in a single transaction (atomic)
  sqliteTransaction(() => {
    if (shouldPersist) {
      if (isEventProcessed(eventId)) {
        return;
      }

      seq = allocateNextSeq(input.aggregateID);
      event = {
        ...event,
        seq,
      };
    }

    if (projector) {
      projector(event);
    }

    if (shouldPersist) {
      sqliteRun(
        `INSERT INTO event_log (id, aggregate_id, seq, type, version, data, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          input.aggregateID,
          seq,
          input.definition.type,
          input.definition.version,
          JSON.stringify(input.data),
          event.timestamp,
        ],
      );
    }
  });

  // Bound the append-only event_log after a successful persist. event_log
  // has no FK to sessions (generic aggregate_id) so it never cascade-deletes,
  // and PartDelta events stream in per-token, so without a cap a long-lived
  // install grows it without bound. Pruning is safe: the live read source of
  // truth is message_v2/part_v2 (projectors), replayEventsForAggregate is
  // verification-only, seq comes from the independent event_sequences counter
  // (so deleting rows can't collide the uq_event_log_aggregate_seq index), and
  // idempotency keys are random UUIDs (unaffected by pruning older rows).
  if (shouldPersist) {
    maybePruneEventLog();
  }

  // BusEvent: broadcast to in-process subscribers (outside transaction)
  // This enables real-time SSE push for PartDelta, PartUpdated, etc.
  publishBusEvent(input.definition.type, input.data);

  return event;
}

// ─── Replay Events ───

export interface EventLogRow {
  id: string;
  aggregate_id: string;
  seq: number;
  type: string;
  version: number;
  data: string;
  timestamp: number;
}

export function replayEventsForAggregate(aggregateID: string): EventLogRow[] {
  return sqliteAll<EventLogRow>('SELECT * FROM event_log WHERE aggregate_id = ? ORDER BY seq ASC', [
    aggregateID,
  ]);
}

// ─── Event Definitions ───

export const MessageEvents = {
  Created: {
    type: 'message.created',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; info: unknown }>,
  Updated: {
    type: 'message.updated',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; info: unknown }>,
  Removed: {
    type: 'message.removed',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; messageID: string }>,
  PartCreated: {
    type: 'message.part.created',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; part: unknown }>,
  PartUpdated: {
    type: 'message.part.updated',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; part: unknown; time: number }>,
  PartDelta: {
    type: 'message.part.delta',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  }>,
  PartRemoved: {
    type: 'message.part.removed',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; messageID: string; partID: string }>,
};

// ─── Session Event Definitions (opencode pattern) ───

export interface SessionInfo {
  id: string;
  userID: string;
  title?: string;
  parentID?: string;
  workspaceID?: string;
  time: { created: number; updated: number; compacting?: number; archived?: number };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
    diffs: Array<{ file: string; patch: string }>;
  };
  revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string };
  permission?: unknown;
}

export const SessionEvents = {
  Created: {
    type: 'session.created',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; info: SessionInfo }>,
  Updated: {
    type: 'session.updated',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; info: DeepPartial<SessionInfo> }>,
  Deleted: {
    type: 'session.deleted',
    version: 1,
    aggregate: 'sessionID',
  } as SyncEventDefinition<{ sessionID: string; info: SessionInfo }>,
};

// ─── Session BusEvent Definitions (opencode pattern) ───

export const SessionBusEvents = {
  Diff: { type: 'session.diff' } as const,
  Error: { type: 'session.error' } as const,
  Compacted: { type: 'session.compacted' } as const,
  Status: { type: 'session.status' } as const,
};

export const TodoBusEvents = {
  Updated: { type: 'todo.updated' } as const,
};

// ─── DeepPartial utility (opencode pattern) ───

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> | null } : T;
