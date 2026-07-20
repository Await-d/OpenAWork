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
  available_at_ms: number | null;
  result_json: string | null;
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
  resultJson?: unknown;
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

export type ReviewDispositionAction = 'redispatch' | 'return-to-c' | 'escalate-to-user';
export type ReviewDispositionStatus = 'handled' | 'pending';

export interface ReviewDispositionRecord {
  action: ReviewDispositionAction;
  reason: string;
  status: ReviewDispositionStatus;
  updatedAtMs: number;
}

export interface EffectiveReviewDispositionRecord extends ReviewDispositionRecord {
  source: 'structured' | 'failure-reason';
}

const UNRECOVERABLE_FAILED_HANDOFF_REASON_PREFIXES = [
  'Architecture Review 未通过',
  'Constitution Check 硬门禁未通过',
  'Spec Review 未通过',
  'quality-review-degraded-summary-failed:',
] as const;

const UNRECOVERABLE_FAILED_HANDOFF_REASON_SUBSTRINGS = ['需要用户介入'] as const;
const AUTO_RETRY_BASE_DELAY_MS = 10_000;
const AUTO_RETRY_MAX_DELAY_MS = 60_000;

function normalizeAvailableAtMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.max(0, Math.floor(value));
  return normalized > 0 ? normalized : null;
}

export function computeAutoRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    AUTO_RETRY_BASE_DELAY_MS * Math.pow(2, normalizedAttempt - 1),
    AUTO_RETRY_MAX_DELAY_MS,
  );
}

export function computeAutoRetryAvailableAtMs(attempt: number, nowMs = Date.now()): number {
  return nowMs + computeAutoRetryDelayMs(attempt);
}

function parsePayload(json: string | null | undefined): unknown {
  if (!json) {
    return null;
  }
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
    resultJson: parsePayload(row.result_json),
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

function scrubHandledReviewDispositionPayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const record = { ...(payload as Record<string, unknown>) };
  delete record['reviewDisposition'];
  delete record['reviewDispositionHandledAction'];
  delete record['reviewDispositionHandledAt'];
  return record;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getReviewDispositionFromPayload(payload: unknown): ReviewDispositionRecord | null {
  if (!isRecord(payload)) {
    return null;
  }
  const raw = payload['reviewDisposition'];
  if (!isRecord(raw)) {
    return null;
  }
  if (
    (raw['action'] === 'redispatch' ||
      raw['action'] === 'return-to-c' ||
      raw['action'] === 'escalate-to-user') &&
    typeof raw['reason'] === 'string' &&
    (raw['status'] === 'pending' || raw['status'] === 'handled') &&
    typeof raw['updatedAtMs'] === 'number'
  ) {
    return {
      action: raw['action'],
      reason: raw['reason'],
      status: raw['status'],
      updatedAtMs: raw['updatedAtMs'],
    };
  }
  return null;
}

export function getReviewDispositionFromPayloadJson(
  payloadJson: string | null | undefined,
): ReviewDispositionRecord | null {
  if (!payloadJson) {
    return null;
  }
  return getReviewDispositionFromPayload(parsePayload(payloadJson));
}

export function mergeReviewDispositionIntoPayload(
  payload: unknown,
  disposition: ReviewDispositionRecord,
): Record<string, unknown> {
  const base = isRecord(payload) ? { ...payload } : {};
  base['reviewDisposition'] = disposition;
  return base;
}

export function inferReviewDispositionFromFailureReason(
  failureReason: string | null | undefined,
): EffectiveReviewDispositionRecord | null {
  if (!failureReason) {
    return null;
  }

  // 规划型失败 → 退回 PM1 重新生成 spec/plan/tasks
  const returnToCPrefixes = [
    'Spec Review 未通过',
    'Planning Contract 未通过',
    'Constitution Check 硬门禁未通过',
    'Architecture Review 未通过',
  ];
  if (returnToCPrefixes.some((prefix) => failureReason.startsWith(prefix))) {
    return {
      action: 'return-to-c',
      reason: failureReason,
      source: 'failure-reason',
      status: 'pending',
      updatedAtMs: 0,
    };
  }

  if (failureReason.includes('需要用户介入')) {
    return {
      action: 'escalate-to-user',
      reason: failureReason,
      source: 'failure-reason',
      status: 'pending',
      updatedAtMs: 0,
    };
  }
  if (
    failureReason.startsWith('quality-review-degraded-summary-failed:') ||
    failureReason.startsWith('Quality Review 未通过')
  ) {
    return {
      action: 'redispatch',
      reason: failureReason,
      source: 'failure-reason',
      status: 'pending',
      updatedAtMs: 0,
    };
  }
  return null;
}

export function getEffectiveReviewDispositionFromPayload(
  payload: unknown,
  failureReason: string | null | undefined,
): EffectiveReviewDispositionRecord | null {
  const structured = getReviewDispositionFromPayload(payload);
  if (structured) {
    return {
      ...structured,
      source: 'structured',
    };
  }
  return inferReviewDispositionFromFailureReason(failureReason);
}

export function getEffectiveReviewDispositionFromPayloadJson(
  payloadJson: string | null | undefined,
  failureReason: string | null | undefined,
): EffectiveReviewDispositionRecord | null {
  return getEffectiveReviewDispositionFromPayload(parsePayload(payloadJson ?? null), failureReason);
}

export function isHandledReviewFailurePayload(payload: unknown): boolean {
  const reviewDisposition = getReviewDispositionFromPayload(payload);
  if (reviewDisposition?.status === 'handled') {
    return true;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    typeof record['reviewDispositionHandledAt'] === 'number' ||
    typeof record['reviewDispositionHandledAt'] === 'string'
  );
}

export function isHandledReviewFailurePayloadJson(payloadJson: string | null | undefined): boolean {
  if (!payloadJson) {
    return false;
  }
  return isHandledReviewFailurePayload(parsePayload(payloadJson));
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateHandoffInput {
  userId: string;
  fromSessionId: string;
  fromRoleLayer: HandoffRoleLayer;
  toRoleLayer: HandoffRoleLayer;
  payload?: unknown;
  idempotencyKey?: string | null;
  notBeforeMs?: number | null;
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
  const availableAtMs = normalizeAvailableAtMs(input.notBeforeMs);
  sqliteRun(
    `INSERT INTO handoff_records (
       id, user_id, from_session_id, from_role_layer, to_role_layer,
       payload_json, available_at_ms, state, retry_count, idempotency_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [
      id,
      input.userId,
      input.fromSessionId,
      input.fromRoleLayer,
      input.toRoleLayer,
      payloadJson,
      availableAtMs,
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
  const nowMs = Date.now();
  const rows = sqliteAll<HandoffRow>(
    `SELECT * FROM handoff_records
     WHERE state = 'pending'
       AND paused = 0
       AND (available_at_ms IS NULL OR available_at_ms <= ?)
     ORDER BY created_at ASC
     LIMIT ?`,
    [nowMs, limit],
  );
  return rows.map(mapRow);
}

/**
 * §0.159: cap on returned rows for {@link listHandoffsBySession}.
 *
 * The route handler `GET /team/sessions/:sessionId/handoffs` JSON-serialises
 * the entire result over the wire, and a long-running team session
 * (a→b→c→pm1→pm2→reviewers fan-out over many rounds) can easily produce
 * hundreds-to-thousands of rows. Without a cap that turns into an unbounded
 * SQL scan + JSON payload + memory spike on the gateway. Default 200 (4×
 * `listPendingHandoffs`'s pending cap, generous enough that any realistic
 * session keeps its full window). `OPENAWORK_LIST_HANDOFFS_BY_SESSION_MAX`
 * lets ops tune it without a redeploy; hard ceiling 500.
 *
 * Selecting the *latest* N keeps the payload focused on the actively
 * interesting handoffs while the older tail can be paged separately if a
 * future endpoint needs it.
 */
const DEFAULT_LIST_HANDOFFS_BY_SESSION_LIMIT = 200;
const MAX_LIST_HANDOFFS_BY_SESSION_LIMIT = 500;

function resolveListHandoffsBySessionCap(requested: number | undefined): number {
  const envRaw = globalThis.process?.env['OPENAWORK_LIST_HANDOFFS_BY_SESSION_MAX'];
  const envCeiling =
    envRaw && Number.isFinite(Number(envRaw)) && Number(envRaw) > 0
      ? Math.min(Math.floor(Number(envRaw)), MAX_LIST_HANDOFFS_BY_SESSION_LIMIT)
      : MAX_LIST_HANDOFFS_BY_SESSION_LIMIT;
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return Math.min(DEFAULT_LIST_HANDOFFS_BY_SESSION_LIMIT, envCeiling);
  }
  return Math.min(Math.floor(requested), envCeiling);
}

export function listHandoffsBySession(input: {
  userId: string;
  sessionId: string;
  /** §0.159: optional cap. Default 200, ceiling 500. */
  limit?: number;
}): HandoffRecord[] {
  const cap = resolveListHandoffsBySessionCap(input.limit);
  const rows = sqliteAll<HandoffRow>(
    `SELECT * FROM (
       SELECT * FROM handoff_records
        WHERE user_id = ? AND (from_session_id = ? OR to_session_id = ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
     ) AS recent
     ORDER BY created_at ASC, id ASC`,
    [input.userId, input.sessionId, input.sessionId, cap],
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
           available_at_ms = NULL,
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

export function completeRunningHandoffById(handoffId: string): boolean {
  const row = sqliteGet<HandoffRow>(`SELECT state FROM handoff_records WHERE id = ? LIMIT 1`, [
    handoffId,
  ]);
  if (!row || row.state !== 'running') {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'completed',
           completed_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND state = 'running'`,
    [handoffId],
  );
  return true;
}

export function failRunningHandoffById(input: { handoffId: string; reason: string }): boolean {
  const row = sqliteGet<HandoffRow>(`SELECT state FROM handoff_records WHERE id = ? LIMIT 1`, [
    input.handoffId,
  ]);
  if (!row || row.state !== 'running') {
    return false;
  }
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'failed',
           failure_reason = ?,
           completed_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ? AND state = 'running'`,
    [input.reason, input.handoffId],
  );
  return true;
}

export function retryRunningHandoffById(handoffId: string): boolean {
  const row = sqliteGet<HandoffRow>(`SELECT * FROM handoff_records WHERE id = ? LIMIT 1`, [
    handoffId,
  ]);
  if (!row || row.state !== 'running') {
    return false;
  }
  const payloadJson = JSON.stringify(
    scrubHandledReviewDispositionPayload(parsePayload(row.payload_json)),
  );
  const availableAtMs = computeAutoRetryAvailableAtMs(row.retry_count + 1);
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'pending',
           failure_reason = NULL,
           claim_token = NULL,
           claimed_at = NULL,
           started_at = NULL,
           completed_at = NULL,
           to_session_id = NULL,
           payload_json = ?,
           available_at_ms = ?,
           retry_count = retry_count + 1,
           updated_at = datetime('now')
     WHERE id = ? AND state = 'running'`,
    [payloadJson, availableAtMs, handoffId],
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

export function retryFailedHandoff(input: { userId: string; handoffId: string }): boolean {
  const row = sqliteGet<HandoffRow>(
    `SELECT * FROM handoff_records WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.handoffId, input.userId],
  );
  if (!row) return false;
  if (row.state !== 'failed') {
    return false;
  }
  if (
    !isRecoverableFailedHandoff({
      failureReason: row.failure_reason,
      payloadJson: row.payload_json,
      toRoleLayer: row.to_role_layer,
    })
  ) {
    return false;
  }
  const payloadJson = JSON.stringify(
    scrubHandledReviewDispositionPayload(parsePayload(row.payload_json)),
  );
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'pending',
           failure_reason = NULL,
           claim_token = NULL,
           claimed_at = NULL,
           started_at = NULL,
           completed_at = NULL,
           to_session_id = NULL,
           payload_json = ?,
           available_at_ms = NULL,
           updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND state = 'failed'`,
    [payloadJson, input.handoffId, input.userId],
  );
  return true;
}

export function isRecoverableFailedHandoffReason(
  failureReason: string | null | undefined,
): boolean {
  if (!failureReason) {
    return true;
  }

  if (
    UNRECOVERABLE_FAILED_HANDOFF_REASON_PREFIXES.some((prefix) => failureReason.startsWith(prefix))
  ) {
    return false;
  }

  if (
    UNRECOVERABLE_FAILED_HANDOFF_REASON_SUBSTRINGS.some((keyword) =>
      failureReason.includes(keyword),
    )
  ) {
    return false;
  }

  return true;
}

export function isRecoverableFailedHandoff(input: {
  failureReason: string | null | undefined;
  payload?: unknown;
  payloadJson?: string | null | undefined;
  toRoleLayer?: string | null | undefined;
}): boolean {
  if (input.toRoleLayer === 'pm2') {
    const effectiveDisposition =
      input.payload !== undefined
        ? getEffectiveReviewDispositionFromPayload(input.payload, input.failureReason)
        : getEffectiveReviewDispositionFromPayloadJson(input.payloadJson, input.failureReason);
    if (effectiveDisposition?.action === 'redispatch') {
      return true;
    }
    if (
      effectiveDisposition?.action === 'return-to-c' ||
      effectiveDisposition?.action === 'escalate-to-user'
    ) {
      return false;
    }
  }

  return isRecoverableFailedHandoffReason(input.failureReason);
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
  /**
   * #8 Doom-loop 防御：一些 handoff（典型如执行层陷入"工具失败→重试→再失败"
   * 死循环）会持续刷新心跳但永远跑不完。此时按心跳判定永远不会触发 reclaim。
   * 给一个**绝对墙钟超时**：handoff 进入 running/claimed 后超过此 ISO 时刻仍
   * 未结束的，即使心跳新鲜也直接 force-fail，避免无限占用资源 + 卡前端进度。
   * 不传则关闭此守卫（保持向后兼容）。
   */
  runningStartedBeforeIso?: string | undefined;
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
      const availableAtMs = computeAutoRetryAvailableAtMs(row.retry_count + 1);
      sqliteRun(
        `UPDATE handoff_records
           SET state = 'pending',
               claim_token = NULL,
               claimed_at = NULL,
               started_at = NULL,
               available_at_ms = ?,
               retry_count = retry_count + 1,
               updated_at = datetime('now')
         WHERE id = ? AND state IN ('claimed','running')`,
        [availableAtMs, row.id],
      );
      reclaimedIds.push(row.id);
    }
  }

  // #8 doom-loop 强制失败：心跳还在但 started_at 已超过墙钟阈值的 handoff 直接 fail。
  // 不重试（这是已知的"持续在错却假装活着"模式，重试只会复制问题）。失败的去重：
  // 已经被前一段标 failed 的不重复处理。
  if (input.runningStartedBeforeIso) {
    const stuckRows = sqliteAll<{ id: string }>(
      `SELECT id FROM handoff_records
        WHERE state IN ('claimed','running')
          AND started_at IS NOT NULL
          AND started_at < ?`,
      [input.runningStartedBeforeIso],
    );
    for (const stuckRow of stuckRows) {
      if (failedIds.includes(stuckRow.id) || reclaimedIds.includes(stuckRow.id)) {
        continue;
      }
      // 用 WHERE state IN ('claimed','running') 保证幂等：若另一进程刚好把它
      // 标成终态，这条 UPDATE 是 no-op；之后的 verify 读会确认实际状态再决定
      // 是否计入 failedIds。
      sqliteRun(
        `UPDATE handoff_records
           SET state = 'failed',
               failure_reason = 'doom-loop-wallclock-timeout',
               completed_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ? AND state IN ('claimed','running')`,
        [stuckRow.id],
      );
      const after = sqliteGet<{ state: string; failure_reason: string | null }>(
        `SELECT state, failure_reason FROM handoff_records WHERE id = ? LIMIT 1`,
        [stuckRow.id],
      );
      // 只在「确实是本次 UPDATE 把它转成 doom-loop failed」时计入 failedIds。
      // 若它已被其它路径（heartbeat-timeout / runner failHandoff）标成别的 failed
      // 原因，则不重复认领、不重复发 handoff.failed 事件。
      if (after?.state === 'failed' && after.failure_reason === 'doom-loop-wallclock-timeout') {
        failedIds.push(stuckRow.id);
      }
    }
  }

  return { reclaimedIds, failedIds };
}
