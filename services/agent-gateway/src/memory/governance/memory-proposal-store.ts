import { createHash, randomUUID } from 'node:crypto';
import type {
  MemoryProposal,
  MemoryProposalAction,
  MemoryProposalOrigin,
  MemoryProposalPayload,
  MemoryProposalRelation,
  MemoryProposalStatus,
  MemoryReviewDecisionRecord,
  MemoryScope,
  MemorySourceProvenance,
} from '@openAwork/agent-core';
import {
  detectExactDuplicateGroups,
  detectValueConflicts,
  hasTransientContext,
  isProposalExpired,
  memoryProposalExpiry,
  memoryProposalPayloadFingerprint,
  memoryScopeKey,
  normalizeMemoryKey,
} from '@openAwork/agent-core';
import { sqliteAll, sqliteGet, sqliteRun, sqliteRunWithChanges } from '../../infra/db.js';
import { scanMemoryWriteContent } from '../memory-security-scanner.js';
import { getMemoryById, listActiveMemoriesForScope } from '../memory-store.js';
import { logGatewayWarn } from '../../infra/gateway-logger.js';

/**
 * 记忆提议存储（261101-记忆确认写入与周期整理）。
 *
 * `createMemoryProposal` 是产生正式提议的**唯一入口**，且**不是**写入正式记忆的入口——
 * 它只往 `memory_proposals` 落一行 pending。真正的写入由 `memory-commit-service.ts`
 * 在用户确认后执行。任何「自动抽取 / 模型工具 / 团队初始化」都必须经过这里。
 *
 * 拒绝优先：内容过安全扫描、临时语义过滤、重复抑制、去重全部在创建期完成，绝不把可疑
 * 内容先落库再靠确认期补救。
 */

export interface CreateMemoryProposalInput {
  userId: string;
  action: MemoryProposalAction;
  scope: MemoryScope;
  payload: MemoryProposalPayload;
  origin: MemoryProposalOrigin;
  reason?: string | null;
  confidence?: number | null;
  provenance?: MemorySourceProvenance | null;
  targetMemoryId?: string | null;
  expectedRevision?: number | null;
  now?: Date;
}

export type CreateMemoryProposalOutcome =
  'created' | 'suppressed' | 'duplicate' | 'unsafe' | 'transient' | 'invalid';

export interface CreateMemoryProposalResult {
  outcome: CreateMemoryProposalOutcome;
  proposal?: MemoryProposal;
  detail?: string;
}

interface MemoryProposalRow {
  id: string;
  user_id: string;
  action: string;
  scope_type: string;
  scope_id: string;
  target_memory_id: string | null;
  expected_revision: number | null;
  payload_json: string;
  payload_digest: string;
  reason: string | null;
  origin: string;
  confidence: number | null;
  source_json: string | null;
  dedupe_key: string | null;
  status: string;
  multi_item: number;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  result_memory_id: string | null;
  revision: number;
  notified_at: string | null;
}

/** 键排序后的稳定序列化：同一逻辑内容无论键顺序如何，digest 一致。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

/**
 * 提议载荷摘要。确认时用它比对「用户看到的」与「即将写入的」是否一致，防止确认与提交
 * 之间载荷被替换（TOCTOU）。规范化 JSON 保证键顺序不影响结果。
 */
export function computeMemoryProposalDigest(payload: MemoryProposalPayload): string {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function parsePayload(payloadJson: string): MemoryProposalPayload {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // `MemoryProposalPayload` 全字段可选，因此 `object` 可直接返回，无需断言
      //（多余的断言会被 `@typescript-eslint/no-unnecessary-type-assertion` 拦下）。
      return parsed;
    }
  } catch (error) {
    logGatewayWarn(
      `[memory-proposal-store] payload_json 解析失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return {};
}

function rowToProposal(row: MemoryProposalRow): MemoryProposal {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action as MemoryProposalAction,
    scope: { type: row.scope_type as MemoryScope['type'], id: row.scope_id },
    targetMemoryId: row.target_memory_id,
    expectedRevision: row.expected_revision,
    payload: parsePayload(row.payload_json),
    payloadDigest: row.payload_digest,
    reason: row.reason,
    origin: row.origin as MemoryProposalOrigin,
    confidence: row.confidence,
    status: row.status as MemoryProposalStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
    resultMemoryId: row.result_memory_id,
    revision: row.revision,
  };
}

/** 载荷里承载正文的字段对。 */
function payloadContents(payload: MemoryProposalPayload): { key: string; value: string } {
  return {
    key: payload.key ?? payload.name ?? '',
    value: payload.value ?? payload.body ?? '',
  };
}

/**
 * 载荷是否满足该动作的最低结构要求。
 *
 * `create` / `update` / `merge` / `rule` 需要可写入的正文；`archive` / `restore` 只改
 * 生命周期，正文可缺省（但要有目标条目）。
 */
function isPayloadStructurallyValid(
  action: MemoryProposalAction,
  payload: MemoryProposalPayload,
): boolean {
  const { key, value } = payloadContents(payload);
  switch (action) {
    case 'create':
    case 'update':
    case 'merge':
      return key.trim().length > 0 && value.trim().length > 0;
    case 'rule':
      return (payload.name ?? '').trim().length > 0 && (payload.body ?? '').trim().length > 0;
    case 'archive':
    case 'restore':
      return true;
    default:
      return false;
  }
}

function payloadIsUnsafe(payload: MemoryProposalPayload): string | null {
  const { key, value } = payloadContents(payload);
  const scanKey = scanMemoryWriteContent(key);
  if (!scanKey.ok) {
    return scanKey.reason ?? '内容安全扫描未通过';
  }
  const scanValue = scanMemoryWriteContent(value);
  if (!scanValue.ok) {
    return scanValue.reason ?? '内容安全扫描未通过';
  }
  return null;
}

/**
 * 创建正式提议。返回 `created` 时提议已落库（pending）；其余情形均**未落库**或
 * 已存在同内容 pending（`duplicate`）。
 */
export function createMemoryProposal(input: CreateMemoryProposalInput): CreateMemoryProposalResult {
  const now = input.now ?? new Date();
  const payload = input.payload;
  const target = input.targetMemoryId
    ? getMemoryById(input.userId, input.targetMemoryId)
    : undefined;
  const frozenRevision = input.expectedRevision ?? target?.revision ?? null;

  if (!isPayloadStructurallyValid(input.action, payload)) {
    return { outcome: 'invalid', detail: '载荷缺少该动作必需的字段' };
  }

  const unsafeReason = payloadIsUnsafe(payload);
  if (unsafeReason !== null) {
    return { outcome: 'unsafe', detail: unsafeReason };
  }

  // 临时语义过滤：堵的是「要不要把一次性信息**记下来**」，故只作用于会**引入正文**的动作
  // （create / update / rule）。archive / restore / merge 方向相反——它们是在**清理 / 归并**
  // 已存内容，payload 里的 key/value 恰恰因为含「临时 / 今天 / 报错」等词才需要归档，若一并
  // 过滤，维护任务的归档提议将永远建不出来。用户主动要求记录（manual_extract / tool）同样
  // 不因临时词丢弃，仍进入确认流程。
  //
  // 已知边界（有意保留，勿加分支）：`update` 仍在过滤范围内，故「同键不同值冲突裁决」提议若
  // 其 value 恰好含临时词也会被判为 transient。这类条目会由同轮日巡检的
  // `detectTransientEntries` 命中并改走 `archive` 提议，用户仍会看到并处置——即冲突裁决语义
  // 被归档通道部分吸收，非彻底无感。收窄为「payload 与目标现值不同才过滤」需要在过滤期读库，
  // 复杂度收益不划算，故不实现。
  const introducesContent =
    input.action === 'create' || input.action === 'update' || input.action === 'rule';
  // 用户主动发起的来源一律不看临时词：
  //   - `manual_extract` / `tool`：会话里用户点抽取、模型按用户要求调用工具；
  //   - `api`：用户在设置页/界面里显式提交（含「新增规则」）。
  // 只有**自动积累**的来源（auto_extract / channel / maintenance / team_init）才被
  // 临时语义挡掉——那正是用户要避免的「临时操作被记成长期记录」。
  // 反例（曾踩到）：用户在界面上建一条名为「临时规矩」的规则，若走临时词过滤会被静默
  // 丢弃且只回 400，用户看到的是「莫名其妙的失败」。
  const userInitiated =
    input.origin === 'manual_extract' || input.origin === 'tool' || input.origin === 'api';
  if (introducesContent && !userInitiated) {
    const { key, value } = payloadContents(payload);
    if (hasTransientContext(`${key}\n${value}`)) {
      return { outcome: 'transient', detail: '内容含一次性/临时语义，不生成提议' };
    }
  }

  // 抑制（「别再反复问我」）只作用于**自动积累**的来源。
  //
  // 用户主动发起的来源必须豁免：拒绝过一次不等于永久放弃，用户之后主动、显式地再提交
  // 同一内容属于新的明确指令。若一并抑制，用户会拿到一个无法解释的失败（接口 400、
  // 界面无条目）且没有任何自助解除途径——这比「多问一次」糟糕得多。
  // （与上面临时语义过滤的豁免集合刻意保持一致。）
  const fingerprint = memoryProposalPayloadFingerprint(payload);
  if (!userInitiated && hasMemoryReviewDecision(input.userId, input.scope, fingerprint)) {
    return { outcome: 'suppressed', detail: '同内容已被用户拒绝或保留原状' };
  }

  const payloadJson = JSON.stringify(payload);
  const payloadDigest = computeMemoryProposalDigest(payload);
  const dedupeKey = createHash('sha256')
    .update(
      JSON.stringify([
        input.scope.type,
        input.scope.id,
        input.action,
        input.targetMemoryId ?? null,
        frozenRevision,
        payloadDigest,
      ]),
    )
    .digest('hex');
  const expiresAt = memoryProposalExpiry(now);
  const id = randomUUID();
  const createdAt = now.toISOString();

  // 去重表达为「唯一索引 + INSERT OR IGNORE」：只有 pending 行参与去重（部分唯一索引
  // `idx_memory_proposals_pending_dedupe`）。冲突即说明已有同内容待确认提议，回读返回。
  const changes = sqliteRunWithChanges(
    `INSERT OR IGNORE INTO memory_proposals (
       id, user_id, action, scope_type, scope_id, target_memory_id, expected_revision,
       payload_json, payload_digest, reason, origin, confidence, source_json, dedupe_key,
       status, multi_item, created_at, expires_at, revision, notified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, 1, NULL)`,
    [
      id,
      input.userId,
      input.action,
      input.scope.type,
      input.scope.id,
      input.targetMemoryId ?? null,
      frozenRevision,
      payloadJson,
      payloadDigest,
      input.reason ?? null,
      input.origin,
      input.confidence ?? null,
      input.provenance ? JSON.stringify(input.provenance) : null,
      dedupeKey,
      createdAt,
      expiresAt,
    ],
  );

  if (changes === 0) {
    const existing = findPendingProposalByDedupeKey(input.userId, dedupeKey);
    return {
      outcome: 'duplicate',
      proposal: existing ?? undefined,
      detail: '已有同内容待确认提议',
    };
  }

  const created = getMemoryProposal(input.userId, id);
  return { outcome: 'created', proposal: created };
}

function findPendingProposalByDedupeKey(
  userId: string,
  dedupeKey: string,
): MemoryProposal | undefined {
  const row = sqliteGet<MemoryProposalRow>(
    `SELECT * FROM memory_proposals
     WHERE user_id = ? AND dedupe_key = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, dedupeKey],
  );
  return row ? rowToProposal(row) : undefined;
}

export function getMemoryProposal(userId: string, proposalId: string): MemoryProposal | undefined {
  const row = sqliteGet<MemoryProposalRow>(
    'SELECT * FROM memory_proposals WHERE id = ? AND user_id = ? LIMIT 1',
    [proposalId, userId],
  );
  return row ? rowToProposal(row) : undefined;
}

export function listMemoryProposals(
  userId: string,
  filter?: {
    status?: readonly MemoryProposalStatus[];
    scope?: MemoryScope;
    limit?: number;
    offset?: number;
  },
): MemoryProposal[] {
  const conditions: string[] = ['user_id = ?'];
  const params: Array<string | number | null> = [userId];
  if (filter?.status && filter.status.length > 0) {
    conditions.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
    params.push(...filter.status);
  }
  if (filter?.scope) {
    conditions.push('scope_type = ?', 'scope_id = ?');
    params.push(filter.scope.type, filter.scope.id);
  }
  const limit = filter?.limit ?? 100;
  const offset = filter?.offset ?? 0;
  const rows = sqliteAll<MemoryProposalRow>(
    `SELECT * FROM memory_proposals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToProposal);
}

/** 待确认提议数（用于界面上「N 条待确认」角标与通知节流）。 */
export function countPendingMemoryProposals(userId: string): number {
  const row = sqliteGet<{ count: number }>(
    "SELECT COUNT(*) AS count FROM memory_proposals WHERE user_id = ? AND status = 'pending'",
    [userId],
  );
  return row?.count ?? 0;
}

/**
 * 把到期的 pending 提议置为 expired，并**清空候选正文**以减少敏感残留。
 *
 * 保留 `reason`（审计需要），只把 `payload_json` 置为 `'{}'`。返回处理条数。
 */
export function expireStaleMemoryProposals(now: Date): number {
  const nowIso = now.toISOString();
  return sqliteRunWithChanges(
    `UPDATE memory_proposals
     SET status = 'expired', payload_json = '{}', decided_at = ?
     WHERE status = 'pending' AND expires_at <= ?`,
    [nowIso, nowIso],
  );
}

/** 标记提议已通知（渠道 / 界面），供后续节流与去重通知。 */
export function markMemoryProposalsNotified(proposalIds: readonly string[]): void {
  if (proposalIds.length === 0) {
    return;
  }
  const nowIso = new Date().toISOString();
  for (const proposalId of proposalIds) {
    sqliteRun('UPDATE memory_proposals SET notified_at = ? WHERE id = ?', [nowIso, proposalId]);
  }
}

/**
 * 找出提议 payload 在同作用域正式记忆里的重复 / 冲突关系。
 *
 * `supersedes` 只对 `merge` 动作、且有目标条目时给出——表示这条提议将覆盖该目标。
 */
export function listMemoryProposalRelations(
  userId: string,
  proposal: MemoryProposal,
): MemoryProposalRelation[] {
  const entries = listActiveMemoriesForScope(userId, proposal.scope);
  const relations: MemoryProposalRelation[] = [];
  const payloadKey = `${proposal.payload.type ?? 'fact'}:${normalizeMemoryKey(
    proposal.payload.key ?? proposal.payload.name ?? '',
  )}`;

  for (const group of detectExactDuplicateGroups(entries)) {
    if (group.normalizedKey !== payloadKey) {
      continue;
    }
    const payloadValue = normalizeMemoryKey(proposal.payload.value ?? proposal.payload.body ?? '');
    for (const entry of group.entries) {
      if (normalizeMemoryKey(entry.value) === payloadValue) {
        relations.push({
          kind: 'duplicate',
          memoryId: entry.id,
          key: entry.key,
          value: entry.value,
        });
      }
    }
  }

  for (const group of detectValueConflicts(entries)) {
    if (group.normalizedKey !== payloadKey) {
      continue;
    }
    for (const entry of group.entries) {
      relations.push({
        kind: 'conflict',
        memoryId: entry.id,
        key: entry.key,
        value: entry.value,
      });
    }
  }

  if (proposal.action === 'merge' && proposal.targetMemoryId) {
    const target = entries.find((entry) => entry.id === proposal.targetMemoryId);
    if (target) {
      relations.push({
        kind: 'supersedes',
        memoryId: target.id,
        key: target.key,
        value: target.value,
      });
    }
  }

  return relations;
}

/** 记录「保留原状 / 已拒绝」决策：同内容不再重复询问。 */
export function recordMemoryReviewDecision(input: MemoryReviewDecisionRecord): void {
  sqliteRun(
    `INSERT INTO memory_review_decisions (id, user_id, scope_type, scope_id, fingerprint, decision, decided_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, datetime('now'))
     ON CONFLICT(user_id, scope_type, scope_id, fingerprint)
     DO UPDATE SET decision = excluded.decision, created_at = excluded.created_at`,
    [
      randomUUID(),
      input.userId,
      input.scope.type,
      input.scope.id,
      input.fingerprint,
      input.decision,
    ],
  );
}

export function hasMemoryReviewDecision(
  userId: string,
  scope: MemoryScope,
  fingerprint: string,
): boolean {
  const row = sqliteGet<{ id: string }>(
    `SELECT id FROM memory_review_decisions
     WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND fingerprint = ?
     LIMIT 1`,
    [userId, scope.type, scope.id, fingerprint],
  );
  return row !== undefined;
}

/** 导出作用域键工具，避免调用方各处重复拼装。 */
export function proposalScopeKey(scope: MemoryScope): string {
  return memoryScopeKey(scope);
}

/** 提议是否过期（薄封装，便于调用方统一从此模块导入）。 */
export function isMemoryProposalExpired(proposal: MemoryProposal, now: Date): boolean {
  return isProposalExpired(proposal.expiresAt, now);
}
