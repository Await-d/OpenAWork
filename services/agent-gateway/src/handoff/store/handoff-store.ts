/**
 * 260515-team-phase-b · T-03
 *
 * Handoff 数据访问层 + 状态机 CRUD。
 *
 * 状态机：
 *
 *   pending  ──claim──▶  claimed  ──start──▶  running  ──complete──▶  completed
 *      │                    │                    │                       △
 *      │                    │                    │                       │
 *      │                    │                    └──fail──▶ failed       │
 *      │                    │                                            │
 *      └────────cancel──────┴────────cancel─────▶ cancelled              │
 *                                                                        │
 *      pending ◀──reclaim（崩溃恢复，超过 heartbeat timeout）──── claimed/running
 *
 * 设计要点：
 *   1. createHandoff 只产生 pending 记录，不立即创建子 session（T-04 Watcher 才负责）
 *   2. claimHandoff 是抢占式的：使用 `WHERE state='pending'` 单步 UPDATE
 *      避免多 worker 重复 claim；返回 `null` 表示已被别人 claim
 *   3. completeHandoff / failHandoff 必须从 running 状态过渡（非法过渡返回 false）
 *   4. cancelHandoff 是最强力的，从任意非终止状态都可以 cancel
 *   5. reclaimAbandoned 用于崩溃恢复（T-06 才用，先放在 store 里）
 *
 * 与 session 关系：
 *   - from_session_id：发起 handoff 的会话（必须存在）
 *   - to_session_id：接收 handoff 的子会话（claim 后由 Watcher 创建并填充）
 *
 * 不做的事（Phase C）：
 *   - payload_json 的标准化结构（dispatch_package）—— 当前裸文本透传
 *   - architecture review check 点
 *   - workflow 模板驱动的多步 handoff
 */

import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from '../../infra/db.js';
import { assertCanHandoffTo } from '../capability/layer-capabilities.js';

export type HandoffState = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';

export type HandoffRoleLayer = 'user' | 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

interface HandoffRow {
  id: string;
  user_id: string;
  from_session_id: string;
  from_role_layer: string;
  to_role_layer: string;
  to_session_id: string | null;
  payload_json: string;
  state: string;
  claim_token: string | null;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  retry_count: number;
  idempotency_key: string | null;
  paused: number;
  paused_at: string | null;
  paused_by_user_id: string | null;
  pause_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface HandoffRecord {
  id: string;
  userId: string;
  fromSessionId: string;
  fromRoleLayer: HandoffRoleLayer;
  toRoleLayer: HandoffRoleLayer;
  toSessionId: string | null;
  payload: unknown;
  state: HandoffState;
  claimToken: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  idempotencyKey: string | null;
  paused: boolean;
  pausedAt: string | null;
  pausedByUserId: string | null;
  pauseReason: string | null;
  createdAt: string;
  updatedAt: string;
}

function parsePayload(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (_err) {
    void _err;
    return null;
  }
}

function mapRow(row: HandoffRow): HandoffRecord {
  return {
    id: row.id,
    userId: row.user_id,
    fromSessionId: row.from_session_id,
    fromRoleLayer: row.from_role_layer as HandoffRoleLayer,
    toRoleLayer: row.to_role_layer as HandoffRoleLayer,
    toSessionId: row.to_session_id,
    payload: parsePayload(row.payload_json),
    state: row.state as HandoffState,
    claimToken: row.claim_token,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failureReason: row.failure_reason,
    retryCount: row.retry_count,
    idempotencyKey: row.idempotency_key,
    paused: row.paused === 1,
    pausedAt: row.paused_at,
    pausedByUserId: row.paused_by_user_id,
    pauseReason: row.pause_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateHandoffInput {
  userId: string;
  fromSessionId: string;
  fromRoleLayer: HandoffRoleLayer;
  toRoleLayer: HandoffRoleLayer;
  payload?: unknown;
  idempotencyKey?: string | null;
}

export function createHandoff(input: CreateHandoffInput): HandoffRecord {
  // L1.4 Guard #1: 检查 fromRoleLayer → toRoleLayer 是否在 capability matrix 中
  // 违反 → 抛 LayerCapabilityViolationError（caller 自行处理）+ audit log
  assertCanHandoffTo({
    fromRoleLayer: input.fromRoleLayer,
    toRoleLayer: input.toRoleLayer,
    userId: input.userId,
    fromSessionId: input.fromSessionId,
  });

  if (input.idempotencyKey) {
    const existing = sqliteGet<HandoffRow>(
      `SELECT * FROM handoff_records
       WHERE user_id = ? AND idempotency_key = ?
       LIMIT 1`,
      [input.userId, input.idempotencyKey],
    );
    if (existing) {
      return mapRow(existing);
    }
  }

  const id = randomUUID();
  const payloadJson = JSON.stringify(input.payload ?? {});
  sqliteRun(
    `INSERT INTO handoff_records (
       id, user_id, from_session_id, from_role_layer, to_role_layer,
       payload_json, state, retry_count, idempotency_key
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [
      id,
      input.userId,
      input.fromSessionId,
      input.fromRoleLayer,
      input.toRoleLayer,
      payloadJson,
      input.idempotencyKey ?? null,
    ],
  );
  const row = sqliteGet<HandoffRow>(`SELECT * FROM handoff_records WHERE id = ? LIMIT 1`, [id]);
  if (!row) {
    throw new Error('Failed to read back handoff after insert');
  }
  return mapRow(row);
}

// ─── Read ───────────────────────────────────────────────────────────────────

export function getHandoff(input: {
  userId: string;
  handoffId: string;
}): HandoffRecord | undefined {
  const row = sqliteGet<HandoffRow>(
    `SELECT * FROM handoff_records WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.handoffId, input.userId],
  );
  return row ? mapRow(row) : undefined;
}

/**
 * 系统内部 (watcher / recovery) 用的按 id 查询。
 * 不做 userId 过滤——只在受信任的 server 内代码调用，**禁止**暴露给路由。
 */
export function getHandoffById(handoffId: string): HandoffRecord | undefined {
  const row = sqliteGet<HandoffRow>(`SELECT * FROM handoff_records WHERE id = ? LIMIT 1`, [
    handoffId,
  ]);
  return row ? mapRow(row) : undefined;
}

export function listPendingHandoffs(limit = 50): HandoffRecord[] {
  const rows = sqliteAll<HandoffRow>(
    `SELECT * FROM handoff_records
     WHERE state = 'pending' AND paused = 0
     ORDER BY created_at ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map(mapRow);
}

export function listHandoffsBySession(input: {
  userId: string;
  sessionId: string;
}): HandoffRecord[] {
  const rows = sqliteAll<HandoffRow>(
    `SELECT * FROM handoff_records
     WHERE user_id = ? AND (from_session_id = ? OR to_session_id = ?)
     ORDER BY created_at ASC`,
    [input.userId, input.sessionId, input.sessionId],
  );
  return rows.map(mapRow);
}

// ─── State transitions ──────────────────────────────────────────────────────

/**
 * 抢占式 claim：单步 UPDATE 把 pending 推到 claimed，并写入 claim_token。
 * 同一 handoff 多个 worker 竞争时，只有一个会拿到 token；其他返回 null。
 */
export function claimHandoff(input: {
  handoffId: string;
  claimToken: string;
}): HandoffRecord | null {
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'claimed',
           claim_token = ?,
           claimed_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND state = 'pending' AND paused = 0`,
    [input.claimToken, input.handoffId],
  );
  // SQLite 无返回行数；通过回读判断是否成功
  const row = sqliteGet<HandoffRow>(`SELECT * FROM handoff_records WHERE id = ? LIMIT 1`, [
    input.handoffId,
  ]);
  if (!row) return null;
  if (row.state !== 'claimed' || row.claim_token !== input.claimToken) {
    return null;
  }
  return mapRow(row);
}

/**
 * 标记 handoff 进入 running 状态，并把子会话 id 关联进来。
 * 必须从 claimed 过渡。
 */
export function startHandoff(input: {
  handoffId: string;
  claimToken: string;
  toSessionId: string;
}): boolean {
  const row = sqliteGet<HandoffRow>(
    `SELECT state, claim_token FROM handoff_records WHERE id = ? LIMIT 1`,
    [input.handoffId],
  );
  if (!row || row.state !== 'claimed' || row.claim_token !== input.claimToken) {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'running',
           to_session_id = ?,
           started_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND claim_token = ? AND state = 'claimed'`,
    [input.toSessionId, input.handoffId, input.claimToken],
  );
  return true;
}

export function completeHandoff(input: { handoffId: string; claimToken: string }): boolean {
  const row = sqliteGet<HandoffRow>(
    `SELECT state, claim_token FROM handoff_records WHERE id = ? LIMIT 1`,
    [input.handoffId],
  );
  if (!row || row.state !== 'running' || row.claim_token !== input.claimToken) {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'completed',
           completed_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND claim_token = ? AND state = 'running'`,
    [input.handoffId, input.claimToken],
  );
  return true;
}

export function failHandoff(input: {
  handoffId: string;
  claimToken: string;
  reason: string;
}): boolean {
  const row = sqliteGet<HandoffRow>(
    `SELECT state, claim_token FROM handoff_records WHERE id = ? LIMIT 1`,
    [input.handoffId],
  );
  if (!row || row.state !== 'running' || row.claim_token !== input.claimToken) {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'failed',
           failure_reason = ?,
           completed_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND claim_token = ? AND state = 'running'`,
    [input.reason, input.handoffId, input.claimToken],
  );
  return true;
}

/**
 * 用户主动 cancel：从任意非终止状态都允许过渡到 cancelled。
 */
export function cancelHandoff(input: { userId: string; handoffId: string }): boolean {
  const row = sqliteGet<HandoffRow>(
    `SELECT state FROM handoff_records WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.handoffId, input.userId],
  );
  if (!row) return false;
  if (row.state === 'completed' || row.state === 'failed' || row.state === 'cancelled') {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'cancelled',
           completed_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [input.handoffId, input.userId],
  );
  return true;
}

export function pauseHandoff(input: {
  userId: string;
  handoffId: string;
  reason?: string | null;
}): boolean {
  const row = sqliteGet<HandoffRow>(
    `SELECT state, paused FROM handoff_records WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.handoffId, input.userId],
  );
  if (!row) return false;
  if (row.state === 'completed' || row.state === 'failed' || row.state === 'cancelled') {
    return false;
  }
  if (row.paused === 1) {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
           SET paused = 1,
               paused_at = datetime('now'),
               paused_by_user_id = ?,
               pause_reason = ?,
               updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
    [input.userId, input.reason ?? null, input.handoffId, input.userId],
  );
  return true;
}

export function resumeHandoff(input: { userId: string; handoffId: string }): boolean {
  const row = sqliteGet<HandoffRow>(
    `SELECT state, paused FROM handoff_records WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.handoffId, input.userId],
  );
  if (!row) return false;
  if (row.state === 'completed' || row.state === 'failed' || row.state === 'cancelled') {
    return false;
  }
  if (row.paused !== 1) {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
           SET paused = 0,
               paused_at = NULL,
               paused_by_user_id = NULL,
               pause_reason = NULL,
               updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND paused = 1 AND state NOT IN ('completed', 'failed', 'cancelled')`,
    [input.handoffId, input.userId],
  );
  return true;
}

/**
 * 崩溃恢复：把"claimed/running 但 heartbeat 超时"的 handoff 退回 pending，
 * retry_count + 1。返回被恢复的记录数。
 *
 * 由 watcher / recovery 模块在 T-04/T-06 中调用，本模块只提供原子操作。
 */
/**
 * Reclaim 阶段产物：包含每条处理过的记录及其结果。
 * watcher 用 reclaimedIds 发 'handoff.reclaimed' 事件，failedIds 发 'handoff.failed'。
 */
export interface ReclaimResult {
  /** 被退回 pending 的 handoff id（retry_count+1） */
  reclaimedIds: string[];
  /** 因达到 maxRetry 被改 failed 的 handoff id */
  failedIds: string[];
}

export function reclaimAbandonedHandoffs(input: {
  staleHeartbeatBeforeIso: string;
  maxRetry: number;
}): ReclaimResult {
  // 通过 to_session_id JOIN sessions.last_heartbeat 判断是否过期。
  // 超过 maxRetry 的 handoff 直接 fail 而不是无限重试。
  const stale = sqliteAll<{ id: string; retry_count: number }>(
    `SELECT h.id, h.retry_count
     FROM handoff_records h
     LEFT JOIN sessions s ON s.id = h.to_session_id
     WHERE h.state IN ('claimed', 'running')
       AND (
         s.last_heartbeat IS NULL
         OR s.last_heartbeat < ?
       )`,
    [input.staleHeartbeatBeforeIso],
  );

  const reclaimedIds: string[] = [];
  const failedIds: string[] = [];
  for (const row of stale) {
    if (row.retry_count >= input.maxRetry) {
      sqliteRun(
        `UPDATE handoff_records
           SET state = 'failed',
               failure_reason = 'heartbeat-timeout-max-retry-exceeded',
               completed_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ? AND state IN ('claimed','running')`,
        [row.id],
      );
      failedIds.push(row.id);
    } else {
      sqliteRun(
        `UPDATE handoff_records
           SET state = 'pending',
               claim_token = NULL,
               claimed_at = NULL,
               started_at = NULL,
               retry_count = retry_count + 1,
               updated_at = datetime('now')
         WHERE id = ? AND state IN ('claimed','running')`,
        [row.id],
      );
      reclaimedIds.push(row.id);
    }
  }
  return { reclaimedIds, failedIds };
}
