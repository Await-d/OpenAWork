/**
 * SyncEvent — lightweight event sourcing framework (inspired by opencode).
 *
 * Design:
 * - All state mutations emit SyncEvents
 * - Projectors transform events into DB writes (CQRS read model)
 * - Events are persisted for replay/audit
 * - Idempotent: duplicate event IDs are ignored
 */

import { sqliteGet, sqliteRun, sqliteTransaction, sqliteAll } from './db.js';
import { randomUUID } from 'node:crypto';

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

function getNextSeq(aggregateID: string): number {
  const row = sqliteGet<{ seq: number }>('SELECT seq FROM event_sequences WHERE aggregate_id = ?', [
    aggregateID,
  ]);
  return (row?.seq ?? 0) + 1;
}

function updateSeq(aggregateID: string, seq: number): void {
  sqliteRun(
    `INSERT INTO event_sequences (aggregate_id, seq) VALUES (?, ?)
     ON CONFLICT (aggregate_id) DO UPDATE SET seq = excluded.seq`,
    [aggregateID, seq],
  );
}

function isEventProcessed(eventId: string): boolean {
  const row = sqliteGet<{ id: string }>('SELECT id FROM event_log WHERE id = ?', [eventId]);
  return row !== undefined;
}

// ─── Emit Event ───

export function emitEvent<T>(input: {
  definition: SyncEventDefinition<T>;
  aggregateID: string;
  data: T;
  persist?: boolean;
}): SyncEventInstance<T> {
  const eventId = randomUUID();
  const seq = getNextSeq(input.aggregateID);

  const event: SyncEventInstance<T> = {
    id: eventId,
    seq,
    aggregateID: input.aggregateID,
    type: input.definition.type,
    version: input.definition.version,
    data: input.data,
    timestamp: Date.now(),
  };

  // Idempotency check
  if (isEventProcessed(eventId)) {
    return event;
  }

  const shouldPersist = input.persist !== false;
  const projector = projectorRegistry.get(input.definition.type);

  // Run projector + event persist in a single transaction (atomic)
  sqliteTransaction(() => {
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
      updateSeq(input.aggregateID, seq);
    }
  });

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
