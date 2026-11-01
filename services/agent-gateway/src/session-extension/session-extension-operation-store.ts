/**
 * 会话扩展**操作**（安装提案）的状态机与持久化。
 *
 * 为什么需要它：渠道会话可能被同群的多个成员轮流发言，且审批发生在另一个端点
 * （Web 确认页）。把「谁请求的、批的是什么内容、批给谁执行」全部落库，才能做到：
 * - 审批不依赖聊天里的一句「同意」，也不依赖「最后发言者」的会话 metadata；
 * - 审批、写入、续跑是**三个阶段**，审批成功 ≠ 安装成功；
 * - 内容/revision 变化必须重新审批（审批 A 不能执行 B）；
 * - 并发审批、nonce 重放、过期、重启恢复都有单一真相源。
 */

import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun, sqliteRunWithChanges } from '../infra/db.js';
import {
  SESSION_EXTENSION_OPERATION_TTL_MS,
  isTerminalExtensionOperationStatus,
  type SessionExtensionKind,
  type SessionExtensionOperationAction,
  type SessionExtensionOperationStatus,
} from './session-extension-contract.js';

export interface SessionExtensionOperationRow {
  id: string;
  session_id: string;
  user_id: string;
  kind: string;
  action: string;
  resource_ref: string | null;
  payload_json: string;
  config_digest: string | null;
  expected_revision: number | null;
  channel_id: string | null;
  chat_id: string | null;
  requester_actor_id: string | null;
  nonce: string;
  idempotency_key: string | null;
  status: string;
  approver_user_id: string | null;
  decision_at: number | null;
  applied_at: number | null;
  expires_at: number;
  error_code: string | null;
  error_message: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionExtensionOperation {
  id: string;
  sessionId: string;
  ownerUserId: string;
  kind: SessionExtensionKind;
  action: SessionExtensionOperationAction;
  resourceRef: string | null;
  /** 已校验的提案载荷（不含明文凭据；密钥走 secretRef）。 */
  payload: unknown;
  configDigest: string | null;
  expectedRevision: number | null;
  channelId: string | null;
  chatId: string | null;
  requesterActorId: string | null;
  nonce: string;
  idempotencyKey: string | null;
  status: SessionExtensionOperationStatus;
  approverUserId: string | null;
  decisionAt: number | null;
  appliedAt: number | null;
  expiresAt: number;
  errorCode: string | null;
  errorMessage: string | null;
  result: unknown;
  createdAt: number;
  updatedAt: number;
}

function parseJsonOrNull(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function rowToOperation(row: SessionExtensionOperationRow): SessionExtensionOperation {
  return {
    id: row.id,
    sessionId: row.session_id,
    ownerUserId: row.user_id,
    kind: row.kind === 'mcp' ? 'mcp' : 'skill',
    action: row.action as SessionExtensionOperationAction,
    resourceRef: row.resource_ref,
    payload: parseJsonOrNull(row.payload_json),
    configDigest: row.config_digest,
    expectedRevision: row.expected_revision,
    channelId: row.channel_id,
    chatId: row.chat_id,
    requesterActorId: row.requester_actor_id,
    nonce: row.nonce,
    idempotencyKey: row.idempotency_key,
    status: row.status as SessionExtensionOperationStatus,
    approverUserId: row.approver_user_id,
    decisionAt: row.decision_at,
    appliedAt: row.applied_at,
    expiresAt: row.expires_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    result: parseJsonOrNull(row.result_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateSessionExtensionOperationInput {
  sessionId: string;
  ownerUserId: string;
  kind: SessionExtensionKind;
  action: SessionExtensionOperationAction;
  resourceRef: string | null;
  payload: unknown;
  configDigest: string | null;
  expectedRevision: number | null;
  channelId?: string | null;
  chatId?: string | null;
  requesterActorId?: string | null;
  idempotencyKey?: string | null;
  ttlMs?: number;
  now?: number;
}

/**
 * 创建一条待审批操作。
 *
 * 幂等：同一 `idempotencyKey` 在**未终结**状态下复用既有记录，避免渠道重发消息
 * （平台重试 / 用户重复点按）产生两条提案、批准一条、另一条永远挂着。
 */
export function createSessionExtensionOperation(
  input: CreateSessionExtensionOperationInput,
): SessionExtensionOperation {
  const now = input.now ?? Date.now();

  if (input.idempotencyKey) {
    const existing = findSessionExtensionOperationByIdempotencyKey(
      input.sessionId,
      input.idempotencyKey,
    );
    if (existing && !isTerminalExtensionOperationStatus(existing.status)) {
      return existing;
    }
  }

  const id = `opx_${randomUUID()}`;
  const ttl = input.ttlMs ?? SESSION_EXTENSION_OPERATION_TTL_MS;
  sqliteRun(
    `INSERT INTO session_extension_operations
       (id, session_id, user_id, kind, action, resource_ref, payload_json, config_digest,
        expected_revision, channel_id, chat_id, requester_actor_id, nonce, idempotency_key,
        status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)`,
    [
      id,
      input.sessionId,
      input.ownerUserId,
      input.kind,
      input.action,
      input.resourceRef,
      JSON.stringify(input.payload ?? null),
      input.configDigest,
      input.expectedRevision,
      input.channelId ?? null,
      input.chatId ?? null,
      input.requesterActorId ?? null,
      randomUUID(),
      input.idempotencyKey ?? null,
      now + ttl,
      now,
      now,
    ],
  );

  const created = getSessionExtensionOperation(input.sessionId, id);
  if (!created) {
    throw new Error(`创建会话扩展操作失败：${id}`);
  }
  return created;
}

export function getSessionExtensionOperation(
  sessionId: string,
  operationId: string,
): SessionExtensionOperation | undefined {
  const row = sqliteGet<SessionExtensionOperationRow>(
    'SELECT * FROM session_extension_operations WHERE session_id = ? AND id = ? LIMIT 1',
    [sessionId, operationId],
  );
  return row ? rowToOperation(row) : undefined;
}

export function findSessionExtensionOperationByIdempotencyKey(
  sessionId: string,
  idempotencyKey: string,
): SessionExtensionOperation | undefined {
  const row = sqliteGet<SessionExtensionOperationRow>(
    `SELECT * FROM session_extension_operations
      WHERE session_id = ? AND idempotency_key = ?
      ORDER BY created_at DESC LIMIT 1`,
    [sessionId, idempotencyKey],
  );
  return row ? rowToOperation(row) : undefined;
}

export function listSessionExtensionOperations(params: {
  sessionId: string;
  statuses?: readonly SessionExtensionOperationStatus[];
}): SessionExtensionOperation[] {
  const filter = params.statuses?.length
    ? ` AND status IN (${params.statuses.map(() => '?').join(',')})`
    : '';
  const rows = sqliteAll<SessionExtensionOperationRow>(
    `SELECT * FROM session_extension_operations WHERE session_id = ?${filter}
      ORDER BY created_at DESC`,
    [params.sessionId, ...(params.statuses ?? [])],
  );
  return rows.map(rowToOperation);
}

// ---------------------------------------------------------------------------
// 状态迁移（全部走条件 UPDATE，避免读-改-写竞态）
// ---------------------------------------------------------------------------

export type ApproveExtensionOperationResult =
  | { kind: 'approved'; operation: SessionExtensionOperation }
  | { kind: 'not_found' }
  | { kind: 'invalid_nonce' }
  | { kind: 'not_pending'; operation: SessionExtensionOperation }
  | { kind: 'expired'; operation: SessionExtensionOperation };

/**
 * 审批通过：`pending_approval` → `approved`，**单次消费**。
 *
 * `WHERE status = 'pending_approval' AND expires_at > now` 让「两人同时点确认」
 * 只有一个赢家；过期请求即使点进来也不会被放行（而不是被当成已批准）。
 */
export function approveSessionExtensionOperation(params: {
  sessionId: string;
  operationId: string;
  approverUserId: string;
  nonce: string;
  now?: number;
}): ApproveExtensionOperationResult {
  const now = params.now ?? Date.now();
  const existing = getSessionExtensionOperation(params.sessionId, params.operationId);
  if (!existing) return { kind: 'not_found' };
  if (existing.status !== 'pending_approval') {
    return { kind: 'not_pending', operation: existing };
  }
  if (existing.expiresAt <= now) {
    expireSessionExtensionOperation(params.sessionId, params.operationId, now);
    const expired = getSessionExtensionOperation(params.sessionId, params.operationId);
    return expired ? { kind: 'expired', operation: expired } : { kind: 'not_found' };
  }

  if (existing.nonce !== params.nonce) return { kind: 'invalid_nonce' };
  const changed = sqliteRunWithChanges(
    `UPDATE session_extension_operations
        SET status = 'approved', approver_user_id = ?, decision_at = ?, updated_at = ?
      WHERE session_id = ? AND id = ? AND status = 'pending_approval' AND expires_at > ? AND nonce = ?`,
    [params.approverUserId, now, now, params.sessionId, params.operationId, now, params.nonce],
  );
  const updated = getSessionExtensionOperation(params.sessionId, params.operationId);
  if (changed === 0 || !updated) {
    return updated ? { kind: 'not_pending', operation: updated } : { kind: 'not_found' };
  }
  return { kind: 'approved', operation: updated };
}

export function rejectSessionExtensionOperation(params: {
  sessionId: string;
  operationId: string;
  approverUserId: string;
  nonce: string;
  reason?: string;
  now?: number;
}): SessionExtensionOperation | undefined {
  const now = params.now ?? Date.now();
  const changed = sqliteRunWithChanges(
    `UPDATE session_extension_operations
        SET status = 'rejected', approver_user_id = ?, decision_at = ?, updated_at = ?,
            error_message = ?
      WHERE session_id = ? AND id = ? AND status = 'pending_approval' AND nonce = ? AND expires_at > ?`,
    [
      params.approverUserId,
      now,
      now,
      params.reason ?? null,
      params.sessionId,
      params.operationId,
      params.nonce,
      now,
    ],
  );
  if (changed === 0) return undefined;
  return getSessionExtensionOperation(params.sessionId, params.operationId);
}

export function cancelSessionExtensionOperation(params: {
  sessionId: string;
  operationId: string;
  now?: number;
}): SessionExtensionOperation | undefined {
  const now = params.now ?? Date.now();
  const changed = sqliteRunWithChanges(
    `UPDATE session_extension_operations
        SET status = 'cancelled', updated_at = ?
      WHERE session_id = ? AND id = ? AND status IN ('pending_approval', 'approved')`,
    [now, params.sessionId, params.operationId],
  );
  if (changed === 0) return undefined;
  return getSessionExtensionOperation(params.sessionId, params.operationId);
}

/** `approved` → `applying`。返回 `undefined` 表示不属于本操作（例如已被取消）。 */
export function markSessionExtensionOperationApplying(params: {
  sessionId: string;
  operationId: string;
  now?: number;
}): SessionExtensionOperation | undefined {
  const now = params.now ?? Date.now();
  const changed = sqliteRunWithChanges(
    `UPDATE session_extension_operations SET status = 'applying', updated_at = ?
      WHERE session_id = ? AND id = ? AND status = 'approved'`,
    [now, params.sessionId, params.operationId],
  );
  if (changed === 0) return undefined;
  return getSessionExtensionOperation(params.sessionId, params.operationId);
}

export function settleSessionExtensionOperation(params: {
  sessionId: string;
  operationId: string;
  status: Extract<
    SessionExtensionOperationStatus,
    'succeeded' | 'configured_unavailable' | 'failed'
  >;
  result?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  now?: number;
}): SessionExtensionOperation | undefined {
  const now = params.now ?? Date.now();
  const changed = sqliteRunWithChanges(
    `UPDATE session_extension_operations
        SET status = ?, applied_at = ?, updated_at = ?, result_json = ?,
            error_code = ?, error_message = ?
      WHERE session_id = ? AND id = ? AND status = 'applying'`,
    [
      params.status,
      now,
      now,
      params.result === undefined ? null : JSON.stringify(params.result),
      params.errorCode ?? null,
      params.errorMessage ?? null,
      params.sessionId,
      params.operationId,
    ],
  );
  if (changed === 0) return undefined;
  return getSessionExtensionOperation(params.sessionId, params.operationId);
}

export function expireSessionExtensionOperation(
  sessionId: string,
  operationId: string,
  now: number = Date.now(),
): void {
  sqliteRun(
    `UPDATE session_extension_operations SET status = 'expired', updated_at = ?
      WHERE session_id = ? AND id = ? AND status = 'pending_approval' AND expires_at <= ?`,
    [now, sessionId, operationId, now],
  );
}

/**
 * 批量把过期提案标记为 `expired`。
 *
 * 目前**只在启动流程调用一次**（`index.ts` 迁移之后）。别按旧注释去找「`applying` 前
 * 的调用点」，没有那个调用点。
 *
 * 过期在**决策阶段**由 CAS 兜住：批准 / 拒绝都带 `... AND expires_at > now`，所以过期
 * 提案无法被确认。**执行阶段（`markApplying` / `settleSessionExtensionOperation`）不再
 * 检查过期**——它们的条件是 `status = 'approved'` / `status = 'applying'`：一旦在有效期内
 * 批准，之后的执行就不受 TTL 限制。这是有意的：TTL 管的是「确认窗口」，不是「执行窗口」。
 *
 * 批量扫描**不带 session 条件**，调用点只能用于「全局收敛」，不能用来读某个会话的待办。
 */
export function expireStaleSessionExtensionOperations(now: number = Date.now()): number {
  return sqliteRunWithChanges(
    `UPDATE session_extension_operations SET status = 'expired', updated_at = ?
      WHERE status = 'pending_approval' AND expires_at <= ?`,
    [now, now],
  );
}

/**
 * 重启恢复：把卡在 `applying` 的操作标记为 `failed`。
 *
 * 网关重启时正在执行的安装已经断开，重放可能产生重复副作用；保留失败终态并让
 * 用户重新发起，比静默重试安全。
 */
export function failInterruptedSessionExtensionOperations(now: number = Date.now()): number {
  return sqliteRunWithChanges(
    `UPDATE session_extension_operations
        SET status = 'failed', error_code = 'gateway_restart',
            error_message = '网关重启导致安装中断，请重新发起。', updated_at = ?
      WHERE status = 'applying'`,
    [now],
  );
}
