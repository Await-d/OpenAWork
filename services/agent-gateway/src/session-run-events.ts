import type { RunEvent, ToolCallObservabilityAnnotation } from '@openAwork/shared';
import { buildAssistantEventMessageContent } from './assistant-event-message.js';
import { sqliteAll, sqliteGet, sqliteRun } from './db.js';
import { buildNotificationFromRunEvent } from './notification-store.js';
import { appendSessionMessageV2 as appendSessionMessage } from './message-v2-adapter.js';

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
  const userId = getSessionOwnerUserId(sessionId);
  const occurredAt = event.occurredAt ?? Date.now();
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
      event.runId ?? null,
      occurredAt,
      JSON.stringify(event),
    ],
  );
  mirrorDisplayableRunEventAsMessage({ sessionId, userId, event, meta, occurredAt, seq });
  if (userId) {
    const notificationScope = meta?.clientRequestId ?? event.eventId ?? event.runId ?? event.type;
    buildNotificationFromRunEvent({
      event,
      id: `notification:${sessionId}:${event.type}:${notificationScope}:${seq ?? occurredAt}`,
      sessionId,
      userId,
    });
  }
  markPersisted(event);
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
  });
}

function buildMirroredAssistantEventClientRequestId(input: {
  event: RunEvent;
  meta?: PublishRunEventMeta;
  occurredAt: number;
  seq: number | null;
}): string {
  if (typeof input.event.eventId === 'string' && input.event.eventId.length > 0) {
    return `assistant_event:${input.event.eventId}`;
  }

  if (typeof input.meta?.clientRequestId === 'string' && input.meta.clientRequestId.length > 0) {
    const suffix =
      typeof input.seq === 'number'
        ? `seq:${input.seq}`
        : typeof input.event.runId === 'string' && input.event.runId.length > 0
          ? `run:${input.event.runId}`
          : `at:${input.occurredAt}`;
    return `assistant_event:${input.meta.clientRequestId}:${suffix}:${input.event.type}`;
  }

  if (typeof input.event.runId === 'string' && input.event.runId.length > 0) {
    return `assistant_event:${input.event.runId}:${input.event.type}:${input.occurredAt}`;
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
  persistRunEventRow(sessionId, event, meta);
  const handlers = sessionHandlers.get(sessionId);
  if (!handlers) return;
  handlers.forEach((handler) => {
    handler(event, meta);
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
