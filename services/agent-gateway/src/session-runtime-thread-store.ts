import { sqliteGet, sqliteRun } from './db.js';

export const SESSION_RUNTIME_THREAD_HEARTBEAT_MS = 5_000;
export const SESSION_RUNTIME_THREAD_STALE_AFTER_MS = 20_000;

interface SessionRuntimeThreadRow {
  client_request_id: string;
  heartbeat_at_ms: number;
  session_id: string;
  started_at_ms: number;
  user_id: string;
}

export function upsertSessionRuntimeThread(input: {
  clientRequestId: string;
  heartbeatAtMs?: number;
  sessionId: string;
  startedAtMs?: number;
  userId: string;
}): void {
  const startedAtMs = input.startedAtMs ?? Date.now();
  const heartbeatAtMs = input.heartbeatAtMs ?? startedAtMs;
  sqliteRun(
    `INSERT INTO session_runtime_threads
      (session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(session_id) DO UPDATE SET
       user_id = excluded.user_id,
       client_request_id = excluded.client_request_id,
       started_at_ms = excluded.started_at_ms,
       heartbeat_at_ms = excluded.heartbeat_at_ms,
       updated_at = datetime('now')`,
    [input.sessionId, input.userId, input.clientRequestId, startedAtMs, heartbeatAtMs],
  );
}

export function touchSessionRuntimeThread(input: {
  clientRequestId: string;
  heartbeatAtMs?: number;
  sessionId: string;
  userId: string;
}): void {
  sqliteRun(
    `UPDATE session_runtime_threads
     SET heartbeat_at_ms = ?, updated_at = datetime('now')
     WHERE session_id = ? AND user_id = ? AND client_request_id = ?`,
    [input.heartbeatAtMs ?? Date.now(), input.sessionId, input.userId, input.clientRequestId],
  );
}

export function clearSessionRuntimeThread(input: {
  clientRequestId?: string;
  sessionId: string;
  userId: string;
}): void {
  if (input.clientRequestId) {
    sqliteRun(
      'DELETE FROM session_runtime_threads WHERE session_id = ? AND user_id = ? AND client_request_id = ?',
      [input.sessionId, input.userId, input.clientRequestId],
    );
    return;
  }

  sqliteRun('DELETE FROM session_runtime_threads WHERE session_id = ? AND user_id = ?', [
    input.sessionId,
    input.userId,
  ]);
}

function getSessionRuntimeThread(input: {
  sessionId: string;
  userId: string;
}): SessionRuntimeThreadRow | null {
  return (
    sqliteGet<SessionRuntimeThreadRow>(
      `SELECT session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms
       FROM session_runtime_threads
       WHERE session_id = ? AND user_id = ?
       LIMIT 1`,
      [input.sessionId, input.userId],
    ) ?? null
  );
}

export function hasFreshSessionRuntimeThread(input: {
  nowMs?: number;
  sessionId: string;
  userId: string;
}): boolean {
  const thread = getSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
  if (!thread) {
    return false;
  }

  return (
    thread.heartbeat_at_ms >= (input.nowMs ?? Date.now()) - SESSION_RUNTIME_THREAD_STALE_AFTER_MS
  );
}
