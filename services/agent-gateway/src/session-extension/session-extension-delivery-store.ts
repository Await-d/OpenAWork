/**
 * 会话扩展结果的**持久化投递**（261101）。
 *
 * 背景：确认在 Web 端完成，结果却要说回发起它的渠道会话。此前是
 * fire-and-forget（`void notifyChannelSession(...)`）——网关重启、渠道服务未起、
 * 平台 API 抖动，都会让「那次确认到底生效没有」永远没有回音，而库里其实早已结算。
 *
 * 与 `task-job-delivery` / `team_inbound_outbox` 同形：**先落库再投递**，失败退避
 * 重试，租约防止并发重复发送。`operation_id` 作主键天然按操作去重，对应方案 §5
 * 的「按 operationId 去重……通知失败不重复安装」。
 */

import { sqliteAll, sqliteGet, sqliteRun, sqliteRunWithChanges } from '../infra/db.js';
import { buildSessionExtensionResultText } from './session-extension-confirmation.js';
import {
  getSessionExtensionOperation,
  type SessionExtensionOperation,
} from './session-extension-operation-store.js';

export type SessionExtensionDeliveryState =
  'pending' | 'processing' | 'delivered' | 'skipped' | 'dead';

/** 单个回执最多尝试次数；耗尽后置 `dead` 停止重试（安装本身已经结算，不受影响）。 */
export const SESSION_EXTENSION_DELIVERY_MAX_ATTEMPTS = 5;

/** 投递租约：领取后多久未结算就允许重领——进程死在投递中途的兜底。 */
export const SESSION_EXTENSION_DELIVERY_LEASE_MS = 60_000;

/**
 * 启动补偿回看窗口，按**结算时刻**（`updated_at`）计算。
 *
 * 早先按 `created_at` 只回看 30 分钟，而提案 TTL 是 10 分钟，于是存在一个真实的
 * 漏判：提案在 T0 建、T0+10min 内被确认、进程在紧接着的崩溃中丢掉入队——只要
 * 停机超过约 20 分钟，这条已结算的回执就永远补不回来。改用结算时刻后，窗口直接
 * 等于「可容忍的停机时长」。
 *
 * 窗口开到 24h 也不会灌爆渠道：查询本身用 `LEFT JOIN ... IS NULL` 排除了**任何
 * 已有投递记录**的操作，剩下的只可能是「结算了但从没入队」的崩溃孤儿。
 */
export const SESSION_EXTENSION_DELIVERY_RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 启动补偿可回收的终态。
 *
 * 刻意**不含 `expired`**：启动时的批量过期会把所有超时提案一次性刷成 `expired`，
 * 若一并回推，一次重启就能给渠道灌满「你的申请过期了」。这不是崩溃孤儿，而是
 * 批量状态收敛，不该产生一批回执。用户主动触发的过期仍走实时路径
 * （`enqueueSessionExtensionDelivery` 不看这个集合）。
 */
const RECONCILABLE_STATUSES = [
  'succeeded',
  'configured_unavailable',
  'failed',
  'rejected',
  'cancelled',
] as const;

const RECONCILABLE_STATUS_SET = new Set<string>([...RECONCILABLE_STATUSES, 'expired']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLabel(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** 回执里用哪个名字称呼这次变更的目标。 */
export function resolveDeliveryTargetLabel(operation: SessionExtensionOperation): string {
  const payload = isRecord(operation.payload) ? operation.payload : {};
  return (
    readLabel(payload['displayName']) ??
    readLabel(payload['displayId']) ??
    readLabel(payload['skillId']) ??
    operation.resourceRef ??
    (operation.kind === 'skill' ? '未命名技能' : '未命名 MCP')
  );
}

/**
 * 终态 → 回执文案；**不是终态就返回 `null`**。
 *
 * `pending_approval` / `approved` / `applying` 一律不回推：那代表「这次点击没有做
 * 任何变更」（无效 nonce、越权、重复点击都会停在这些状态），回一条「已处理」会
 * 误导用户以为变更发生了。
 */
export function buildSessionExtensionDeliveryText(
  operation: SessionExtensionOperation,
): string | null {
  if (!RECONCILABLE_STATUS_SET.has(operation.status)) return null;
  return buildSessionExtensionResultText({
    kind: operation.kind,
    targetLabel: resolveDeliveryTargetLabel(operation),
    status: operation.status as
      'succeeded' | 'configured_unavailable' | 'failed' | 'rejected' | 'expired' | 'cancelled',
    errorMessage: operation.errorMessage,
  });
}

export interface SessionExtensionDelivery {
  readonly operationId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly attemptCount: number;
}

/**
 * 把一条已结算的操作排进回推队列。
 *
 * **幂等**：主键是 `operation_id`，`INSERT OR IGNORE` 让重复调用（重试的决策、
 * 启动补偿、并发派发）只留一条。返回 `true` 表示这次真的新建了记录。
 *
 * 文案在**入队时**就冻结进库：回执要反映结算那一刻的结果，而不是后来被改动过的配置。
 */
export function enqueueSessionExtensionDelivery(params: {
  operationId: string;
  sessionId: string;
  now?: number;
}): boolean {
  const operation = getSessionExtensionOperation(params.sessionId, params.operationId);
  if (!operation) return false;
  const text = buildSessionExtensionDeliveryText(operation);
  if (!text) return false;

  const now = params.now ?? Date.now();
  const changed = sqliteRunWithChanges(
    `INSERT OR IGNORE INTO session_extension_deliveries
       (operation_id, session_id, state, attempt_count, available_at_ms, text, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)`,
    [params.operationId, params.sessionId, now, text, now, now],
  );
  return changed > 0;
}

/**
 * 把租约已过期的 `processing` 收回成 `pending`。
 *
 * 领取者若在投递中途消失（进程被杀、事件循环卡死），记录会永远停在 `processing`
 * 且无人再碰它——这条 UPDATE 是唯一的回收口。
 */
export function reclaimExpiredSessionExtensionDeliveryLeases(now = Date.now()): number {
  return sqliteRunWithChanges(
    `UPDATE session_extension_deliveries
        SET state = 'pending', lease_token = NULL, lease_until_ms = NULL, updated_at = ?
      WHERE state = 'processing' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?`,
    [now, now],
  );
}

/**
 * 领取一条到期回执。
 *
 * 并发安全靠**单条 UPDATE 的原子性**：先查出候选，再用 `WHERE state='pending' AND
 * available_at_ms <= ?` 做条件更新，`changes === 0` 说明被别人抢走 —— 不依赖事务
 * 隔离级别（与 `composer-queue` 的 claim 同思路）。
 */
export function claimDueSessionExtensionDelivery(params: {
  leaseToken: string;
  now?: number;
}): SessionExtensionDelivery | null {
  const now = params.now ?? Date.now();
  const due = sqliteGet<{
    operation_id: string;
    session_id: string;
    text: string;
    attempt_count: number;
  }>(
    `SELECT operation_id, session_id, text, attempt_count
       FROM session_extension_deliveries
      WHERE state = 'pending' AND available_at_ms <= ?
      ORDER BY available_at_ms ASC, created_at ASC
      LIMIT 1`,
    [now],
  );
  if (!due) return null;

  const changed = sqliteRunWithChanges(
    `UPDATE session_extension_deliveries
        SET state = 'processing', lease_token = ?, lease_until_ms = ?,
            attempt_count = attempt_count + 1, updated_at = ?
      WHERE operation_id = ? AND state = 'pending' AND available_at_ms <= ?`,
    [params.leaseToken, now + SESSION_EXTENSION_DELIVERY_LEASE_MS, now, due.operation_id, now],
  );
  if (changed === 0) return null;

  return {
    operationId: due.operation_id,
    sessionId: due.session_id,
    text: due.text,
    attemptCount: due.attempt_count + 1,
  };
}

/**
 * 投递成功 / 与投递无关地终结。
 *
 * `skipped` 用于「非渠道会话」这类**终态**：目标不存在不是失败，重试多少次都不会
 * 变成存在，必须直接终结，否则每次轮询都白跑一轮。
 */
export function ackSessionExtensionDelivery(params: {
  operationId: string;
  leaseToken: string;
  outcome: 'delivered' | 'skipped';
  now?: number;
}): boolean {
  const now = params.now ?? Date.now();
  return (
    sqliteRunWithChanges(
      `UPDATE session_extension_deliveries
          SET state = ?, lease_token = NULL, lease_until_ms = NULL, last_error = NULL, updated_at = ?
        WHERE operation_id = ? AND state = 'processing' AND lease_token = ?`,
      [params.outcome, now, params.operationId, params.leaseToken],
    ) > 0
  );
}

/**
 * 投递失败：按指数退避重排；超过上限置 `dead`。
 *
 * 退避上限 60s 与 team inbound outbox 保持一致。`dead` 只是「不再尝试推送」，
 * 安装结果仍在库里可查，不回滚、不重复安装。
 *
 * 返回 `null` 表示**租约已不归自己**（被过期回收或已被他人结算）——此时什么都不做，
 * 不能拿一个迟到的失败去改写别人正在处理的记录。
 */
export function failSessionExtensionDelivery(params: {
  operationId: string;
  leaseToken: string;
  error: string;
  now?: number;
}): SessionExtensionDeliveryState | null {
  const now = params.now ?? Date.now();
  const row = sqliteGet<{ attempt_count: number }>(
    `SELECT attempt_count FROM session_extension_deliveries
      WHERE operation_id = ? AND lease_token = ?`,
    [params.operationId, params.leaseToken],
  );
  if (!row) return null;

  if (row.attempt_count >= SESSION_EXTENSION_DELIVERY_MAX_ATTEMPTS) {
    sqliteRun(
      `UPDATE session_extension_deliveries
          SET state = 'dead', lease_token = NULL, lease_until_ms = NULL, last_error = ?, updated_at = ?
        WHERE operation_id = ?`,
      [params.error, now, params.operationId],
    );
    return 'dead';
  }

  const delayMs = Math.min(60_000, 1_000 * 2 ** row.attempt_count);
  sqliteRun(
    `UPDATE session_extension_deliveries
        SET state = 'pending', lease_token = NULL, lease_until_ms = NULL,
            available_at_ms = ?, last_error = ?, updated_at = ?
      WHERE operation_id = ?`,
    [now + delayMs, params.error, now, params.operationId],
  );
  return 'pending';
}

/** 单条投递记录（观测 / 排障用）。 */
export function getSessionExtensionDelivery(operationId: string):
  | {
      operationId: string;
      sessionId: string;
      state: SessionExtensionDeliveryState;
      attemptCount: number;
      lastError: string | null;
      text: string;
    }
  | undefined {
  const row = sqliteGet<{
    operation_id: string;
    session_id: string;
    state: string;
    attempt_count: number;
    last_error: string | null;
    text: string;
  }>(
    `SELECT operation_id, session_id, state, attempt_count, last_error, text
       FROM session_extension_deliveries WHERE operation_id = ? LIMIT 1`,
    [operationId],
  );
  if (!row) return undefined;
  return {
    operationId: row.operation_id,
    sessionId: row.session_id,
    state: row.state as SessionExtensionDeliveryState,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    text: row.text,
  };
}

/**
 * 启动补偿：为「已结算但没有任何投递记录」的操作补一条。
 *
 * 为什么需要：入队与「结算操作」不是同一个事务——结算散落在决策、执行、取消、
 * 过期多条路径上，中间崩溃就会丢一条回执。操作记录本身是恢复真相源，这里按
 * **结算时刻**（`updated_at`，每条状态迁移都会推进它）限定窗口回看，既补上缺口，
 * 又不会在重启时翻出陈年提案。
 */
export function reconcileSessionExtensionDeliveries(
  params: { now?: number; windowMs?: number } = {},
): number {
  const now = params.now ?? Date.now();
  const windowMs = params.windowMs ?? SESSION_EXTENSION_DELIVERY_RECONCILE_WINDOW_MS;
  const rows = sqliteAll<{ id: string; session_id: string }>(
    `SELECT o.id AS id, o.session_id AS session_id
       FROM session_extension_operations o
       LEFT JOIN session_extension_deliveries d ON d.operation_id = o.id
      WHERE d.operation_id IS NULL
        AND o.status IN ('succeeded', 'configured_unavailable', 'failed', 'rejected', 'cancelled')
        AND o.updated_at >= ?
      ORDER BY o.updated_at ASC
      LIMIT 200`,
    [now - windowMs],
  );

  let enqueued = 0;
  for (const row of rows) {
    if (enqueueSessionExtensionDelivery({ operationId: row.id, sessionId: row.session_id, now })) {
      enqueued += 1;
    }
  }
  return enqueued;
}
