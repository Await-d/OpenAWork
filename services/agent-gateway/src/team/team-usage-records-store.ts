/**
 * team-usage-records-store · 团队执行用量 / 工具调用持久化
 *
 * 背景：`stream-team-events.ts` 只把 usage / tool_call / timing 作为实时 WS 事件
 * 推给前端 `useTeamUsageStore`，**不落库**。结果是刷新页面、重连、或事件在用户
 * 打开「度量」tab 之前就发完了 → 统计全部归零。这是"每次使用都没正确统计"的
 * 第二个根因。
 *
 * 本 store 把每轮 LLM 调用的 usage（token / 费用 / 调用次数）以及工具调用次数，
 * 按 (user, session, layer, provider, model) 聚合累加进 `team_usage_records`，
 * 让 `GET /team/runtime` 能回灌历史用量，前端不再只依赖实时事件窗口。
 */

import { sqliteAll, sqliteRun, sqliteRunWithChanges } from '../infra/db.js';
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../infra/sqlite-batch.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import { normalizeTokenCount } from '@openAwork/agent-core';

/**
 * team_usage_records 的按用户有界裁剪。回合键（client_request_id）进入聚合唯一键后，
 * 同一 (session, layer, provider, model) 的不同回合各占一行，写入粒度比旧 5 列键细
 * 一个数量级：一个完整团队回合（reception/pm1/pm2/executor/reviewer）可新增约 10–20 行。
 * 因此默认上限取 20000（约 1000 个完整回合的度量历史；审计表的 2000 行按治理事件
 * 计数、粒度更粗，不能直接套用）。env `OPENAWORK_TEAM_USAGE_MAX_ROWS_PER_USER`
 * 可覆盖；非正数 / NaN 关闭裁剪。
 *
 * 裁剪与 `team-audit-store.ts` 同一摊销惯用法：每累计
 * `TEAM_USAGE_PRUNE_CHECK_INTERVAL` 次写入触发一次，最多过冲一个检查间隔；
 * 排序用自增主键 `id`（`updated_at` 只有秒级精度，同秒并列无法稳定区分「最新 N 行」）。
 * 保留最新 N 行意味着刚写入的行必然存活（其 id 是该用户当前最大值）；
 * 裁剪失败只告警，绝不阻断写入。
 */
const DEFAULT_TEAM_USAGE_MAX_ROWS_PER_USER = 20000;
export const TEAM_USAGE_PRUNE_CHECK_INTERVAL = 50;

let usageRetentionOverride: number | null = null;
let usagePruneCheckInterval = TEAM_USAGE_PRUNE_CHECK_INTERVAL;
const usageInsertsSincePruneByUser = new Map<string, number>();
let usageStoreDisabled = false;

function resolveUsageRetention(): number {
  if (usageRetentionOverride !== null) {
    return usageRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_TEAM_USAGE_MAX_ROWS_PER_USER'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_TEAM_USAGE_MAX_ROWS_PER_USER;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneTeamUsageRecords(userId: string, limit: number): void {
  sqliteRun(
    `DELETE FROM team_usage_records
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM team_usage_records
           WHERE user_id = ?
           ORDER BY id DESC
           LIMIT ?
        )`,
    [userId, userId, limit],
  );
}

function maybePruneTeamUsageRecords(userId: string): void {
  if (usageStoreDisabled) {
    return;
  }
  const limit = resolveUsageRetention();
  if (limit <= 0) {
    usageInsertsSincePruneByUser.delete(userId);
    return;
  }
  const pending = (usageInsertsSincePruneByUser.get(userId) ?? 0) + 1;
  if (pending < usagePruneCheckInterval) {
    usageInsertsSincePruneByUser.set(userId, pending);
    return;
  }
  usageInsertsSincePruneByUser.set(userId, 0);
  try {
    pruneTeamUsageRecords(userId, limit);
  } catch (error) {
    if (isSqliteMalformedError(error)) {
      usageStoreDisabled = true;
      return;
    }
    console.warn(
      `[team-usage-records-store] 裁剪 team_usage_records 失败（user=${userId}）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** 测试用：覆盖每用户保留上限与检查间隔（limit 传 null 恢复 env / 默认值）。 */
export function __setTeamUsageRetentionForTesting(
  limit: number | null,
  checkInterval?: number,
): void {
  usageRetentionOverride = limit;
  usagePruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : TEAM_USAGE_PRUNE_CHECK_INTERVAL;
  usageInsertsSincePruneByUser.clear();
  usageStoreDisabled = false;
}

/** 测试用：清空摊销计数状态。 */
export function __resetTeamUsagePruneStateForTesting(): void {
  usageInsertsSincePruneByUser.clear();
}

export interface TeamUsagePersistInput {
  userId: string;
  sessionId: string;
  layer?: string | null;
  agentId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  /** 归属的聊天回合键；缺失时归一到 ''（聚合键的一部分，见 normalizeKey）。 */
  clientRequestId?: string | null;
}

export interface TeamToolCallPersistInput {
  userId: string;
  sessionId: string;
  layer?: string | null;
  agentId?: string | null;
  toolName: string;
  durationMs?: number;
  success: boolean;
  errorType?: string | null;
  /** 归属的聊天回合键；缺失时落 NULL = "不可归因的历史"。 */
  clientRequestId?: string | null;
}

export interface TeamUsageRecordRow {
  sessionId: string;
  layer: string | null;
  agentId: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  callCount: number;
  totalDurationMs: number;
  toolCallCount: number;
  toolErrorCount: number;
  updatedAt: string;
}

interface UsageRowRaw {
  session_id: string;
  layer: string | null;
  agent_id: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  call_count: number;
  total_duration_ms: number;
  tool_call_count: number;
  tool_error_count: number;
  updated_at: string;
}

export interface TeamToolCallRecordRow {
  sessionId: string;
  layer: string | null;
  agentId: string | null;
  toolName: string;
  invocations: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  durations: number[];
  errorSamples: Array<{ errorType: string; count: number }>;
}

interface ToolCallRowRaw {
  agent_id: string | null;
  created_at: string;
  duration_ms: number;
  error_type: string | null;
  id: number | string;
  layer: string | null;
  session_id: string;
  success: number;
  tool_name: string;
}

function listRowsBySessionIds<T>(input: {
  query: (placeholders: string) => string;
  sessionIds: string[];
  userId: string;
}): T[] {
  if (input.sessionIds.length === 0) {
    return [];
  }

  return chunkSqliteBindValues(input.sessionIds, 1).flatMap((batchSessionIds) =>
    sqliteAll<T>(input.query(buildSqlitePlaceholders(batchSessionIds.length, ', ')), [
      input.userId,
      ...batchSessionIds,
    ]),
  );
}

function compareSqliteIds(left: number | string, right: number | string): number {
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = typeof right === 'number' ? right : Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right));
}

// SQLite 的 UNIQUE 约束里 NULL 不等于 NULL，会导致同一 (session, provider, model)
// 但 layer 为 null 的多行无法去重。统一把缺失维度归一到空串 '' 作为聚合键。
function normalizeKey(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '';
}

/**
 * 累加一轮 LLM 调用的 usage 到 team_usage_records（按聚合键 upsert）。
 * 全 0 token 的轮次跳过，避免写入空记录。
 */
export function persistTeamUsageRecord(input: TeamUsagePersistInput): void {
  const inputTokens = normalizeTokenCount(input.inputTokens);
  const outputTokens = normalizeTokenCount(input.outputTokens);
  const reasoningTokens = normalizeTokenCount(input.reasoningTokens);
  const cacheReadTokens = normalizeTokenCount(input.cacheReadTokens);
  const cacheWriteTokens = normalizeTokenCount(input.cacheWriteTokens);
  const costUsd =
    Number.isFinite(input.costUsd) && (input.costUsd ?? 0) >= 0 ? (input.costUsd ?? 0) : 0;

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheWriteTokens === 0 &&
    costUsd === 0
  ) {
    return;
  }

  const layer = normalizeKey(input.layer);
  const provider = normalizeKey(input.provider);
  const model = normalizeKey(input.model);
  const clientRequestId = normalizeKey(input.clientRequestId);
  const agentId = input.agentId ?? null;

  sqliteRun(
    `INSERT INTO team_usage_records (
       user_id, session_id, layer, agent_id, provider, model, client_request_id,
       input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
       cost_usd, call_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(user_id, session_id, layer, provider, model, client_request_id) DO UPDATE SET
       agent_id = COALESCE(excluded.agent_id, team_usage_records.agent_id),
       input_tokens = team_usage_records.input_tokens + excluded.input_tokens,
       output_tokens = team_usage_records.output_tokens + excluded.output_tokens,
       reasoning_tokens = team_usage_records.reasoning_tokens + excluded.reasoning_tokens,
       cache_read_tokens = team_usage_records.cache_read_tokens + excluded.cache_read_tokens,
       cache_write_tokens = team_usage_records.cache_write_tokens + excluded.cache_write_tokens,
       cost_usd = team_usage_records.cost_usd + excluded.cost_usd,
       call_count = team_usage_records.call_count + 1,
       updated_at = datetime('now')`,
    [
      input.userId,
      input.sessionId,
      layer,
      agentId,
      provider,
      model,
      clientRequestId,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
    ],
  );
  maybePruneTeamUsageRecords(input.userId);
}

/**
 * 累加一轮 LLM 调用的耗时到 team_usage_records（不增加 call_count，
 * 避免与 persistTeamUsageRecord 对同一轮重复计数 LLM 调用次数）。
 * timing 事件与 usage 事件成对触发，调用次数只由 usage 端 +1。
 */
export function persistTeamTimingRecord(input: {
  userId: string;
  sessionId: string;
  layer?: string | null;
  provider?: string | null;
  model?: string | null;
  durationMs: number;
  /** 归属的聊天回合键；缺失时归一到 ''（聚合键的一部分，见 normalizeKey）。 */
  clientRequestId?: string | null;
}): void {
  const durationMs = Math.max(0, Math.trunc(input.durationMs));
  if (durationMs === 0) {
    return;
  }
  const layer = normalizeKey(input.layer);
  const provider = normalizeKey(input.provider);
  const model = normalizeKey(input.model);
  const clientRequestId = normalizeKey(input.clientRequestId);

  sqliteRun(
    `INSERT INTO team_usage_records (
       user_id, session_id, layer, provider, model, client_request_id,
       total_duration_ms, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, session_id, layer, provider, model, client_request_id) DO UPDATE SET
       total_duration_ms = team_usage_records.total_duration_ms + excluded.total_duration_ms,
       updated_at = datetime('now')`,
    [input.userId, input.sessionId, layer, provider, model, clientRequestId, durationMs],
  );
  maybePruneTeamUsageRecords(input.userId);
}

/**
 * 累加一次工具调用计数到 team_usage_records（按聚合键 upsert）。
 * 工具调用没有 token，单独累加 tool_call_count / tool_error_count，
 * 复用同一聚合行（layer/provider/model 维度）。
 */
export function persistTeamToolCallRecord(input: TeamToolCallPersistInput): void {
  const layer = normalizeKey(input.layer);
  const clientRequestId = normalizeKey(input.clientRequestId);
  const errorDelta = input.success ? 0 : 1;
  const toolName = input.toolName.trim();
  if (toolName.length === 0) {
    return;
  }
  const durationMs = Math.max(0, Math.trunc(input.durationMs ?? 0));
  const errorType =
    input.errorType && input.errorType.trim().length > 0 ? input.errorType.trim() : null;

  sqliteRun(
    `INSERT INTO team_usage_records (
       user_id, session_id, layer, provider, model, client_request_id,
       tool_call_count, tool_error_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
     ON CONFLICT(user_id, session_id, layer, provider, model, client_request_id) DO UPDATE SET
       tool_call_count = team_usage_records.tool_call_count + 1,
       tool_error_count = team_usage_records.tool_error_count + excluded.tool_error_count,
       updated_at = datetime('now')`,
    [input.userId, input.sessionId, layer, '', '', clientRequestId, errorDelta],
  );
  sqliteRun(
    `INSERT INTO team_tool_call_records (
       user_id, session_id, layer, agent_id, tool_name, duration_ms, success, error_type,
       client_request_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.sessionId,
      layer,
      input.agentId ?? null,
      toolName,
      durationMs,
      input.success ? 1 : 0,
      errorType,
      input.clientRequestId ?? null,
    ],
  );
  maybePruneTeamUsageRecords(input.userId);
}

/**
 * 按回合删除该回合的用量聚合行。无匹配行时返回 0。
 * 注意：存量迁移行与未携带回合键的写入不会匹配，回退不会误删它们。
 */
export function deleteTeamUsageRecordsByClientRequest(input: {
  userId: string;
  sessionIds: readonly string[];
  clientRequestIds: readonly string[];
}): number {
  if (input.sessionIds.length === 0 || input.clientRequestIds.length === 0) {
    return 0;
  }
  return sqliteRunWithChanges(
    `DELETE FROM team_usage_records
      WHERE user_id = ?
        AND session_id IN (${buildSqlitePlaceholders(input.sessionIds.length)})
        AND client_request_id IN (${buildSqlitePlaceholders(input.clientRequestIds.length)})`,
    [input.userId, ...input.sessionIds, ...input.clientRequestIds],
  );
}

/**
 * 按回合删除该回合的工具调用明细行：会话集合 × 回合键集合按笛卡尔积一次删除，
 * 等价于逐 (会话, 回合) 对调用；同时按 user_id 收口。空集合删除 0 行。
 * 返回删除总行数。
 */
export function deleteTeamToolCallRecordsByClientRequest(input: {
  userId: string;
  sessionIds: readonly string[];
  clientRequestIds: readonly string[];
}): number {
  if (input.sessionIds.length === 0 || input.clientRequestIds.length === 0) {
    return 0;
  }
  return sqliteRunWithChanges(
    `DELETE FROM team_tool_call_records
      WHERE user_id = ?
        AND session_id IN (${buildSqlitePlaceholders(input.sessionIds.length)})
        AND client_request_id IN (${buildSqlitePlaceholders(input.clientRequestIds.length)})`,
    [input.userId, ...input.sessionIds, ...input.clientRequestIds],
  );
}

/** 读取一组 session 的持久化用量聚合行（供 GET /team/runtime 回灌前端）。 */
export function listTeamUsageRecords(input: {
  userId: string;
  sessionIds: string[];
}): TeamUsageRecordRow[] {
  const rows = listRowsBySessionIds<UsageRowRaw>({
    query: (placeholders) => `SELECT session_id, layer, agent_id, provider, model,
            input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
            cost_usd, call_count, total_duration_ms, tool_call_count, tool_error_count, updated_at
       FROM team_usage_records
      WHERE user_id = ? AND session_id IN (${placeholders})`,
    sessionIds: input.sessionIds,
    userId: input.userId,
  });
  return rows.map((row) => ({
    sessionId: row.session_id,
    layer: row.layer && row.layer.length > 0 ? row.layer : null,
    agentId: row.agent_id,
    provider: row.provider && row.provider.length > 0 ? row.provider : null,
    model: row.model && row.model.length > 0 ? row.model : null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    costUsd: row.cost_usd,
    callCount: row.call_count,
    totalDurationMs: row.total_duration_ms,
    toolCallCount: row.tool_call_count,
    toolErrorCount: row.tool_error_count,
    updatedAt: row.updated_at,
  }));
}

function cloneErrorSamples(
  samples: Map<string, number>,
): Array<{ errorType: string; count: number }> {
  return Array.from(samples.entries())
    .map(([errorType, count]) => ({ errorType, count }))
    .sort(
      (left, right) => right.count - left.count || left.errorType.localeCompare(right.errorType),
    );
}

/**
 * 读取一组 session 的工具调用明细聚合（供 GET /team/runtime 恢复 tool / agent 排行）。
 * 这里以事件表为准进行会话内聚合，避免把明细信息压扁到总量表后无法恢复。
 */
export function listTeamToolCallRecords(input: {
  userId: string;
  sessionIds: string[];
}): TeamToolCallRecordRow[] {
  const rows = listRowsBySessionIds<ToolCallRowRaw>({
    query: (
      placeholders,
    ) => `SELECT id, created_at, session_id, layer, agent_id, tool_name, duration_ms, success, error_type
       FROM team_tool_call_records
      WHERE user_id = ? AND session_id IN (${placeholders})
      ORDER BY created_at ASC, id ASC`,
    sessionIds: input.sessionIds,
    userId: input.userId,
  }).sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) || compareSqliteIds(left.id, right.id),
  );

  const aggregates = new Map<
    string,
    TeamToolCallRecordRow & { errorCounts: Map<string, number> }
  >();

  for (const row of rows) {
    const sessionId = row.session_id;
    const layer = row.layer && row.layer.length > 0 ? row.layer : null;
    const agentId = row.agent_id;
    const toolName = row.tool_name;
    const key = [sessionId, layer ?? '', agentId ?? '', toolName].join('\u0000');
    const current =
      aggregates.get(key) ??
      ({
        sessionId,
        layer,
        agentId,
        toolName,
        invocations: 0,
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
        durations: [],
        errorSamples: [],
        errorCounts: new Map<string, number>(),
      } satisfies TeamToolCallRecordRow & { errorCounts: Map<string, number> });

    current.invocations += 1;
    current.successes += row.success === 1 ? 1 : 0;
    current.failures += row.success === 1 ? 0 : 1;
    current.totalDurationMs += row.duration_ms;
    if (row.duration_ms > 0) {
      current.durations.push(row.duration_ms);
      if (current.durations.length > 500) {
        current.durations.shift();
      }
    }
    if (row.success !== 1 && row.error_type) {
      current.errorCounts.set(row.error_type, (current.errorCounts.get(row.error_type) ?? 0) + 1);
    }
    aggregates.set(key, current);
  }

  return Array.from(aggregates.values()).map((record) => ({
    sessionId: record.sessionId,
    layer: record.layer,
    agentId: record.agentId,
    toolName: record.toolName,
    invocations: record.invocations,
    successes: record.successes,
    failures: record.failures,
    totalDurationMs: record.totalDurationMs,
    durations: [...record.durations].sort((left, right) => left - right),
    errorSamples: cloneErrorSamples(record.errorCounts),
  }));
}
