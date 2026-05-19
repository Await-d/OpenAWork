/**
 * 260518-team-l1.3 改造 1 · session_inbound_messages 数据访问层
 *
 * 关联文档：
 *   - docs/team-architecture-l1-3-streaming-handoff-spec.md §1.3
 *   - docs/team-architecture-l1-baseline.md L1.3
 *
 * 设计要点：
 *   1. **消费幂等**（不变量 I3）：state 是单向 pending → consumed，已消费的消息
 *      被相同 sessionId/loopIteration 再次读取时不会重复返回。
 *   2. **客户端幂等**：调用方可传 `clientIdempotencyKey`，重复 submit 同一 key
 *      会复用已有 record（不重复入库）。
 *   3. **优先级**：cancel_signal > pause/resume > clarification_answer > user_input
 *      在 `consumePending` 中按 ORDER BY 实现。
 *   4. **过期**：`expires_at` 之前未消费的消息标记为 expired，不再被消费。
 *      cancel_signal 默认不过期。
 */

import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from '../../infra/db.js';
import type { HandoffRoleLayer } from './handoff-store.js';
import { assertCanReceiveInbound } from '../capability/layer-capabilities.js';

export type InboundMessageType =
  | 'cancel_signal'
  | 'pause_signal'
  | 'resume_signal'
  | 'clarification_answer'
  | 'user_input'
  | 'escalation_request'
  | 'progress_report';

export type InboundMessageState = 'pending' | 'consumed' | 'expired';

interface InboundMessageRow {
  id: string;
  user_id: string;
  to_session_id: string;
  from_role_layer: string;
  message_type: string;
  payload_json: string;
  state: string;
  client_idempotency_key: string | null;
  created_at: string;
  consumed_at: string | null;
  consumed_by_loop_iteration: number | null;
  expires_at: string | null;
}

export interface InboundMessageRecord {
  id: string;
  userId: string;
  toSessionId: string;
  fromRoleLayer: HandoffRoleLayer | 'system';
  messageType: InboundMessageType;
  payload: unknown;
  state: InboundMessageState;
  clientIdempotencyKey: string | null;
  createdAt: string;
  consumedAt: string | null;
  consumedByLoopIteration: number | null;
  expiresAt: string | null;
}

function parsePayload(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (_err) {
    void _err;
    return null;
  }
}

function mapRow(row: InboundMessageRow): InboundMessageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    toSessionId: row.to_session_id,
    fromRoleLayer: row.from_role_layer as HandoffRoleLayer | 'system',
    messageType: row.message_type as InboundMessageType,
    payload: parsePayload(row.payload_json),
    state: row.state as InboundMessageState,
    clientIdempotencyKey: row.client_idempotency_key,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
    consumedByLoopIteration: row.consumed_by_loop_iteration,
    expiresAt: row.expires_at,
  };
}

// ─── Submit ─────────────────────────────────────────────────────────────────

export interface SubmitInboundInput {
  userId: string;
  toSessionId: string;
  fromRoleLayer: HandoffRoleLayer | 'system';
  messageType: InboundMessageType;
  payload: unknown;
  clientIdempotencyKey?: string | null;
  /** ISO datetime string；缺省时使用类型默认（cancel_signal 永不过期，其他 24h） */
  expiresAt?: string | null;
}

const TTL_HOURS_BY_TYPE: Partial<Record<InboundMessageType, number | null>> = {
  cancel_signal: null,
  pause_signal: null,
  resume_signal: null,
  clarification_answer: 24,
  user_input: 24,
  escalation_request: 24,
  progress_report: 1,
};

function defaultExpiresAt(messageType: InboundMessageType): string | null {
  const ttl = TTL_HOURS_BY_TYPE[messageType];
  if (ttl == null) return null; // 永不过期
  const expires = new Date(Date.now() + ttl * 60 * 60 * 1000);
  return expires.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

export interface SubmitInboundResult {
  record: InboundMessageRecord;
  /** 是否复用了已有记录（client_idempotency_key 命中） */
  reused: boolean;
}

export function submitInboundMessage(input: SubmitInboundInput): SubmitInboundResult {
  // L1.4 Guard #2: 检查 fromRoleLayer + messageType 是否被 to_session 所属层允许
  // 注意：reception (b) 接受任何层的反向消息，是 escape hatch #1/#2 的官方通道。
  // user / system 这些非 HandoffRoleLayer 的发送方在 layer-capabilities 中已建模。
  const toSession = sqliteGet<{ role_layer: string | null }>(
    `SELECT role_layer FROM sessions WHERE id = ? LIMIT 1`,
    [input.toSessionId],
  );
  if (toSession?.role_layer) {
    const toRoleLayer = toSession.role_layer as HandoffRoleLayer;
    // 只对已知 HandoffRoleLayer 做校验，不识别的 role_layer（旧数据）跳过
    const knownLayers: ReadonlyArray<HandoffRoleLayer> = [
      'user',
      'reception',
      'pm1',
      'pm2',
      'executor',
      'reviewer',
    ];
    if (knownLayers.includes(toRoleLayer)) {
      assertCanReceiveInbound({
        fromRoleLayer: input.fromRoleLayer,
        toRoleLayer,
        messageType: input.messageType,
        userId: input.userId,
        toSessionId: input.toSessionId,
      });
    }
  }

  // 客户端幂等：同 user + key 已存在则直接返回已有记录
  if (input.clientIdempotencyKey) {
    const existing = sqliteGet<InboundMessageRow>(
      `SELECT * FROM session_inbound_messages
       WHERE user_id = ? AND client_idempotency_key = ?
       LIMIT 1`,
      [input.userId, input.clientIdempotencyKey],
    );
    if (existing) {
      return { record: mapRow(existing), reused: true };
    }
  }

  const id = randomUUID();
  const payloadJson = JSON.stringify(input.payload ?? {});
  const expiresAt = input.expiresAt ?? defaultExpiresAt(input.messageType);
  sqliteRun(
    `INSERT INTO session_inbound_messages (
       id, user_id, to_session_id, from_role_layer, message_type,
       payload_json, state, client_idempotency_key, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      input.userId,
      input.toSessionId,
      input.fromRoleLayer,
      input.messageType,
      payloadJson,
      input.clientIdempotencyKey ?? null,
      expiresAt,
    ],
  );
  const row = sqliteGet<InboundMessageRow>(
    `SELECT * FROM session_inbound_messages WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row) {
    throw new Error('Failed to read back inbound message after insert');
  }
  return { record: mapRow(row), reused: false };
}

// ─── Consume ────────────────────────────────────────────────────────────────

/**
 * 拉取并消费一条 session 当前 pending 消息（按优先级排序）。
 *
 * 行为：
 *   1. 查询 to_session_id = sessionId 且 state='pending' 且未过期的消息
 *   2. 按 messageType 优先级 + created_at 排序
 *   3. 把命中的消息状态改为 'consumed'，写入 consumed_at / consumed_by_loop_iteration
 *   4. 返回该消息（mapRow）
 *
 * **幂等**：consumed → 不会再被本函数返回。
 *
 * @returns 命中的消息；无 pending 时返回 null。
 */
export function consumePendingInboundMessage(input: {
  toSessionId: string;
  loopIteration: number;
}): InboundMessageRecord | null {
  // 先把过期但仍是 pending 的标为 expired（避免被消费）
  sqliteRun(
    `UPDATE session_inbound_messages
       SET state = 'expired'
     WHERE state = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < datetime('now')`,
  );

  // 拉一条最高优先级的 pending
  const row = sqliteGet<InboundMessageRow>(
    `SELECT * FROM session_inbound_messages
     WHERE to_session_id = ? AND state = 'pending'
     ORDER BY
       CASE message_type
         WHEN 'cancel_signal' THEN 0
         WHEN 'pause_signal' THEN 1
         WHEN 'resume_signal' THEN 1
         WHEN 'clarification_answer' THEN 2
         WHEN 'user_input' THEN 3
         WHEN 'escalation_request' THEN 4
         WHEN 'progress_report' THEN 5
         ELSE 9
       END,
       created_at ASC
     LIMIT 1`,
    [input.toSessionId],
  );
  if (!row) return null;

  // 把它标为 consumed
  sqliteRun(
    `UPDATE session_inbound_messages
       SET state = 'consumed',
           consumed_at = datetime('now'),
           consumed_by_loop_iteration = ?
     WHERE id = ? AND state = 'pending'`,
    [input.loopIteration, row.id],
  );

  // 回读以拿到 consumed_at
  const after = sqliteGet<InboundMessageRow>(
    `SELECT * FROM session_inbound_messages WHERE id = ? LIMIT 1`,
    [row.id],
  );
  return after ? mapRow(after) : mapRow(row);
}

/**
 * 一次性 peek 当前 session 所有 pending 消息（不消费）。用于 UI 展示或诊断。
 */
export function listPendingInboundMessages(toSessionId: string): InboundMessageRecord[] {
  // 顺便清理过期
  sqliteRun(
    `UPDATE session_inbound_messages
       SET state = 'expired'
     WHERE state = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < datetime('now')`,
  );
  const rows = sqliteAll<InboundMessageRow>(
    `SELECT * FROM session_inbound_messages
     WHERE to_session_id = ? AND state = 'pending'
     ORDER BY created_at ASC`,
    [toSessionId],
  );
  return rows.map(mapRow);
}

/**
 * 检查 session 是否有 pending 的 cancel_signal（高频路径，避免每轮拉全量）。
 */
export function hasPendingCancelSignal(toSessionId: string): boolean {
  const row = sqliteGet<{ id: string }>(
    `SELECT id FROM session_inbound_messages
     WHERE to_session_id = ?
       AND state = 'pending'
       AND message_type = 'cancel_signal'
     LIMIT 1`,
    [toSessionId],
  );
  return row != null;
}

// ─── Test helpers ───────────────────────────────────────────────────────────

/**
 * 测试用：清空 session 所有 inbound message。
 * 生产代码不应调用。
 */
export function __resetInboundForTesting(toSessionId: string): void {
  sqliteRun(`DELETE FROM session_inbound_messages WHERE to_session_id = ?`, [toSessionId]);
}
