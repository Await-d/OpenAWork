/**
 * 260516-team-page-v2 · T-13 · team-usage store
 *
 * 团队用量 / 工具调用聚合 store（Phase 2 占位实现）。
 *
 * 当前状态：
 *   - Schema 已就位，UI（UsageView / ToolCallView）按此读取
 *   - applyUsageEvent / applyToolCallEvent 是入口，等待
 *     services/agent-gateway 把 stream usage / tool result 事件
 *     转发到前端 team-events WS
 *
 * 后续接入步骤：
 *   1. 后端：在 stream-usage-event / stream-model-round 完成时
 *      额外发一个 `team_usage` / `team_tool_call` 事件给当前会话所属的 team
 *   2. apps/web/src/stores/team-events.ts 在分发时调用
 *      useTeamUsageStore.applyUsageEvent / applyToolCallEvent
 */

import { create } from 'zustand';

// ─── Usage ──────────────────────────────────────────────────────────────────

export interface TeamUsageEvent {
  /** 触发该 usage 的 agent / 角色，用于按 agent 聚合。 */
  agentId?: string;
  /** session 维度，用于按 session 聚合。 */
  sessionId?: string;
  /** 角色层级，用于按 layer 聚合（reception/pm1/pm2/executor/tester/reviewer）。 */
  layer?: string;
  /** provider 名称，如 'anthropic'/'openai'。 */
  provider?: string;
  /** model 名称。 */
  model?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** 估算成本（USD），若可得。 */
  costUsd?: number;
  timestamp: number;
}

export interface UsageBucket {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  count: number;
}

interface TeamUsageState {
  /** 按 provider 聚合。 */
  byProvider: Map<string, UsageBucket>;
  /** 按 agent 聚合。 */
  byAgent: Map<string, UsageBucket>;
  /** 按 session 聚合。 */
  bySession: Map<string, UsageBucket>;
  /** 按 layer（角色层级）聚合。 */
  byLayer: Map<string, UsageBucket>;
  /** 当前 session 内按 provider 细分。 */
  bySessionProvider: Map<string, Map<string, UsageBucket>>;
  /** 当前 session 内按 agent 细分。 */
  bySessionAgent: Map<string, Map<string, UsageBucket>>;
  /** 当前 session 内按 layer 细分。 */
  bySessionLayer: Map<string, Map<string, UsageBucket>>;
  /** 全量 events（最近 200 条），用于按时间窗口聚合。 */
  recent: TeamUsageEvent[];
  total: UsageBucket;
  applyUsageEvent: (event: TeamUsageEvent) => void;
  hydrateFromRecords: (records: TeamUsageRecordSeed[]) => void;
  clear: () => void;
}

function emptyBucket(): UsageBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    count: 0,
  };
}

function addToBucket(bucket: UsageBucket, event: TeamUsageEvent): UsageBucket {
  return {
    inputTokens: bucket.inputTokens + event.inputTokens,
    outputTokens: bucket.outputTokens + event.outputTokens,
    reasoningTokens: bucket.reasoningTokens + (event.reasoningTokens ?? 0),
    cacheReadTokens: bucket.cacheReadTokens + (event.cacheReadTokens ?? 0),
    cacheWriteTokens: bucket.cacheWriteTokens + (event.cacheWriteTokens ?? 0),
    costUsd: bucket.costUsd + (event.costUsd ?? 0),
    count: bucket.count + 1,
  };
}

function mergeUsageBuckets(left: UsageBucket, right: UsageBucket): UsageBucket {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    costUsd: left.costUsd + right.costUsd,
    count: left.count + right.count,
  };
}

function addEventToNestedBucket(
  map: Map<string, Map<string, UsageBucket>>,
  outerKey: string,
  innerKey: string,
  event: TeamUsageEvent,
): void {
  const inner = new Map(map.get(outerKey) ?? new Map<string, UsageBucket>());
  inner.set(innerKey, addToBucket(inner.get(innerKey) ?? emptyBucket(), event));
  map.set(outerKey, inner);
}

function addBucketToNestedBucket(
  map: Map<string, Map<string, UsageBucket>>,
  outerKey: string,
  innerKey: string,
  bucket: UsageBucket,
): void {
  const inner = new Map(map.get(outerKey) ?? new Map<string, UsageBucket>());
  inner.set(innerKey, mergeUsageBuckets(inner.get(innerKey) ?? emptyBucket(), bucket));
  map.set(outerKey, inner);
}

function usageBucketFromRecord(rec: TeamUsageRecordSeed): UsageBucket {
  return {
    inputTokens: rec.inputTokens,
    outputTokens: rec.outputTokens,
    reasoningTokens: rec.reasoningTokens,
    cacheReadTokens: rec.cacheReadTokens,
    cacheWriteTokens: rec.cacheWriteTokens,
    costUsd: rec.costUsd,
    count: rec.callCount,
  };
}

const RECENT_LIMIT = 200;

export const useTeamUsageStore = create<TeamUsageState>((set) => ({
  byProvider: new Map(),
  byAgent: new Map(),
  bySession: new Map(),
  byLayer: new Map(),
  bySessionProvider: new Map(),
  bySessionAgent: new Map(),
  bySessionLayer: new Map(),
  recent: [],
  total: emptyBucket(),
  applyUsageEvent: (event) =>
    set((state) => {
      const byProvider = new Map(state.byProvider);
      const byAgent = new Map(state.byAgent);
      const bySession = new Map(state.bySession);
      const byLayer = new Map(state.byLayer);
      const bySessionProvider = new Map(state.bySessionProvider);
      const bySessionAgent = new Map(state.bySessionAgent);
      const bySessionLayer = new Map(state.bySessionLayer);

      if (event.provider) {
        byProvider.set(
          event.provider,
          addToBucket(byProvider.get(event.provider) ?? emptyBucket(), event),
        );
      }
      if (event.agentId) {
        byAgent.set(event.agentId, addToBucket(byAgent.get(event.agentId) ?? emptyBucket(), event));
      }
      if (event.sessionId) {
        bySession.set(
          event.sessionId,
          addToBucket(bySession.get(event.sessionId) ?? emptyBucket(), event),
        );
        if (event.provider) {
          addEventToNestedBucket(bySessionProvider, event.sessionId, event.provider, event);
        }
        if (event.agentId) {
          addEventToNestedBucket(bySessionAgent, event.sessionId, event.agentId, event);
        }
        if (event.layer) {
          addEventToNestedBucket(bySessionLayer, event.sessionId, event.layer, event);
        }
      }
      if (event.layer) {
        byLayer.set(event.layer, addToBucket(byLayer.get(event.layer) ?? emptyBucket(), event));
      }

      const nextRecent = [...state.recent, event].slice(-RECENT_LIMIT);
      return {
        byProvider,
        byAgent,
        bySession,
        byLayer,
        bySessionProvider,
        bySessionAgent,
        bySessionLayer,
        recent: nextRecent,
        total: addToBucket(state.total, event),
      };
    }),
  clear: () =>
    set({
      byProvider: new Map(),
      byAgent: new Map(),
      bySession: new Map(),
      byLayer: new Map(),
      bySessionProvider: new Map(),
      bySessionAgent: new Map(),
      bySessionLayer: new Map(),
      recent: [],
      total: emptyBucket(),
    }),
  hydrateFromRecords: (records) =>
    set(() => {
      // 用持久化聚合"替换"内存聚合（权威快照语义）：每次 GET /team/runtime
      // 回灌时重置为后端权威总量；实时 WS 事件在两次刷新之间叠加在其上，
      // 下次刷新再被权威值覆盖，因此任何瞬时重复计数会自愈。
      const byProvider = new Map<string, UsageBucket>();
      const byAgent = new Map<string, UsageBucket>();
      const bySession = new Map<string, UsageBucket>();
      const byLayer = new Map<string, UsageBucket>();
      const bySessionProvider = new Map<string, Map<string, UsageBucket>>();
      const bySessionAgent = new Map<string, Map<string, UsageBucket>>();
      const bySessionLayer = new Map<string, Map<string, UsageBucket>>();
      let total = emptyBucket();

      const accumulate = (map: Map<string, UsageBucket>, key: string, rec: TeamUsageRecordSeed) => {
        const cur = map.get(key) ?? emptyBucket();
        map.set(key, {
          inputTokens: cur.inputTokens + rec.inputTokens,
          outputTokens: cur.outputTokens + rec.outputTokens,
          reasoningTokens: cur.reasoningTokens + rec.reasoningTokens,
          cacheReadTokens: cur.cacheReadTokens + rec.cacheReadTokens,
          cacheWriteTokens: cur.cacheWriteTokens + rec.cacheWriteTokens,
          costUsd: cur.costUsd + rec.costUsd,
          count: cur.count + rec.callCount,
        });
      };

      for (const rec of records) {
        if (rec.provider) accumulate(byProvider, rec.provider, rec);
        if (rec.agentId) accumulate(byAgent, rec.agentId, rec);
        if (rec.sessionId) accumulate(bySession, rec.sessionId, rec);
        if (rec.layer) accumulate(byLayer, rec.layer, rec);
        if (rec.sessionId && rec.provider) {
          addBucketToNestedBucket(
            bySessionProvider,
            rec.sessionId,
            rec.provider,
            usageBucketFromRecord(rec),
          );
        }
        if (rec.sessionId && rec.agentId) {
          addBucketToNestedBucket(
            bySessionAgent,
            rec.sessionId,
            rec.agentId,
            usageBucketFromRecord(rec),
          );
        }
        if (rec.sessionId && rec.layer) {
          addBucketToNestedBucket(
            bySessionLayer,
            rec.sessionId,
            rec.layer,
            usageBucketFromRecord(rec),
          );
        }
        total = {
          inputTokens: total.inputTokens + rec.inputTokens,
          outputTokens: total.outputTokens + rec.outputTokens,
          reasoningTokens: total.reasoningTokens + rec.reasoningTokens,
          cacheReadTokens: total.cacheReadTokens + rec.cacheReadTokens,
          cacheWriteTokens: total.cacheWriteTokens + rec.cacheWriteTokens,
          costUsd: total.costUsd + rec.costUsd,
          count: total.count + rec.callCount,
        };
      }

      // recent 是"最近调用"展示日志，由实时 WS 事件 append。hydrate 只重建权威
      // 聚合桶（byProvider/byAgent/bySession/byLayer/total），**不动 recent**——
      // 否则每次轮询刷新都会清空"最近调用"列表与层级下钻，导致活动会话期间反复闪烁。
      return {
        byProvider,
        byAgent,
        bySession,
        byLayer,
        bySessionProvider,
        bySessionAgent,
        bySessionLayer,
        total,
      };
    }),
}));

/** hydrateFromRecords 接受的最小记录形状（与 web-client TeamUsageRecord 对齐）。 */
export interface TeamUsageRecordSeed {
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
}

/** 用持久化的 team usage 聚合回灌内存 store（刷新/重连后还原历史用量）。 */
export function hydrateTeamUsageStore(records: TeamUsageRecordSeed[]): void {
  useTeamUsageStore.getState().hydrateFromRecords(records);
}

// ─── Tool Calls ─────────────────────────────────────────────────────────────

export interface TeamToolCallEvent {
  toolName: string;
  agentId?: string;
  sessionId?: string;
  layer?: string;
  durationMs?: number;
  success: boolean;
  errorType?: string;
  timestamp: number;
}

export interface ToolCallStats {
  toolName: string;
  invocations: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  /** 升序排列，用于 P95 计算。 */
  durations: number[];
  errorSamples: Array<{ errorType: string; count: number }>;
}

export interface ToolCallAggregateBucket {
  invocations: number;
  failures: number;
}

export interface TeamToolCallRecordSeed {
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

interface TeamToolCallState {
  byTool: Map<string, ToolCallStats>;
  byAgent: Map<string, Map<string, number>>; // agentId -> toolName -> invocations
  bySession: Map<string, ToolCallAggregateBucket>;
  byLayer: Map<string, ToolCallAggregateBucket>;
  bySessionLayer: Map<string, Map<string, ToolCallAggregateBucket>>;
  bySessionTool: Map<string, Map<string, ToolCallStats>>;
  bySessionAgent: Map<string, Map<string, Map<string, number>>>;
  recent: TeamToolCallEvent[];
  totalFailures: number;
  totalInvocations: number;
  applyToolCallEvent: (event: TeamToolCallEvent) => void;
  hydrateFromRecords: (
    usageRecords: TeamUsageRecordSeed[],
    toolCallRecords?: TeamToolCallRecordSeed[] | null,
  ) => void;
  clear: () => void;
}

function emptyToolStats(toolName: string): ToolCallStats {
  return {
    toolName,
    invocations: 0,
    successes: 0,
    failures: 0,
    totalDurationMs: 0,
    durations: [],
    errorSamples: [],
  };
}

function emptyToolCallAggregateBucket(): ToolCallAggregateBucket {
  return {
    invocations: 0,
    failures: 0,
  };
}

function addErrorSample(samples: Array<{ errorType: string; count: number }>, errorType: string) {
  const idx = samples.findIndex((s) => s.errorType === errorType);
  if (idx >= 0) {
    samples[idx] = { errorType, count: samples[idx]!.count + 1 };
  } else {
    samples.push({ errorType, count: 1 });
  }
  return samples;
}

function cloneToolStats(stats: ToolCallStats): ToolCallStats {
  return {
    ...stats,
    durations: [...stats.durations],
    errorSamples: [...stats.errorSamples],
  };
}

const TOOL_DURATION_LIMIT = 500;

function accumulateToolEvent(
  existing: ToolCallStats,
  event: Pick<TeamToolCallEvent, 'durationMs' | 'errorType' | 'success' | 'toolName'>,
): ToolCallStats {
  const durations = [...existing.durations];
  if (typeof event.durationMs === 'number' && event.durationMs > 0) {
    durations.push(event.durationMs);
    if (durations.length > TOOL_DURATION_LIMIT) {
      durations.shift();
    }
  }
  const errorSamples = [...existing.errorSamples];
  if (!event.success && event.errorType) {
    addErrorSample(errorSamples, event.errorType);
  }
  return {
    toolName: event.toolName,
    invocations: existing.invocations + 1,
    successes: existing.successes + (event.success ? 1 : 0),
    failures: existing.failures + (event.success ? 0 : 1),
    totalDurationMs: existing.totalDurationMs + (event.durationMs ?? 0),
    durations,
    errorSamples,
  };
}

function mergeToolStats(left: ToolCallStats, right: ToolCallStats): ToolCallStats {
  const errorCounts = new Map<string, number>();
  for (const sample of [...left.errorSamples, ...right.errorSamples]) {
    errorCounts.set(sample.errorType, (errorCounts.get(sample.errorType) ?? 0) + sample.count);
  }
  const durations = [...left.durations, ...right.durations]
    .sort((a, b) => a - b)
    .slice(-TOOL_DURATION_LIMIT);
  return {
    toolName: left.toolName,
    invocations: left.invocations + right.invocations,
    successes: left.successes + right.successes,
    failures: left.failures + right.failures,
    totalDurationMs: left.totalDurationMs + right.totalDurationMs,
    durations,
    errorSamples: Array.from(errorCounts.entries()).map(([errorType, count]) => ({
      errorType,
      count,
    })),
  };
}

function toolStatsFromRecord(record: TeamToolCallRecordSeed): ToolCallStats {
  return {
    toolName: record.toolName,
    invocations: record.invocations,
    successes: record.successes,
    failures: record.failures,
    totalDurationMs: record.totalDurationMs,
    durations: [...record.durations].sort((a, b) => a - b).slice(-TOOL_DURATION_LIMIT),
    errorSamples: [...record.errorSamples],
  };
}

function addToolCallAggregate(
  map: Map<string, ToolCallAggregateBucket>,
  key: string,
  invocations: number,
  failures: number,
): void {
  const current = map.get(key) ?? emptyToolCallAggregateBucket();
  map.set(key, {
    invocations: current.invocations + invocations,
    failures: current.failures + failures,
  });
}

export const useTeamToolCallStore = create<TeamToolCallState>((set) => ({
  byTool: new Map(),
  byAgent: new Map(),
  bySession: new Map(),
  byLayer: new Map(),
  bySessionLayer: new Map(),
  bySessionTool: new Map(),
  bySessionAgent: new Map(),
  recent: [],
  totalFailures: 0,
  totalInvocations: 0,
  applyToolCallEvent: (event) =>
    set((state) => {
      const byTool = new Map(state.byTool);
      const existing = byTool.get(event.toolName) ?? emptyToolStats(event.toolName);
      const next = accumulateToolEvent(existing, event);
      byTool.set(event.toolName, next);

      const byAgent = new Map(state.byAgent);
      if (event.agentId) {
        const inner = new Map(byAgent.get(event.agentId) ?? new Map<string, number>());
        inner.set(event.toolName, (inner.get(event.toolName) ?? 0) + 1);
        byAgent.set(event.agentId, inner);
      }

      const bySession = new Map(state.bySession);
      if (event.sessionId) {
        const current = bySession.get(event.sessionId) ?? emptyToolCallAggregateBucket();
        bySession.set(event.sessionId, {
          invocations: current.invocations + 1,
          failures: current.failures + (event.success ? 0 : 1),
        });
      }

      const byLayer = new Map(state.byLayer);
      if (event.layer) {
        const current = byLayer.get(event.layer) ?? emptyToolCallAggregateBucket();
        byLayer.set(event.layer, {
          invocations: current.invocations + 1,
          failures: current.failures + (event.success ? 0 : 1),
        });
      }
      const bySessionLayer = new Map(state.bySessionLayer);
      if (event.sessionId && event.layer) {
        const inner = new Map(
          bySessionLayer.get(event.sessionId) ?? new Map<string, ToolCallAggregateBucket>(),
        );
        const current = inner.get(event.layer) ?? emptyToolCallAggregateBucket();
        inner.set(event.layer, {
          invocations: current.invocations + 1,
          failures: current.failures + (event.success ? 0 : 1),
        });
        bySessionLayer.set(event.sessionId, inner);
      }

      const bySessionTool = new Map(state.bySessionTool);
      if (event.sessionId) {
        const inner = new Map(
          bySessionTool.get(event.sessionId) ?? new Map<string, ToolCallStats>(),
        );
        const sessionExisting = inner.get(event.toolName) ?? emptyToolStats(event.toolName);
        inner.set(event.toolName, accumulateToolEvent(sessionExisting, event));
        bySessionTool.set(event.sessionId, inner);
      }

      const bySessionAgent = new Map(state.bySessionAgent);
      if (event.sessionId && event.agentId) {
        const agentMap = new Map(
          bySessionAgent.get(event.sessionId) ?? new Map<string, Map<string, number>>(),
        );
        const toolMap = new Map(agentMap.get(event.agentId) ?? new Map<string, number>());
        toolMap.set(event.toolName, (toolMap.get(event.toolName) ?? 0) + 1);
        agentMap.set(event.agentId, toolMap);
        bySessionAgent.set(event.sessionId, agentMap);
      }

      const nextRecent = [...state.recent, event].slice(-RECENT_LIMIT);
      return {
        byAgent,
        byLayer,
        bySession,
        bySessionAgent,
        bySessionLayer,
        bySessionTool,
        byTool,
        recent: nextRecent,
        totalFailures: state.totalFailures + (event.success ? 0 : 1),
        totalInvocations: state.totalInvocations + 1,
      };
    }),
  hydrateFromRecords: (usageRecords, toolCallRecords) =>
    set((state) => {
      const shouldUseToolCallRecords =
        Array.isArray(toolCallRecords) &&
        (toolCallRecords.length > 0 ||
          usageRecords.every(
            (record) => record.toolCallCount === 0 && record.toolErrorCount === 0,
          ));
      const snapshotSessionIds = new Set(
        (shouldUseToolCallRecords ? toolCallRecords : usageRecords).map(
          (record) => record.sessionId,
        ),
      );
      const hasOverlapWithCurrentWorkspace = Array.from(state.bySession.keys()).some((sessionId) =>
        snapshotSessionIds.has(sessionId),
      );
      const shouldResetRecent = snapshotSessionIds.size === 0 || !hasOverlapWithCurrentWorkspace;

      if (shouldUseToolCallRecords && toolCallRecords) {
        const byTool = new Map<string, ToolCallStats>();
        const byAgent = new Map<string, Map<string, number>>();
        const bySession = new Map<string, ToolCallAggregateBucket>();
        const byLayer = new Map<string, ToolCallAggregateBucket>();
        const bySessionLayer = new Map<string, Map<string, ToolCallAggregateBucket>>();
        const bySessionTool = new Map<string, Map<string, ToolCallStats>>();
        const bySessionAgent = new Map<string, Map<string, Map<string, number>>>();
        let totalInvocations = 0;
        let totalFailures = 0;

        for (const record of toolCallRecords) {
          const stats = toolStatsFromRecord(record);
          addToolCallAggregate(bySession, record.sessionId, record.invocations, record.failures);
          if (record.layer) {
            addToolCallAggregate(byLayer, record.layer, record.invocations, record.failures);
            const inner = new Map(
              bySessionLayer.get(record.sessionId) ?? new Map<string, ToolCallAggregateBucket>(),
            );
            addToolCallAggregate(inner, record.layer, record.invocations, record.failures);
            bySessionLayer.set(record.sessionId, inner);
          }

          byTool.set(
            record.toolName,
            byTool.has(record.toolName)
              ? mergeToolStats(byTool.get(record.toolName)!, stats)
              : cloneToolStats(stats),
          );

          const sessionToolMap = new Map(
            bySessionTool.get(record.sessionId) ?? new Map<string, ToolCallStats>(),
          );
          sessionToolMap.set(
            record.toolName,
            sessionToolMap.has(record.toolName)
              ? mergeToolStats(sessionToolMap.get(record.toolName)!, stats)
              : cloneToolStats(stats),
          );
          bySessionTool.set(record.sessionId, sessionToolMap);

          if (record.agentId) {
            const agentToolMap = new Map(byAgent.get(record.agentId) ?? new Map<string, number>());
            agentToolMap.set(
              record.toolName,
              (agentToolMap.get(record.toolName) ?? 0) + record.invocations,
            );
            byAgent.set(record.agentId, agentToolMap);

            const sessionAgentMap = new Map(
              bySessionAgent.get(record.sessionId) ?? new Map<string, Map<string, number>>(),
            );
            const sessionAgentToolMap = new Map(
              sessionAgentMap.get(record.agentId) ?? new Map<string, number>(),
            );
            sessionAgentToolMap.set(
              record.toolName,
              (sessionAgentToolMap.get(record.toolName) ?? 0) + record.invocations,
            );
            sessionAgentMap.set(record.agentId, sessionAgentToolMap);
            bySessionAgent.set(record.sessionId, sessionAgentMap);
          }

          totalInvocations += record.invocations;
          totalFailures += record.failures;
        }

        return {
          byAgent,
          byLayer,
          bySession,
          bySessionAgent,
          bySessionLayer,
          bySessionTool,
          byTool,
          recent: shouldResetRecent ? [] : state.recent,
          totalFailures,
          totalInvocations,
        };
      }

      const bySession = new Map<string, ToolCallAggregateBucket>();
      const byLayer = new Map<string, ToolCallAggregateBucket>();
      const bySessionLayer = new Map<string, Map<string, ToolCallAggregateBucket>>();
      let totalInvocations = 0;
      let totalFailures = 0;

      const accumulate = (
        map: Map<string, ToolCallAggregateBucket>,
        key: string,
        rec: TeamUsageRecordSeed,
      ) => {
        const current = map.get(key) ?? emptyToolCallAggregateBucket();
        map.set(key, {
          invocations: current.invocations + rec.toolCallCount,
          failures: current.failures + rec.toolErrorCount,
        });
      };

      for (const rec of usageRecords) {
        if (rec.toolCallCount > 0) {
          accumulate(bySession, rec.sessionId, rec);
          if (rec.layer) {
            accumulate(byLayer, rec.layer, rec);
            const inner = new Map(
              bySessionLayer.get(rec.sessionId) ?? new Map<string, ToolCallAggregateBucket>(),
            );
            const current = inner.get(rec.layer) ?? emptyToolCallAggregateBucket();
            inner.set(rec.layer, {
              invocations: current.invocations + rec.toolCallCount,
              failures: current.failures + rec.toolErrorCount,
            });
            bySessionLayer.set(rec.sessionId, inner);
          }
        }
        totalInvocations += rec.toolCallCount;
        totalFailures += rec.toolErrorCount;
      }

      const shouldResetRealtimeDetails =
        snapshotSessionIds.size === 0 || !hasOverlapWithCurrentWorkspace;

      return {
        byAgent: shouldResetRealtimeDetails ? new Map() : state.byAgent,
        byLayer,
        bySession,
        bySessionAgent: shouldResetRealtimeDetails ? new Map() : state.bySessionAgent,
        bySessionLayer,
        bySessionTool: shouldResetRealtimeDetails ? new Map() : state.bySessionTool,
        byTool: shouldResetRealtimeDetails ? new Map() : state.byTool,
        recent: shouldResetRealtimeDetails ? [] : state.recent,
        totalFailures,
        totalInvocations,
      };
    }),
  clear: () =>
    set({
      byTool: new Map(),
      byAgent: new Map(),
      bySession: new Map(),
      byLayer: new Map(),
      bySessionLayer: new Map(),
      bySessionTool: new Map(),
      bySessionAgent: new Map(),
      recent: [],
      totalFailures: 0,
      totalInvocations: 0,
    }),
}));

// ─── 工具：从有序 array 计算分位数 ───
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  const baseVal = sorted[base] ?? 0;
  return next !== undefined ? baseVal + rest * (next - baseVal) : baseVal;
}

/**
 * 用持久化快照回灌工具调用聚合。
 * 优先使用 toolCallRecords 恢复工具/agent 明细；若旧后端尚未返回该字段，则回退到
 * usageRecords 仅恢复 session/layer 总量。
 */
export function hydrateTeamToolCallStore(
  usageRecords: TeamUsageRecordSeed[],
  toolCallRecords?: TeamToolCallRecordSeed[] | null,
): void {
  useTeamToolCallStore.getState().hydrateFromRecords(usageRecords, toolCallRecords);
}
