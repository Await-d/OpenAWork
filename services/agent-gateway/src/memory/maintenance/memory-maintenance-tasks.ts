import type {
  MemoryEntry,
  MemoryJobKind,
  MemoryMaintenanceSummary,
  MemoryProposalPayload,
  MemoryScope,
} from '@openAwork/agent-core';
import {
  detectExactDuplicateGroups,
  detectTransientEntries,
  detectValueConflicts,
  memoryScopeKey,
} from '@openAwork/agent-core';
import { sqliteAll } from '../../infra/db.js';
import { logGatewayWarn } from '../../infra/gateway-logger.js';
import {
  getMemoryById,
  listActiveMemoriesChangedSince,
  listActiveMemoriesForScope,
} from '../memory-store.js';
import {
  claimDueMemoryJob,
  completeMemoryJob,
  createMemoryMaintenanceReport,
  createMemoryJobOwnerId,
  enqueueMemoryJob,
  failMemoryJob,
  readMemoryMaintenanceState,
  recoverExpiredMemoryJobLeases,
  renewMemoryJobLease,
  writeMemoryMaintenanceState,
  type MemoryJobLease,
} from '../governance/memory-job-store.js';
import {
  createMemoryProposal,
  expireStaleMemoryProposals,
} from '../governance/memory-proposal-store.js';

/**
 * 周期整理任务（261101-记忆确认写入与周期整理）。
 *
 * 本模块是本期「防止后期记录错乱堆叠」的核心，但边界很窄、**完全确定性**：
 *   - 不调用任何大模型、不跑工具循环；
 *   - **绝不**直接创建 / 更新 / 删除正式记忆，只产出 `MemoryProposal` 供用户裁决；
 *   - 只做三类识别：完全重复、同键不同值（新旧冲突）、疑似临时信息。
 *
 * 三类任务：
 *   - `daily_patrol`（日巡检）：清过期提议 + 重复合并提议 + 临时归档提议 + 结构异常入 note；
 *   - `weekly_semantic`（周增量）：按 `changeWatermark` 取变化条目，**无变化直接跳过**，
 *     有变化时对该 scope 全部 active 条目跑冲突检测并生成报告；
 *   - `monthly_review`（月复核）：**分页有界**扫该 scope 全部 active 条目，只产出报告。
 */

// ── 预算上限（缺省值写死，可用 env 覆盖）─────────────────────────────────
/** 单次 tick 最多处理的 job 数。 */
const DEFAULT_MAX_JOBS = 5;
/** 单 scope 单轮最多产出的提议数（超出截断并记 note）。 */
const DEFAULT_MAX_PROPOSALS_PER_SCOPE = 50;
/** 单次 tick 的总预算（毫秒），每 job 之间检查；超时优雅停止。 */
const DEFAULT_TICK_BUDGET_MS = 8_000;
/** 月复核分页批大小。 */
const MONTHLY_PAGE_SIZE = 200;
/** 月复核最多扫描批数（超出记 note「分片未完成，下轮继续」）。 */
const MONTHLY_MAX_PAGES = 10;
/** `key` 长度上限，超出计入结构异常 note。 */
const MAX_KEY_LENGTH = 200;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = globalThis.process?.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function resolveMaxJobsPerTick(): number {
  return readPositiveIntEnv('MEMORY_MAINTENANCE_MAX_JOBS', DEFAULT_MAX_JOBS);
}

export function resolveMaxProposalsPerScope(): number {
  return readPositiveIntEnv('MEMORY_MAINTENANCE_MAX_PROPOSALS', DEFAULT_MAX_PROPOSALS_PER_SCOPE);
}

export function resolveTickBudgetMs(): number {
  return readPositiveIntEnv('MEMORY_MAINTENANCE_TICK_BUDGET_MS', DEFAULT_TICK_BUDGET_MS);
}

interface MemoryScopeRow {
  scope_type: string;
  scope_id: string;
}

interface MemoryUserIdRow {
  user_id: string;
}

const VALID_SCOPE_TYPES = new Set(['user', 'workspace', 'team', 'channel_chat']);

function parseScope(scopeType: string, scopeId: string): MemoryScope | null {
  if (!VALID_SCOPE_TYPES.has(scopeType) || scopeId.length === 0) {
    return null;
  }
  return { type: scopeType as MemoryScope['type'], id: scopeId };
}

// ── 周期键（UTC 日期）──────────────────────────────────────────────────
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** UTC 日键 `YYYY-MM-DD`。 */
export function utcDayKey(now: Date): string {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

/** UTC 周键 `YYYY-Www`（ISO 周，周一为起点）。 */
export function utcWeekKey(now: Date): string {
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO：周四决定所属年份。把 target 移到本周四。
  const dayOfWeek = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayOfWeek);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${pad2(week)}`;
}

/** UTC 月键 `YYYY-MM`。 */
export function utcMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
}

/** 当期起点（UTC）：日 = 当天 00:00、周 = 本周一 00:00、月 = 当月 1 日 00:00。 */
function periodStart(kind: MemoryJobKind, now: Date): Date {
  if (kind === 'daily_patrol') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (kind === 'monthly_review') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  // weekly：回退到本周一。
  const dayOfWeek = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dayOfWeek - 1)),
  );
  return monday;
}

function periodKeyFor(kind: MemoryJobKind, now: Date): string {
  if (kind === 'daily_patrol') {
    return utcDayKey(now);
  }
  if (kind === 'weekly_semantic') {
    return utcWeekKey(now);
  }
  return utcMonthKey(now);
}

/**
 * 规划当期整理任务。
 *
 * 用户列表从 `memories` 表 distinct `user_id` 取（**不**遍历 users 表）：没有正式
 * 记忆的用户不产生任务。去重靠 `enqueueMemoryJob` 的 `(kind, scope_key, period_key)`
 * 唯一索引，同日重复调用是 no-op。返回本轮真正入队的 job 数（重复入队不算）。
 */
export function planMemoryMaintenanceJobs(input: {
  now: Date;
  userIds: readonly string[];
}): number {
  const userIds = input.userIds.length > 0 ? input.userIds : listMemoryUserIds();
  let enqueued = 0;
  for (const userId of userIds) {
    const scopes = listScopesWithMemories(userId);
    for (const scope of scopes) {
      for (const kind of ['daily_patrol', 'weekly_semantic', 'monthly_review'] as const) {
        enqueued += enqueueIfAbsent({
          userId,
          kind,
          scope,
          periodKey: periodKeyFor(kind, input.now),
          dueAt: periodStart(kind, input.now).toISOString(),
          now: input.now,
        });
      }
    }
  }
  return enqueued;
}

/** 入队并回执「是否真的新增了行」——重复入队（唯一索引冲突）返回 0。 */
function enqueueIfAbsent(input: {
  userId: string;
  kind: MemoryJobKind;
  scope: MemoryScope;
  periodKey: string;
  dueAt: string;
  now: Date;
}): number {
  const scopeKey = memoryScopeKey(input.scope);
  const before = countJobsForPeriod(input.kind, scopeKey, input.periodKey);
  enqueueMemoryJob(input);
  const after = countJobsForPeriod(input.kind, scopeKey, input.periodKey);
  return after > before ? 1 : 0;
}

function countJobsForPeriod(kind: MemoryJobKind, scopeKey: string, periodKey: string): number {
  const row = sqliteAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM memory_jobs WHERE kind = ? AND scope_key = ? AND period_key = ?',
    [kind, scopeKey, periodKey],
  );
  return row[0]?.n ?? 0;
}

/** distinct `user_id`（只统计有正式记忆的用户）。 */
function listMemoryUserIds(): string[] {
  const rows = sqliteAll<MemoryUserIdRow>('SELECT DISTINCT user_id FROM memories');
  return rows.map((row) => row.user_id);
}

/** 某用户存在正式记忆的作用域列表（distinct）。 */
function listScopesWithMemories(userId: string): MemoryScope[] {
  const rows = sqliteAll<MemoryScopeRow>(
    `SELECT DISTINCT scope_type, scope_id FROM memories
      WHERE user_id = ? AND scope_type IS NOT NULL AND scope_id IS NOT NULL`,
    [userId],
  );
  const scopes: MemoryScope[] = [];
  for (const row of rows) {
    const scope = parseScope(row.scope_type, row.scope_id);
    if (scope) {
      scopes.push(scope);
    }
  }
  return scopes;
}

// ── 摘要构造 ───────────────────────────────────────────────────────────
function emptySummary(kind: MemoryJobKind, scope: MemoryScope): MemoryMaintenanceSummary {
  return {
    kind,
    scope,
    checked: 0,
    proposalsCreated: 0,
    expiredProposals: 0,
    duplicates: 0,
    conflicts: 0,
    transient: 0,
    notes: [],
  };
}

// ── 提议生成（截断受单 scope 上限约束）─────────────────────────────────
interface ProposalBudget {
  remaining: number;
  truncated: boolean;
}

function payloadFromEntry(entry: MemoryEntry): MemoryProposalPayload {
  return {
    type: entry.type,
    key: entry.key,
    value: entry.value,
    priority: entry.priority,
    confidence: entry.confidence,
    roleLayers: entry.roleLayers,
    workspaceRoot: entry.workspaceRoot,
    teamWorkspaceId: entry.teamWorkspaceId,
  };
}

/** 生成一条提议并计数（超预算即截断，不抛错）；只有 `created` 才算新增。 */
function proposeWithinBudget(
  budget: ProposalBudget,
  input: Parameters<typeof createMemoryProposal>[0],
): boolean {
  if (budget.remaining <= 0) {
    budget.truncated = true;
    return false;
  }
  const result = createMemoryProposal(input);
  budget.remaining -= 1;
  if (result.outcome === 'created') {
    return true;
  }
  // 未真正新增：把预算还回去，避免因重复项提前截断后续真实提议。
  budget.remaining += 1;
  return false;
}

/**
 * 日巡检摘要（确定性）：① 清过期提议；② 完全重复 → merge 提议（**只提议**）；
 * ③ 疑似临时信息 → archive 提议；④ 结构异常（空 value / 超长 key）只入 notes。
 */
export function buildDailyPatrolSummary(
  userId: string,
  scope: MemoryScope,
  now: Date,
): MemoryMaintenanceSummary {
  const summary = emptySummary('daily_patrol', scope);
  summary.expiredProposals = expireStaleMemoryProposals(now);

  const entries = listActiveMemoriesForScope(userId, scope);
  summary.checked = entries.length;

  const budget: ProposalBudget = { remaining: resolveMaxProposalsPerScope(), truncated: false };

  for (const group of detectExactDuplicateGroups(entries)) {
    summary.duplicates += group.entries.length - 1;
    // 保留第一条（列表序稳定），对其余生成合并提议。
    for (let i = 1; i < group.entries.length; i += 1) {
      const entry = group.entries[i];
      if (entry === undefined) {
        continue;
      }
      const created = proposeWithinBudget(budget, {
        userId,
        action: 'merge',
        scope,
        payload: payloadFromEntry(entry),
        origin: 'maintenance',
        targetMemoryId: entry.id,
        expectedRevision: entry.revision,
        reason: '与既有记忆完全重复，建议合并',
        now,
      });
      if (created) {
        summary.proposalsCreated += 1;
      }
    }
  }

  for (const entry of detectTransientEntries(entries)) {
    summary.transient += 1;
    const created = proposeWithinBudget(budget, {
      userId,
      action: 'archive',
      scope,
      payload: payloadFromEntry(entry),
      origin: 'maintenance',
      targetMemoryId: entry.id,
      expectedRevision: entry.revision,
      reason: '疑似一次性/临时信息',
      now,
    });
    if (created) {
      summary.proposalsCreated += 1;
    }
  }

  const structural = collectStructuralAnomalies(entries);
  if (structural.length > 0) {
    summary.notes.push(...structural);
  }
  if (budget.truncated) {
    summary.notes.push(`提议数达单轮上限（${resolveMaxProposalsPerScope()}），已截断`);
  }
  return summary;
}

/** 结构异常：空 value / 超长 key。只记 note，不生成提议（避免噪音）。 */
function collectStructuralAnomalies(entries: readonly MemoryEntry[]): string[] {
  const notes: string[] = [];
  let emptyValue = 0;
  let longKey = 0;
  for (const entry of entries) {
    if (entry.value.trim().length === 0) {
      emptyValue += 1;
    }
    if (entry.key.length > MAX_KEY_LENGTH) {
      longKey += 1;
    }
  }
  if (emptyValue > 0) {
    notes.push(`${emptyValue} 条记忆 value 为空，需人工检查`);
  }
  if (longKey > 0) {
    notes.push(`${longKey} 条记忆 key 超长（> ${MAX_KEY_LENGTH}），需人工检查`);
  }
  return notes;
}

/**
 * 周增量摘要。**无变化直接跳过**（不产生提议、不写报告）。有变化时对该 scope 内
 * 全部 active 条目跑 `detectValueConflicts`，每组生成 `update` 提议并带上两边完整
 * 内容供用户裁决——**绝不**按 `updatedAt` / `confidence` 自动覆盖。
 */
export function buildIncrementalSummary(
  userId: string,
  scope: MemoryScope,
  sinceChangeSeq: number,
  now: Date,
): { summary: MemoryMaintenanceSummary; watermark: number } {
  const summary = emptySummary('weekly_semantic', scope);
  const changed = listActiveMemoriesChangedSince(userId, sinceChangeSeq);
  const maxChangeSeq = changed.reduce(
    (max, entry) => Math.max(max, entry.changeSeq),
    sinceChangeSeq,
  );

  if (changed.length === 0) {
    // 无变化：watermark 不变，summary.checked 保持 0，调用方据此跳过。
    return { summary, watermark: sinceChangeSeq };
  }

  const entries = listActiveMemoriesForScope(userId, scope);
  summary.checked = entries.length;

  const budget: ProposalBudget = { remaining: resolveMaxProposalsPerScope(), truncated: false };
  const groups = detectValueConflicts(entries);
  for (const group of groups) {
    summary.conflicts += 1;
    const distinctValues = Array.from(new Set(group.entries.map((entry) => entry.value)));
    const contentDigest = group.entries
      .map((entry) => `【${entry.key}】=${entry.value}`)
      .join(' ／ ');
    // 目标取列表第一条；不改写任何值，只把两条完整内容写进 payload/reason。
    const target = group.entries[0];
    if (target === undefined) {
      continue;
    }
    const created = proposeWithinBudget(budget, {
      userId,
      action: 'update',
      scope,
      payload: {
        ...payloadFromEntry(target),
        value: distinctValues[0] ?? target.value,
      },
      origin: 'maintenance',
      targetMemoryId: target.id,
      expectedRevision: target.revision,
      reason: `同键存在不同取值，可能是新旧冲突，请裁决：${contentDigest}`,
      now,
    });
    if (created) {
      summary.proposalsCreated += 1;
    }
  }

  const structural = collectStructuralAnomalies(entries);
  if (structural.length > 0) {
    summary.notes.push(...structural);
  }
  if (budget.truncated) {
    summary.notes.push(`提议数达单轮上限（${resolveMaxProposalsPerScope()}），已截断`);
  }
  return { summary, watermark: maxChangeSeq };
}

/**
 * 月复核摘要：分页有界扫该 scope 全部 active 条目（每批 200，至多 10 批），只做三类
 * 识别并汇总成报告；提议总数不超过上限（超出截断并记 note）。
 */
export function buildMonthlyReviewSummary(
  userId: string,
  scope: MemoryScope,
  now: Date,
): MemoryMaintenanceSummary {
  const summary = emptySummary('monthly_review', scope);
  const budget: ProposalBudget = { remaining: resolveMaxProposalsPerScope(), truncated: false };

  const collected: MemoryEntry[] = [];
  let offset = 0;
  let pages = 0;
  let pageIncomplete = false;
  for (; pages < MONTHLY_MAX_PAGES; pages += 1) {
    const page = listActiveMemoriesForScopePaged(userId, scope, MONTHLY_PAGE_SIZE, offset);
    collected.push(...page);
    if (page.length < MONTHLY_PAGE_SIZE) {
      pageIncomplete = false;
      break;
    }
    offset += MONTHLY_PAGE_SIZE;
    pageIncomplete = true;
  }

  summary.checked = collected.length;

  for (const group of detectExactDuplicateGroups(collected)) {
    summary.duplicates += group.entries.length - 1;
  }
  summary.conflicts = detectValueConflicts(collected).length;
  const transient = detectTransientEntries(collected);
  summary.transient = transient.length;

  // 月复核只产出「重复合并」与「临时归档」两类低风险提醒，冲突交由周增量处理。
  for (const group of detectExactDuplicateGroups(collected)) {
    for (let i = 1; i < group.entries.length; i += 1) {
      const entry = group.entries[i];
      if (entry === undefined) {
        continue;
      }
      const created = proposeWithinBudget(budget, {
        userId,
        action: 'merge',
        scope,
        payload: payloadFromEntry(entry),
        origin: 'maintenance',
        targetMemoryId: entry.id,
        expectedRevision: entry.revision,
        reason: '月度复核：与既有记忆完全重复，建议合并',
        now,
      });
      if (created) {
        summary.proposalsCreated += 1;
      }
    }
  }
  for (const entry of transient) {
    const created = proposeWithinBudget(budget, {
      userId,
      action: 'archive',
      scope,
      payload: payloadFromEntry(entry),
      origin: 'maintenance',
      targetMemoryId: entry.id,
      expectedRevision: entry.revision,
      reason: '月度复核：疑似一次性/临时信息',
      now,
    });
    if (created) {
      summary.proposalsCreated += 1;
    }
  }

  const structural = collectStructuralAnomalies(collected);
  if (structural.length > 0) {
    summary.notes.push(...structural);
  }
  if (pageIncomplete) {
    summary.notes.push('分片未完成，下轮继续');
  }
  if (budget.truncated) {
    summary.notes.push(`提议数达单轮上限（${resolveMaxProposalsPerScope()}），已截断`);
  }
  return summary;
}

/** 分页取某 scope 的 active 条目：先 LIMIT/OFFSET 拿当页 id，再经 point query 映射。 */
function listActiveMemoriesForScopePaged(
  userId: string,
  scope: MemoryScope,
  limit: number,
  offset: number,
): MemoryEntry[] {
  const rows = sqliteAll<{ id: string }>(
    `SELECT id FROM memories
      WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND enabled = 1 AND lifecycle = 'active'
      ORDER BY priority DESC, confidence DESC, key ASC, id ASC
      LIMIT ? OFFSET ?`,
    [userId, scope.type, scope.id, limit, offset],
  );
  const entries: MemoryEntry[] = [];
  for (const row of rows) {
    const entry = getMemoryById(userId, row.id);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

export interface MemoryMaintenanceRunInput {
  now?: Date;
  owner: string;
  maxJobs?: number;
}

export interface MemoryMaintenanceRunResult {
  claimed: number;
  completed: number;
  failed: number;
  summaries: MemoryMaintenanceSummary[];
}

/**
 * 跑一轮整理 tick。
 *
 * 流程：回收过期租约 → 循环领取到期 job → 按 kind 分派 → 处理中续租 → 成功
 * `completeMemoryJob` + 写状态 + 落报告；异常 `failMemoryJob` 并记 warn。
 * 纪律：任何单个 job 的异常都不得中断整个 tick；每 job 之间检查总预算并优雅停止；
 * 无变化的周增量不写报告、不推水位。
 */
export async function runMemoryMaintenanceTick(
  input: MemoryMaintenanceRunInput,
): Promise<MemoryMaintenanceRunResult> {
  const now = input.now ?? new Date();
  const maxJobs = input.maxJobs ?? resolveMaxJobsPerTick();
  const budgetMs = resolveTickBudgetMs();
  // 用墙钟测「本轮已耗时」，而不是 `now` 业务时间：`now` 可注入、与真实耗时不同轴。
  // 首个 job 前不检查（保证至少跑一个），之后每 job 之间检查一次。
  const startedAt = Date.now();

  recoverExpiredMemoryJobLeases(now);

  const result: MemoryMaintenanceRunResult = { claimed: 0, completed: 0, failed: 0, summaries: [] };

  for (let i = 0; i < maxJobs; i += 1) {
    if (i > 0 && Date.now() - startedAt >= budgetMs) {
      logGatewayWarn('[memory-maintenance] 单轮预算耗尽，优雅停止', { processed: i });
      break;
    }

    const lease = claimDueMemoryJob({ owner: input.owner, now });
    if (lease === null) {
      break;
    }
    result.claimed += 1;
    await processLeasedJob(lease, now, result);
  }

  return result;
}

async function processLeasedJob(
  lease: MemoryJobLease,
  now: Date,
  result: MemoryMaintenanceRunResult,
): Promise<void> {
  try {
    // 处理中续租，避免长任务在默认 5 分钟租约内被判过期。
    renewMemoryJobLease(lease, now);

    const outcome = dispatchJob(lease, now);
    if (lease.kind !== 'daily_patrol') {
      const { runMemorySemanticAnalysis } = await import('./memory-semantic-maintenance.js');
      try {
        const semantic = await runMemorySemanticAnalysis({
          userId: lease.userId, scope: lease.scope, now,
        });
        if (!semantic.skipped) {
          outcome.skip = false;
          outcome.summary ??= emptySummary(lease.kind, lease.scope);
          outcome.summary.proposalsCreated += semantic.proposed;
          outcome.summary.notes.push(semantic.note);
        }
      } catch {
        logGatewayWarn('[memory-maintenance] 语义分析失败；确定性检查结果保留，下一周期重试');
      }
    }
    if (outcome.skip) {
      // 无变化：不写报告，但任务本身算成功完成。
      completeMemoryJob(lease, now);
      result.completed += 1;
      return;
    }

    if (outcome.summary) {
      result.summaries.push(outcome.summary);
      createMemoryMaintenanceReport({
        userId: lease.userId,
        jobId: lease.jobId,
        scope: lease.scope,
        summary: outcome.summary,
        watermark: outcome.watermark ?? 0,
        now,
      });
    }
    completeMemoryJob(lease, now);
    result.completed += 1;
  } catch (error) {
    result.failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    logGatewayWarn(`[memory-maintenance] job 处理失败：${message}`, {
      jobId: lease.jobId,
      kind: lease.kind,
      scope: memoryScopeKey(lease.scope),
    });
    failMemoryJob(lease, message, now);
  }
}

interface JobOutcome {
  skip: boolean;
  summary?: MemoryMaintenanceSummary;
  watermark?: number;
}

function dispatchJob(lease: MemoryJobLease, now: Date): JobOutcome {
  switch (lease.kind) {
    case 'daily_patrol': {
      const summary = buildDailyPatrolSummary(lease.userId, lease.scope, now);
      writeMemoryMaintenanceState(lease.userId, { lastPatrolAt: now.toISOString() }, now);
      return {
        skip: false,
        summary,
        watermark: readMemoryMaintenanceState(lease.userId).changeWatermark,
      };
    }
    case 'weekly_semantic': {
      const state = readMemoryMaintenanceState(lease.userId);
      const { summary, watermark } = buildIncrementalSummary(
        lease.userId,
        lease.scope,
        state.changeWatermark,
        now,
      );
      if (summary.checked === 0) {
        // 无变化：不产生提议、不写报告、不动水位。
        return { skip: true };
      }
      writeMemoryMaintenanceState(
        lease.userId,
        { lastSemanticAt: now.toISOString(), changeWatermark: watermark },
        now,
      );
      return { skip: false, summary, watermark };
    }
    case 'monthly_review': {
      const summary = buildMonthlyReviewSummary(lease.userId, lease.scope, now);
      writeMemoryMaintenanceState(lease.userId, { lastReviewAt: now.toISOString() }, now);
      return {
        skip: false,
        summary,
        watermark: readMemoryMaintenanceState(lease.userId).changeWatermark,
      };
    }
    default: {
      // 未知 kind：不该出现（DB 约束 + 类型），保守跳过而不是抛错拖垮 tick。
      logGatewayWarn('[memory-maintenance] 未知 job kind，已跳过', { kind: lease.kind });
      return { skip: true };
    }
  }
}

/** 供测试与调度器复用的 owner id 工厂（每次调用唯一）。 */
export { createMemoryJobOwnerId };
