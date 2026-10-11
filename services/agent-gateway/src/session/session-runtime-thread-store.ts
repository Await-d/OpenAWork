import { sqliteGet, sqliteRun } from '../infra/db.js';

export const SESSION_RUNTIME_THREAD_HEARTBEAT_MS = 5_000;
export const SESSION_RUNTIME_THREAD_STALE_AFTER_MS = 20_000;

interface SessionRuntimeThreadRow {
  client_request_id: string;
  heartbeat_at_ms: number;
  session_id: string;
  started_at_ms: number;
  user_id: string;
}

export interface FreshSessionRuntimeThreadInfo {
  clientRequestId: string;
  heartbeatAtMs: number;
  sessionId: string;
  startedAtMs: number;
  userId: string;
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

/**
 * 只在确有残留行时才 DELETE —— 供**高频读路径**（`reconcileSessionStateStatus`）使用。
 *
 * 为什么不能直接调 `clearSessionRuntimeThread`：reconcile 以 1–3s 的频率被
 * `/status`、`/recovery`、`/sessions` 触发，而它清理的前提恰恰是「该会话已无活跃信号」
 * ——也就是说这批 DELETE 绝大多数命中 0 行。SQLite 的 DELETE 即使影响 0 行也要开写
 * 事务抢 WAL 写锁，而网关是 bun 单进程 + 同步 `bun:sqlite`
 * （`PRAGMA busy_timeout=5000`，见 `infra/db.ts`）：撞锁期间是**同步自旋**，整个事件
 * 循环连同所有在途 HTTP 请求一起冻结，最长可达 5s。工具权限挂起时前端有 1s 与 3s
 * 两条轮询持续走这条路径，是 `/status` 偶发挂起数秒的直接来源。
 *
 * 代价与收益：`session_id` 是主键（见 `infra/db.ts` 建表语句），前置 SELECT 走主键
 * seek，与一次普通点查同级。对外语义完全不变 —— 无行时 DELETE 本就是 no-op，有行时
 * 仍执行原语句。
 *
 * `stream.ts` / `stream-runtime.ts` 的 `finally` 刻意**不**走这个变体：那里清理的是
 * 本次 run 刚写入的行，低频且确有存在。
 */
export function clearSessionRuntimeThreadIfPresent(input: {
  sessionId: string;
  userId: string;
}): void {
  const existing = sqliteGet<SessionRuntimeThreadRow>(
    `SELECT session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms
       FROM session_runtime_threads
       WHERE session_id = ? AND user_id = ?
       LIMIT 1`,
    [input.sessionId, input.userId],
  );
  if (existing === undefined) {
    return;
  }

  clearSessionRuntimeThread(input);
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

export function getFreshSessionRuntimeThread(input: {
  nowMs?: number;
  sessionId: string;
  userId: string;
}): FreshSessionRuntimeThreadInfo | null {
  const thread = getSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
  if (!thread) {
    return null;
  }

  if (
    thread.heartbeat_at_ms <
    (input.nowMs ?? Date.now()) - SESSION_RUNTIME_THREAD_STALE_AFTER_MS
  ) {
    return null;
  }

  return {
    clientRequestId: thread.client_request_id,
    heartbeatAtMs: thread.heartbeat_at_ms,
    sessionId: thread.session_id,
    startedAtMs: thread.started_at_ms,
    userId: thread.user_id,
  };
}

export function hasFreshSessionRuntimeThread(input: {
  nowMs?: number;
  sessionId: string;
  userId: string;
}): boolean {
  return getFreshSessionRuntimeThread(input) !== null;
}
