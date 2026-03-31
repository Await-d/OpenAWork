import type { RunEvent } from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun } from './db.js';

type RunEventHandler = (event: RunEvent) => void;

const sessionHandlers = new Map<string, Set<RunEventHandler>>();

interface SessionOwnerRow {
  user_id: string;
}

interface SessionRunEventRow {
  payload_json: string;
}

interface SessionRunEventSeqRow {
  max_seq: number | null;
}

interface PublishRunEventMeta {
  clientRequestId?: string;
  seq?: number;
}

const PERSISTED_RUN_EVENT = Symbol('persistedRunEvent');

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

function persistRunEventRow(sessionId: string, event: RunEvent, meta?: PublishRunEventMeta): void {
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
      getSessionOwnerUserId(sessionId),
      meta?.clientRequestId ?? null,
      seq,
      event.type,
      event.eventId ?? null,
      event.runId ?? null,
      event.occurredAt ?? Date.now(),
      JSON.stringify(event),
    ],
  );
  markPersisted(event);
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
  persistRunEventRow(sessionId, event, meta);
  const handlers = sessionHandlers.get(sessionId);
  if (!handlers) return;
  handlers.forEach((handler) => {
    handler(event);
  });
}

export function persistSessionRunEventForRequest(
  sessionId: string,
  event: RunEvent,
  meta?: PublishRunEventMeta,
): void {
  persistRunEventRow(sessionId, event, meta);
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
