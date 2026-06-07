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
import { publishTeamEvent } from '../bus/team-events-bus.js';

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

export type ClarificationResolutionStatus = 'answered' | 'dismissed';

interface ClarificationPayloadQuestion {
  answer?: string;
  answeredAt?: number;
  context?: string;
  id?: string;
  question?: string;
  status?: ClarificationResolutionStatus | 'pending';
}

interface ClarificationEscalationPayload {
  fromSessionId?: string;
  questions?: ClarificationPayloadQuestion[];
  reason?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildInboundEventPayload(record: InboundMessageRecord): Record<string, unknown> {
  const payload = isRecord(record.payload) ? record.payload : {};
  const eventPayload: Record<string, unknown> = {
    messageId: record.id,
    toSessionId: record.toSessionId,
    messageType: record.messageType,
    fromRoleLayer: record.fromRoleLayer,
    reused: false,
    ...(typeof payload['fromSessionId'] === 'string'
      ? { fromSessionId: payload['fromSessionId'] }
      : {}),
    ...(typeof payload['handoffId'] === 'string' ? { handoffId: payload['handoffId'] } : {}),
    ...(typeof payload['pm2HandoffId'] === 'string' ? { handoffId: payload['pm2HandoffId'] } : {}),
  };

  if (record.messageType === 'user_input') {
    const text = typeof payload['text'] === 'string' ? payload['text'].trim() : '';
    if (text.length > 0) {
      eventPayload['textPreview'] = text.length > 160 ? `${text.slice(0, 160)}...` : text;
      eventPayload['summary'] = text;
    }
    return eventPayload;
  }

  if (record.messageType === 'clarification_answer') {
    const answer = typeof payload['answer'] === 'string' ? payload['answer'].trim() : '';
    if (answer.length > 0) {
      eventPayload['textPreview'] = answer.length > 160 ? `${answer.slice(0, 160)}...` : answer;
      eventPayload['summary'] = `已回答澄清：${answer}`;
    }
    return eventPayload;
  }

  if (record.messageType === 'progress_report') {
    if (typeof payload['progressText'] === 'string' && payload['progressText'].trim().length > 0) {
      eventPayload['summary'] = payload['progressText'].trim();
    }
    if (typeof payload['percent'] === 'number') {
      eventPayload['percent'] = payload['percent'];
    }
    eventPayload['blocking'] = false;
    return eventPayload;
  }

  if (record.messageType === 'escalation_request') {
    const reason = typeof payload['reason'] === 'string' ? payload['reason'] : null;
    const context = typeof payload['context'] === 'string' ? payload['context'].trim() : '';
    if (reason) {
      eventPayload['reason'] = reason;
    }
    if (context.length > 0) {
      eventPayload['summary'] = context;
    }
    if (Array.isArray(payload['suggestedActions'])) {
      eventPayload['suggestedActions'] = payload['suggestedActions'];
    }
    if (Array.isArray(payload['questions'])) {
      eventPayload['questions'] = payload['questions'];
    }
    eventPayload['blocking'] = reason !== 'needs_clarification';
    return eventPayload;
  }

  if (typeof payload['reason'] === 'string') {
    eventPayload['summary'] = payload['reason'];
  }
  return eventPayload;
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

/**
 * 终态行（consumed / expired）保留窗口。`session_inbound_messages` 的行经状态机
 * 走 pending → consumed/expired，但生产代码从不 DELETE 终态行（仅 session 删除时
 * CASCADE）。一个长期运行、反向消息频繁的 team session 会让终态行无界堆积。所有
 * 类型 TTL <=24h，且 `resolveClarificationEscalationRequest` 只读未过期行，因此删除
 * 「创建时间早于一个远大于最大 TTL 的窗口」的终态行不会破坏任何读路径。pending 行
 * 永不在此删除（仍可被消费）。摊销执行：每累计 N 次插入才扫一次，写放大可忽略。
 */
const DEFAULT_SESSION_INBOUND_TERMINAL_MAX_AGE_HOURS = 24 * 7;
export const SESSION_INBOUND_PRUNE_CHECK_INTERVAL = 100;

let inboundRetentionHoursOverride: number | null = null;
let inboundPruneCheckInterval = SESSION_INBOUND_PRUNE_CHECK_INTERVAL;
let inboundInsertsSincePrune = 0;

function resolveInboundTerminalMaxAgeHours(): number {
  if (inboundRetentionHoursOverride !== null) {
    return inboundRetentionHoursOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_SESSION_INBOUND_TERMINAL_MAX_AGE_HOURS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_SESSION_INBOUND_TERMINAL_MAX_AGE_HOURS;
  }
  const parsed = Number(raw);
  // 非正数 / NaN 视为「关闭裁剪」，与 sibling 保留存储的 env 死线开关语义一致。
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneTerminalInboundMessages(maxAgeHours: number): void {
  // 先把「已过 expires_at 但仍是 pending」的行全局标记为 expired。过期→expired 的
  // 转移此前只发生在 consumePendingInboundMessage / listPendingInboundMessages 这两条
  // **按 session** 的惰性路径上。一个被放弃的 session（handoff 失败/取消后再无人轮询
  // 或列举）留下的过期 pending 行因此永远停在 pending，既不会被读到、也不满足下方
  // 终态行 DELETE 的 `state IN ('consumed','expired')` 条件——于是无界泄漏直到 session
  // 删除 CASCADE。这里在裁剪前做一次**全局**（不限 session）过期转移，让这些孤儿行
  // 进入 expired 终态、从而能被保留窗口回收。永不过期的类型（cancel/pause/resume，
  // expires_at IS NULL）不受影响。
  sqliteRun(
    `UPDATE session_inbound_messages
        SET state = 'expired'
      WHERE state = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at < datetime('now')`,
  );
  // 只删终态行（consumed / expired）且 created_at 早于保留窗口；未过期的 pending 从不删除。
  sqliteRun(
    `DELETE FROM session_inbound_messages
      WHERE state IN ('consumed', 'expired')
        AND created_at < datetime('now', ?)`,
    [`-${maxAgeHours} hours`],
  );
}

function maybePruneInboundMessages(): void {
  const maxAgeHours = resolveInboundTerminalMaxAgeHours();
  if (maxAgeHours <= 0) {
    // 裁剪关闭：重置计数，避免重新开启后立刻触发一次大裁剪。
    inboundInsertsSincePrune = 0;
    return;
  }
  inboundInsertsSincePrune += 1;
  if (inboundInsertsSincePrune < inboundPruneCheckInterval) {
    return;
  }
  inboundInsertsSincePrune = 0;
  try {
    pruneTerminalInboundMessages(maxAgeHours);
  } catch {
    // 裁剪失败只吞：保留是 best-effort，绝不影响反向消息写入或消费主流程。
  }
}

/** 测试用：覆盖终态行保留窗口小时数（传 null 恢复 env / 默认）。 */
export function __setSessionInboundRetentionForTesting(
  maxAgeHours: number | null,
  checkInterval?: number,
): void {
  inboundRetentionHoursOverride = maxAgeHours;
  inboundPruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : SESSION_INBOUND_PRUNE_CHECK_INTERVAL;
  inboundInsertsSincePrune = 0;
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
  const record = mapRow(row);
  publishTeamEvent({
    type: 'session.inbound.submitted',
    sessionId: record.toSessionId,
    layer: record.fromRoleLayer,
    timestamp: Date.now(),
    payload: buildInboundEventPayload(record),
    userId: record.userId,
  });
  // Opportunistic retention: drop old terminal-state rows so this table stays
  // bounded on a long-lived session with frequent inbound traffic.
  maybePruneInboundMessages();
  return { record, reused: false };
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

/** 控制信号类型（cancel/pause/resume）——只影响执行生命周期，不携带业务数据。 */
export type InboundControlSignalType = 'cancel_signal' | 'pause_signal' | 'resume_signal';

/**
 * 消费一条 session 当前 pending 的**控制信号**（仅 cancel/pause/resume）。
 *
 * 与 {@link consumePendingInboundMessage} 的区别：本函数**只**消费三类控制信号，
 * 绝不碰 clarification_answer / user_input / escalation_request / progress_report
 * —— 那些是业务消息，由各自的路径（artifact-chain 澄清循环、reception 编排、
 * 前端通知面板）消费。流式执行层（executor/reviewer/pm2）在每个 LLM round 之间
 * 调本函数来响应用户的取消/暂停，而不会误吞业务消息。
 *
 * 优先级：cancel > pause > resume；同级按 created_at 升序。命中即标记 consumed（幂等）。
 *
 * @returns 命中的控制信号；无则返回 null。
 */
export function consumePendingControlSignal(input: {
  toSessionId: string;
  loopIteration?: number;
}): InboundMessageRecord | null {
  // 先把过期但仍 pending 的标为 expired（与 consumePendingInboundMessage 一致）。
  sqliteRun(
    `UPDATE session_inbound_messages
       SET state = 'expired'
     WHERE state = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < datetime('now')`,
  );

  const row = sqliteGet<InboundMessageRow>(
    `SELECT * FROM session_inbound_messages
     WHERE to_session_id = ? AND state = 'pending'
       AND message_type IN ('cancel_signal', 'pause_signal', 'resume_signal')
     ORDER BY
       CASE message_type
         WHEN 'cancel_signal' THEN 0
         WHEN 'pause_signal' THEN 1
         WHEN 'resume_signal' THEN 1
         ELSE 9
       END,
       created_at ASC
     LIMIT 1`,
    [input.toSessionId],
  );
  if (!row) return null;

  sqliteRun(
    `UPDATE session_inbound_messages
       SET state = 'consumed',
           consumed_at = datetime('now'),
           consumed_by_loop_iteration = ?
     WHERE id = ? AND state = 'pending'`,
    [input.loopIteration ?? null, row.id],
  );

  const after = sqliteGet<InboundMessageRow>(
    `SELECT * FROM session_inbound_messages WHERE id = ? LIMIT 1`,
    [row.id],
  );
  return after ? mapRow(after) : mapRow(row);
}

export function resolveClarificationEscalationRequest(input: {
  answer?: string;
  answeredAt?: number;
  questionId: string;
  status: ClarificationResolutionStatus;
  userId: string;
}): InboundMessageRecord | null {
  const rows = sqliteAll<InboundMessageRow>(
    `SELECT * FROM session_inbound_messages
     WHERE user_id = ?
       AND message_type = 'escalation_request'
       AND state IN ('pending', 'consumed')
       AND (expires_at IS NULL OR expires_at >= datetime('now'))
     ORDER BY created_at DESC`,
    [input.userId],
  );

  for (const row of rows) {
    const payload = parsePayload(row.payload_json);
    if (!isRecord(payload)) {
      continue;
    }
    const typedPayload = payload as ClarificationEscalationPayload;
    if (typedPayload.reason !== 'needs_clarification' || !Array.isArray(typedPayload.questions)) {
      continue;
    }

    let found = false;
    const nextQuestions = typedPayload.questions.map((question) => {
      if (!question || typeof question !== 'object') {
        return question;
      }
      const typedQuestion = question;
      if (typedQuestion.id !== input.questionId) {
        return typedQuestion;
      }
      found = true;
      return {
        ...typedQuestion,
        ...(input.status === 'answered' && typeof input.answer === 'string'
          ? { answer: input.answer }
          : {}),
        ...(typeof input.answeredAt === 'number' ? { answeredAt: input.answeredAt } : {}),
        status: input.status,
      };
    });

    if (!found) {
      continue;
    }

    const allResolved = nextQuestions.every((question) => {
      if (!question || typeof question !== 'object') {
        return false;
      }
      const status = question.status;
      return status === 'answered' || status === 'dismissed';
    });

    const nextPayload = {
      ...typedPayload,
      questions: nextQuestions,
    };
    sqliteRun(
      `UPDATE session_inbound_messages
         SET payload_json = ?,
             state = ?,
             consumed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE consumed_at END
       WHERE id = ?`,
      [
        JSON.stringify(nextPayload),
        allResolved ? 'consumed' : 'pending',
        allResolved ? 1 : 0,
        row.id,
      ],
    );

    const updated = sqliteGet<InboundMessageRow>(
      `SELECT * FROM session_inbound_messages WHERE id = ? LIMIT 1`,
      [row.id],
    );
    return updated ? mapRow(updated) : mapRow(row);
  }

  return null;
}

// ─── Test helpers ───────────────────────────────────────────────────────────

/**
 * 测试用：清空 session 所有 inbound message。
 * 生产代码不应调用。
 */
export function __resetInboundForTesting(toSessionId: string): void {
  sqliteRun(`DELETE FROM session_inbound_messages WHERE to_session_id = ?`, [toSessionId]);
}
