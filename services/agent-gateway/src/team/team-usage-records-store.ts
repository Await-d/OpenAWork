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

import { sqliteAll, sqliteRun } from '../infra/db.js';
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../infra/sqlite-batch.js';
import { normalizeTokenCount } from '@openAwork/agent-core';

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
  const agentId = input.agentId ?? null;

  sqliteRun(
    `INSERT INTO team_usage_records (
       user_id, session_id, layer, agent_id, provider, model,
       input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
       cost_usd, call_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(user_id, session_id, layer, provider, model) DO UPDATE SET
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
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
    ],
  );
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
}): void {
  const durationMs = Math.max(0, Math.trunc(input.durationMs));
  if (durationMs === 0) {
    return;
  }
  const layer = normalizeKey(input.layer);
  const provider = normalizeKey(input.provider);
  const model = normalizeKey(input.model);

  sqliteRun(
    `INSERT INTO team_usage_records (
       user_id, session_id, layer, provider, model, total_duration_ms, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, session_id, layer, provider, model) DO UPDATE SET
       total_duration_ms = team_usage_records.total_duration_ms + excluded.total_duration_ms,
       updated_at = datetime('now')`,
    [input.userId, input.sessionId, layer, provider, model, durationMs],
  );
}

/**
 * 累加一次工具调用计数到 team_usage_records（按聚合键 upsert）。
 * 工具调用没有 token，单独累加 tool_call_count / tool_error_count，
 * 复用同一聚合行（layer/provider/model 维度）。
 */
export function persistTeamToolCallRecord(input: TeamToolCallPersistInput): void {
  const layer = normalizeKey(input.layer);
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
       user_id, session_id, layer, provider, model,
       tool_call_count, tool_error_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
     ON CONFLICT(user_id, session_id, layer, provider, model) DO UPDATE SET
       tool_call_count = team_usage_records.tool_call_count + 1,
       tool_error_count = team_usage_records.tool_error_count + excluded.tool_error_count,
       updated_at = datetime('now')`,
    [input.userId, input.sessionId, layer, '', '', errorDelta],
  );
  sqliteRun(
    `INSERT INTO team_tool_call_records (
       user_id, session_id, layer, agent_id, tool_name, duration_ms, success, error_type
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.sessionId,
      layer,
      input.agentId ?? null,
      toolName,
      durationMs,
      input.success ? 1 : 0,
      errorType,
    ],
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
