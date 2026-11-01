import { randomUUID } from 'node:crypto';
import type {
  CreateMemoryInput,
  MemoryEntry,
  MemoryProposal,
  MemoryProposalAction,
  MemoryProposalPayload,
  MemoryRevisionRecord,
  MemoryScope,
  UpdateMemoryInput,
} from '@openAwork/agent-core';
import { isProposalExpired, memoryProposalPayloadFingerprint } from '@openAwork/agent-core';
import { sqliteGet, sqliteRun, sqliteRunWithChanges, sqliteTransaction } from '../../infra/db.js';
import { scanMemoryWriteContent } from '../memory-security-scanner.js';
import { getMemoryRuleByName } from './memory-rule-store.js';
import { createMemory, getMemoryById, updateMemory } from '../memory-store.js';
import {
  computeMemoryProposalDigest,
  getMemoryProposal,
  recordMemoryReviewDecision,
} from './memory-proposal-store.js';

/**
 * 记忆可信提交服务（261101-记忆确认写入与周期整理）。
 *
 * 本文件是**唯一**把提议变成正式记忆的路径。所有正式写入都必须经过这里，且全部包在
 * `sqliteTransaction` 里：写条目、推版本、记 revision、消费提议要么全成要么全不成。
 *
 * 单次消费靠**条件更新**（`WHERE id = ? AND status = 'pending'`）实现，不依赖事务隔离
 * 级别，天然抵抗双击 / 双标签页 / 重放。
 */

export interface MemoryCommitResult {
  ok: boolean;
  memory?: MemoryEntry;
  error?: string;
}

/**
 * 「用户显式发起」的来源集合：确认后记为 `manual`（人写的）。
 *
 * 其余来源（`auto_extract` / `channel` / `maintenance` / `team_init`）记为
 * `auto_extracted`。`api` 属于前者——它是用户在界面或接口上的显式提交，若被标成
 * 「自动抽取」，界面标签与来源筛选都会把人的操作显示成机器积累的结果。
 */
const MANUAL_ORIGINS: ReadonlySet<string> = new Set(['manual', 'tool', 'api']);

/**
 * 覆盖载荷（界面的「修改后接受」）的最低结构校验。
 *
 * `memoryProposalPayloadSchema` 的字段**全部可选**，因此覆盖载荷可以缺 `key`，甚至整个
 * 是 `{}`。`toCreateInput` 会用 `''` 兜底，于是提交器能写出一条**空键记忆**：它以
 * `- [fact] : 内容` 进入之后每一轮提示词，并占住 `(user, scope, type, '')` 的唯一索引位。
 * 所以确认门必须自己校验「即将写入的载荷」，不能假设提议是老流程建的所以一定完整。
 *
 * 规则（刻意不把 `update` 收紧到「必须同时给 key 与 value」：更新的语义就是「只改给出的
 * 字段，其余保持原值」，要求两者齐备会误伤只改进 value 的合法用法）：
 *   - 任何**显式给出**的内容字段为空白 → 拒绝；
 *   - `create` / `merge` 会整条插入，故必须同时有 key 与 value；
 *   - `rule` 必须同时有 name 与 body。
 */
function validateEffectivePayload(
  action: MemoryProposalAction,
  payload: MemoryProposalPayload,
): string | null {
  const key = (payload.key ?? '').trim();
  const value = (payload.value ?? '').trim();
  const name = (payload.name ?? '').trim();
  const body = (payload.body ?? '').trim();

  if (payload.key !== undefined && key.length === 0) return 'key 不能为空';
  if (payload.value !== undefined && value.length === 0) return 'value 不能为空';
  if (payload.name !== undefined && name.length === 0) return 'name 不能为空';
  if (payload.body !== undefined && body.length === 0) return 'body 不能为空';

  switch (action) {
    case 'create':
    case 'merge':
      return key.length > 0 && value.length > 0 ? null : '创建记忆需要完整的 key 与 value';
    case 'rule':
      return name.length > 0 && body.length > 0 ? null : '规则需要完整的 name 与 body';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// revision 记录
// ---------------------------------------------------------------------------

interface RevisionInput {
  memoryId: string;
  userId: string;
  revision: number;
  operation: MemoryRevisionRecord['operation'];
  before: MemoryEntry | null;
  after: MemoryEntry | null;
  proposalId: string | null;
  actorKind: 'user' | 'maintenance';
  actorId: string | null;
  createdAt: string;
}

function writeMemoryRevision(input: RevisionInput): void {
  sqliteRun(
    `INSERT INTO memory_revisions (
       id, memory_id, user_id, revision, operation, before_json, after_json,
       proposal_id, actor_kind, actor_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.memoryId,
      input.userId,
      input.revision,
      input.operation,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.proposalId,
      input.actorKind,
      input.actorId,
      input.createdAt,
    ],
  );
}

// ---------------------------------------------------------------------------
// 提议 → 写入
// ---------------------------------------------------------------------------

function commitFailure(error: string): MemoryCommitResult {
  return { ok: false, error };
}

function toCreateInput(
  proposal: MemoryProposal,
  payload: MemoryProposalPayload,
  nowIso: string,
  origin: string,
): CreateMemoryInput {
  // 自动来源保留 auto_extracted，人工 / 工具来源记为 manual，避免模型把自动抽取
  // 伪装成人写。确认来源单独由 confirmationKind 表达。
  const source = MANUAL_ORIGINS.has(origin) ? 'manual' : 'auto_extracted';
  return {
    type: payload.type ?? 'fact',
    key: payload.key ?? payload.name ?? '',
    value: payload.value ?? payload.body ?? '',
    source,
    confidence: payload.confidence ?? proposal.confidence ?? 1.0,
    priority: payload.priority ?? 50,
    workspaceRoot: payload.workspaceRoot ?? null,
    teamWorkspaceId: payload.teamWorkspaceId ?? null,
    roleLayers: payload.roleLayers ?? null,
    enabled: payload.enabled !== false,
    scope: proposal.scope,
    confirmationKind: 'proposal',
    confirmedAt: nowIso,
  };
}

function toUpdateInput(payload: MemoryProposalPayload): UpdateMemoryInput {
  const input: UpdateMemoryInput = {};
  if (payload.type !== undefined) input.type = payload.type;
  if (payload.key !== undefined) input.key = payload.key;
  if (payload.value !== undefined) input.value = payload.value;
  if (payload.priority !== undefined) input.priority = payload.priority;
  if (payload.confidence !== undefined) input.confidence = payload.confidence;
  if (payload.roleLayers !== undefined) input.roleLayers = payload.roleLayers;
  if (payload.workspaceRoot !== undefined) input.workspaceRoot = payload.workspaceRoot;
  if (payload.teamWorkspaceId !== undefined) input.teamWorkspaceId = payload.teamWorkspaceId;
  if (payload.enabled !== undefined) input.enabled = payload.enabled;
  return input;
}

/**
 * 确认并提交一条提议。唯一的提议消费路径。
 */
export function commitMemoryProposal(input: {
  userId: string;
  proposalId: string;
  decidedBy: string;
  note?: string | null;
  overridePayload?: MemoryProposalPayload | null;
  expectedRevision?: number | null;
  now?: Date;
}): MemoryCommitResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  return sqliteTransaction(() => {
    const proposal = getMemoryProposal(input.userId, input.proposalId);
    if (!proposal) {
      return commitFailure('提议不存在或已处理');
    }
    if (proposal.status !== 'pending') {
      return commitFailure('提议不存在或已处理');
    }

    if (isProposalExpired(proposal.expiresAt, now)) {
      sqliteRunWithChanges(
        `UPDATE memory_proposals
         SET status = 'expired', payload_json = '{}', decided_at = ?
         WHERE id = ? AND status = 'pending'`,
        [nowIso, input.proposalId],
      );
      return commitFailure('提议已过期，需重新确认');
    }

    const activePayload = input.overridePayload ?? proposal.payload;
    if (proposal.action === 'rule') {
      return commitRuleProposal(input, proposal, activePayload, nowIso);
    }

    // 先校验「即将写入的载荷」再消费提议：覆盖载荷来自请求体，字段全可选，缺 key 会被
    // `toCreateInput` 兜底成空串并写出空键记忆。校验不过时**保持 pending**，用户改完可以
    // 直接重试，不必重新发起提议。
    const payloadProblem = validateEffectivePayload(proposal.action, activePayload);
    if (payloadProblem !== null) {
      return commitFailure(payloadProblem);
    }

    // 「修改后保存」：用户改的是新内容，必须重算 digest 并落回，确认的才是新内容。
    if (input.overridePayload) {
      const digest = computeMemoryProposalDigest(input.overridePayload);
      sqliteRunWithChanges(
        `UPDATE memory_proposals
         SET payload_json = ?, payload_digest = ?, revision = revision + 1
         WHERE id = ? AND status = 'pending'`,
        [JSON.stringify(input.overridePayload), digest, input.proposalId],
      );
    } else if (computeMemoryProposalDigest(proposal.payload) !== proposal.payloadDigest) {
      // 载荷摘要与落库值不一致 = 内容被篡改，拒绝消费。
      return commitFailure('提议内容摘要校验失败');
    }

    const scanKey = scanMemoryWriteContent(activePayload.key ?? activePayload.name ?? '');
    const scanValue = scanMemoryWriteContent(activePayload.value ?? activePayload.body ?? '');
    if (!scanKey.ok || !scanValue.ok) {
      // 安全扫描不过：**保持 pending**，不消费提议，用户可修改后重试。
      return commitFailure(scanKey.reason ?? scanValue.reason ?? '内容安全扫描未通过');
    }

    const targetId = proposal.targetMemoryId;
    const target = targetId ? getMemoryById(input.userId, targetId) : undefined;

    // 并发 / 冲突检测：目标条目的当前版本必须与提议期望版本一致。
    const expected = input.expectedRevision ?? proposal.expectedRevision ?? null;
    if (targetId) {
      if (!target) {
        return commitFailure('目标记忆不存在');
      }
      if (expected !== null && target.revision !== expected) {
        return commitFailure('目标记忆已被修改，内容冲突');
      }
    }

    const beforeSnapshot = target ?? null;
    let memory: MemoryEntry | undefined;
    let operation: MemoryRevisionRecord['operation'] = 'create';
    let extraNote: string | null = null;

    switch (proposal.action) {
      case 'create': {
        memory = createMemory(
          input.userId,
          toCreateInput(proposal, activePayload, nowIso, proposal.origin),
        );
        operation = 'create';
        break;
      }
      case 'update': {
        if (!target) {
          return commitFailure('目标记忆不存在');
        }
        operation = 'update';
        memory = updateMemory(input.userId, target.id, {
          ...toUpdateInput(activePayload),
          confirmationKind: 'proposal',
          confirmedAt: nowIso,
        });
        break;
      }
      case 'archive': {
        if (!target) {
          return commitFailure('目标记忆不存在');
        }
        operation = 'archive';
        memory = updateMemory(input.userId, target.id, {
          enabled: false,
          lifecycle: 'archived',
          confirmationKind: 'proposal',
          confirmedAt: nowIso,
        });
        break;
      }
      case 'restore': {
        if (!target) {
          return commitFailure('目标记忆不存在');
        }
        operation = 'restore';
        memory = updateMemory(input.userId, target.id, {
          enabled: true,
          lifecycle: 'active',
          supersededBy: null,
          confirmationKind: 'proposal',
          confirmedAt: nowIso,
        });
        break;
      }
      case 'merge': {
        if (!target) {
          return commitFailure('目标记忆不存在');
        }
        operation = 'update';
        memory = updateMemory(input.userId, target.id, {
          value: activePayload.value ?? activePayload.body ?? target.value,
          confirmationKind: 'proposal',
          confirmedAt: nowIso,
        });
        // 被合并进来的源条目 id 无法从 payload 可靠推断，只更新目标并在决策备注里记录。
        extraNote = '合并：仅覆盖目标正文，源条目未自动归档';
        break;
      }
      default: {
        return commitFailure('不支持的提议动作');
      }
    }

    if (!memory) {
      return commitFailure('写入失败');
    }

    if (operation !== 'create') {
      writeMemoryRevision({
        memoryId: memory.id,
        userId: input.userId,
        revision: memory.revision,
        operation,
        before: beforeSnapshot,
        after: memory,
        proposalId: input.proposalId,
        actorKind: 'user',
        actorId: input.decidedBy,
        createdAt: nowIso,
      });
    } else {
      writeMemoryRevision({
        memoryId: memory.id,
        userId: input.userId,
        revision: memory.revision,
        operation: 'create',
        before: null,
        after: memory,
        proposalId: input.proposalId,
        actorKind: 'user',
        actorId: input.decidedBy,
        createdAt: nowIso,
      });
    }

    const note = extraNote ?? input.note ?? null;
    const consumed = sqliteRunWithChanges(
      `UPDATE memory_proposals
       SET status = 'applied', decided_at = ?, decided_by = ?, decision_note = ?, result_memory_id = ?
       WHERE id = ? AND status = 'pending'`,
      [nowIso, input.decidedBy, note, memory.id, input.proposalId],
    );
    if (consumed === 0) {
      // 条件更新失败 = 提议已被另一路径消费（双击 / 双标签页），回滚本次写入。
      return commitFailure('提议已被处理');
    }

    return { ok: true, memory };
  });
}

function commitRuleProposal(
  input: {
    userId: string;
    proposalId: string;
    decidedBy: string;
    note?: string | null;
    overridePayload?: MemoryProposalPayload | null;
    expectedRevision?: number | null;
  },
  proposal: MemoryProposal,
  payload: MemoryProposalPayload,
  nowIso: string,
): MemoryCommitResult {
  if (computeMemoryProposalDigest(proposal.payload) !== proposal.payloadDigest) {
    return commitFailure('提议内容摘要校验失败');
  }
  const problem = validateEffectivePayload('rule', payload);
  if (problem) return commitFailure(problem);
  if (payload.name !== proposal.payload.name) {
    return commitFailure('规则名称冲突，请重新提交提议');
  }
  const current = getMemoryRuleByName(input.userId, proposal.scope, payload.name ?? '');
  const baseline = proposal.payload.ruleRevision;
  if (
    baseline === undefined ||
    (current?.revision ?? 0) !== baseline ||
    current?.id !== proposal.payload.ruleId ||
    (input.expectedRevision != null && input.expectedRevision !== baseline)
  ) {
    return commitFailure('规则版本冲突，请重新提交提议');
  }
  const scanName = scanMemoryWriteContent(payload.name ?? '');
  const scanBody = scanMemoryWriteContent(payload.body ?? '');
  if (!scanName.ok || !scanBody.ok) {
    return commitFailure(scanName.reason ?? scanBody.reason ?? '内容安全扫描未通过');
  }
  const effectivePayload = {
    ...payload,
    ruleId: proposal.payload.ruleId,
    ruleRevision: baseline,
  };
  const consumed = sqliteRunWithChanges(
    `UPDATE memory_proposals
     SET status = 'applied', decided_at = ?, decided_by = ?, decision_note = ?,
         payload_json = ?, payload_digest = ?, revision = revision + ?
     WHERE id = ? AND user_id = ? AND status = 'pending'`,
    [
      nowIso,
      input.decidedBy,
      input.note ?? null,
      JSON.stringify(effectivePayload),
      computeMemoryProposalDigest(effectivePayload),
      input.overridePayload ? 1 : 0,
      input.proposalId,
      input.userId,
    ],
  );
  if (consumed === 0) return commitFailure('提议已被处理');
  const memory = commitMemoryRule(input.userId, proposal.scope, effectivePayload, nowIso);
  if (!memory) throw new TypeError('规则写入参数无效');
  writeMemoryRevision({
    memoryId: memory.id,
    userId: input.userId,
    revision: memory.revision,
    operation: current?.enabled ? 'update' : 'create',
    before: current
      ? {
          ...memory,
          value: current.body,
          revision: current.revision,
          enabled: current.enabled,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
          confirmedAt: current.confirmedAt,
        }
      : null,
    after: memory,
    proposalId: input.proposalId,
    actorKind: 'user',
    actorId: input.decidedBy,
    createdAt: nowIso,
  });
  sqliteRun('UPDATE memory_proposals SET result_memory_id = ? WHERE id = ?', [
    memory.id,
    input.proposalId,
  ]);
  return { ok: true, memory };
}

/**
 * `rule` 动作落 `memory_rule_entries`。
 *
 * 规则成熟度不足时不硬塞成普通记忆：以 (user, scope, name) 为键 upsert，重复确认同名规则
 * 时推进 revision 而不是插新行。返回一个合成 MemoryEntry 供 revision 记录引用。
 */
function commitMemoryRule(
  userId: string,
  scope: MemoryScope,
  payload: MemoryProposalPayload,
  nowIso: string,
): MemoryEntry | undefined {
  const name = (payload.name ?? payload.key ?? '').trim();
  const body = (payload.body ?? payload.value ?? '').trim();
  if (name.length === 0 || body.length === 0) {
    return undefined;
  }

  const existing = sqliteGet<{ id: string; revision: number }>(
    `SELECT id, revision FROM memory_rule_entries
     WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND name = ? AND enabled = 1
     LIMIT 1`,
    [userId, scope.type, scope.id, name],
  );

  let ruleId: string;
  if (existing) {
    sqliteRun(
      `UPDATE memory_rule_entries
       SET body = ?, revision = revision + 1, confirmed_at = ?, updated_at = ?
       WHERE id = ?`,
      [body, nowIso, nowIso, existing.id],
    );
    ruleId = existing.id;
  } else {
    ruleId = randomUUID();
    sqliteRun(
      `INSERT INTO memory_rule_entries (
         id, user_id, scope_type, scope_id, name, body, revision, enabled, confirmed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [ruleId, userId, scope.type, scope.id, name, body, nowIso, nowIso, nowIso],
    );
  }

  // 合成条目：规则不是 `memories` 行，但 revision 表需要一个可读的快照。
  return {
    id: ruleId,
    userId,
    type: 'instruction',
    key: name,
    value: body,
    source: 'manual',
    confidence: 1.0,
    priority: 50,
    workspaceRoot: null,
    teamWorkspaceId: scope.type === 'team' ? scope.id : null,
    roleLayers: null,
    enabled: true,
    scope,
    lifecycle: 'active',
    revision: existing ? existing.revision + 1 : 1,
    confirmationKind: 'proposal',
    confirmedAt: nowIso,
    changeSeq: 0,
    validUntil: null,
    supersededBy: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * 拒绝一条提议。`keepOriginal` 为真时记录「保留原状」，否则记录「已拒绝」——两者都
 * 让同内容不再重复询问。
 */
export function rejectMemoryProposal(input: {
  userId: string;
  proposalId: string;
  decidedBy: string;
  note?: string | null;
  keepOriginal?: boolean;
  now?: Date;
}): { ok: boolean; error?: string } {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return sqliteTransaction(() => {
    const proposal = getMemoryProposal(input.userId, input.proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return { ok: false, error: '提议不存在或已处理' };
    }
    const changes = sqliteRunWithChanges(
      `UPDATE memory_proposals
       SET status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ?
       WHERE id = ? AND status = 'pending'`,
      [nowIso, input.decidedBy, input.note ?? null, input.proposalId],
    );
    if (changes === 0) {
      return { ok: false, error: '提议已被处理' };
    }
    recordMemoryReviewDecision({
      userId: input.userId,
      scope: proposal.scope,
      fingerprint: memoryProposalPayloadFingerprint(proposal.payload),
      decision: input.keepOriginal ? 'kept' : 'rejected',
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 人工显式变更
// ---------------------------------------------------------------------------

/**
 * 用户在设置页点保存 / 删除的**人工显式路径**。
 *
 * 用户动作本身即确认，故跳过提议流程；但仍必须过安全扫描、写 revision、标记
 * `confirmation_kind='manual'`、推进 revision，并遵守 `expectedRevision` 乐观并发。
 */
export function applyManualMemoryChange(input: {
  userId: string;
  actorId: string;
  action: 'create' | 'update' | 'delete';
  memoryId?: string;
  payload?: CreateMemoryInput | UpdateMemoryInput;
  expectedRevision?: number | null;
  now?: Date;
}): MemoryCommitResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return sqliteTransaction(() => {
    if (input.action === 'create') {
      const payload = input.payload as CreateMemoryInput | undefined;
      if (!payload) {
        return commitFailure('缺少创建参数');
      }
      const scanKey = scanMemoryWriteContent(payload.key);
      const scanValue = scanMemoryWriteContent(payload.value);
      if (!scanKey.ok || !scanValue.ok) {
        return commitFailure(scanKey.reason ?? scanValue.reason ?? '内容安全扫描未通过');
      }
      const memory = createMemory(input.userId, {
        ...payload,
        // 只在调用方**没有指定来源**时才回落 `manual`。
        //
        // 原先这里无条件写死 `manual`，导致调用方指定的来源被静默吞掉——团队工作区知识路由
        // 依赖 `source`（图谱界面按它做「自动/抽取」来源筛选与语义词检索），被改写后要么
        // 破坏既有契约、要么逼该路由绕开提交器直写（丢掉审计与回滚历史）。人工写入的「人工
        // 属性」由 `confirmationKind: 'manual'` 独立记录，不需要靠篡改 `source` 来表达。
        source: payload.source ?? 'manual',
        confirmationKind: 'manual',
        confirmedAt: nowIso,
      });
      writeMemoryRevision({
        memoryId: memory.id,
        userId: input.userId,
        revision: memory.revision,
        operation: 'create',
        before: null,
        after: memory,
        proposalId: null,
        actorKind: 'user',
        actorId: input.actorId,
        createdAt: nowIso,
      });
      return { ok: true, memory };
    }

    if (!input.memoryId) {
      return commitFailure('缺少记忆 id');
    }
    const before = getMemoryById(input.userId, input.memoryId);
    if (!before) {
      return commitFailure('记忆不存在');
    }
    const expected = input.expectedRevision ?? null;
    if (expected !== null && before.revision !== expected) {
      return commitFailure('记忆已被修改，请刷新后重试');
    }

    if (input.action === 'delete') {
      const memory = updateMemory(input.userId, input.memoryId, {
        enabled: false,
        lifecycle: 'archived',
        confirmationKind: 'manual',
        confirmedAt: nowIso,
      });
      if (!memory) {
        return commitFailure('删除失败');
      }
      writeMemoryRevision({
        memoryId: memory.id,
        userId: input.userId,
        revision: memory.revision,
        operation: 'archive',
        before,
        after: memory,
        proposalId: null,
        actorKind: 'user',
        actorId: input.actorId,
        createdAt: nowIso,
      });
      return { ok: true, memory };
    }

    const payload = (input.payload ?? {}) as UpdateMemoryInput;
    const nextKey = payload.key ?? before.key;
    const nextValue = payload.value ?? before.value;
    const scanKey = scanMemoryWriteContent(nextKey);
    const scanValue = scanMemoryWriteContent(nextValue);
    if (!scanKey.ok || !scanValue.ok) {
      return commitFailure(scanKey.reason ?? scanValue.reason ?? '内容安全扫描未通过');
    }
    const memory = updateMemory(input.userId, input.memoryId, {
      ...payload,
      confirmationKind: 'manual',
      confirmedAt: nowIso,
    });
    if (!memory) {
      return commitFailure('更新失败');
    }
    writeMemoryRevision({
      memoryId: memory.id,
      userId: input.userId,
      revision: memory.revision,
      operation: 'update',
      before,
      after: memory,
      proposalId: null,
      actorKind: 'user',
      actorId: input.actorId,
      createdAt: nowIso,
    });
    return { ok: true, memory };
  });
}

// ---------------------------------------------------------------------------
// 回滚
// ---------------------------------------------------------------------------

interface RevisionRow {
  id: string;
  memory_id: string;
  user_id: string;
  revision: number;
  operation: string;
  before_json: string | null;
  after_json: string | null;
  proposal_id: string | null;
  actor_kind: string;
  actor_id: string | null;
  created_at: string;
}

function parseSnapshot(json: string | null): MemoryEntry | null {
  if (!json) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as MemoryEntry) : null;
  } catch {
    return null;
  }
}

/**
 * 把某条历史 revision 的 `before` 状态恢复为当前状态——**作为一次新变更**。
 *
 * 不删历史、不回退 revision 号，而是按恢复后的内容写一条新 revision。目标条目若已被
 * 后续修改（`before.revision` 与当前不符）则报冲突，绝不静默覆盖别人的改动。
 */
export function rollbackMemoryRevision(input: {
  userId: string;
  actorId: string;
  revisionId: string;
  now?: Date;
}): MemoryCommitResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return sqliteTransaction(() => {
    const row = sqliteGet<RevisionRow>(
      'SELECT * FROM memory_revisions WHERE id = ? AND user_id = ? LIMIT 1',
      [input.revisionId, input.userId],
    );
    if (!row) {
      return commitFailure('历史版本不存在');
    }
    const before = parseSnapshot(row.before_json);
    const current = getMemoryById(input.userId, row.memory_id);
    if (!current) {
      return commitFailure('目标记忆不存在或已删除');
    }

    // 「无后续修改」的判据是：该 revision 行必须是这条记忆**最新的**一行。若它后面还有
    // 别的 revision，说明当前状态已不是该行 `after` 对应的状态，回滚会静默覆盖他人改动。
    const latest = sqliteGet<{ revision: number }>(
      'SELECT revision FROM memory_revisions WHERE memory_id = ? ORDER BY revision DESC LIMIT 1',
      [row.memory_id],
    );
    if (latest && latest.revision !== row.revision) {
      return commitFailure('目标记忆已被后续修改，无法直接回滚');
    }

    let memory: MemoryEntry | undefined;
    let operation: MemoryRevisionRecord['operation'];
    if (!before) {
      // 原操作是创建 → 回滚等价于归档。
      operation = 'archive';
      memory = updateMemory(input.userId, current.id, {
        enabled: false,
        lifecycle: 'archived',
        confirmationKind: 'manual',
        confirmedAt: nowIso,
      });
    } else {
      operation = 'restore';
      memory = updateMemory(input.userId, current.id, {
        type: before.type,
        key: before.key,
        value: before.value,
        confidence: before.confidence,
        priority: before.priority,
        roleLayers: before.roleLayers,
        enabled: before.enabled,
        lifecycle: before.lifecycle,
        scope: before.scope,
        supersededBy: before.supersededBy,
        confirmationKind: 'manual',
        confirmedAt: nowIso,
      });
    }
    if (!memory) {
      return commitFailure('回滚写入失败');
    }
    writeMemoryRevision({
      memoryId: memory.id,
      userId: input.userId,
      revision: memory.revision,
      operation,
      before: current,
      after: memory,
      proposalId: null,
      actorKind: 'user',
      actorId: input.actorId,
      createdAt: nowIso,
    });
    return { ok: true, memory };
  });
}
