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
  /** 全量 events（最近 200 条），用于按时间窗口聚合。 */
  recent: TeamUsageEvent[];
  total: UsageBucket;
  applyUsageEvent: (event: TeamUsageEvent) => void;
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

const RECENT_LIMIT = 200;

export const useTeamUsageStore = create<TeamUsageState>((set) => ({
  byProvider: new Map(),
  byAgent: new Map(),
  bySession: new Map(),
  byLayer: new Map(),
  recent: [],
  total: emptyBucket(),
  applyUsageEvent: (event) =>
    set((state) => {
      const byProvider = new Map(state.byProvider);
      const byAgent = new Map(state.byAgent);
      const bySession = new Map(state.bySession);
      const byLayer = new Map(state.byLayer);

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
      recent: [],
      total: emptyBucket(),
    }),
}));

// ─── Tool Calls ─────────────────────────────────────────────────────────────

export interface TeamToolCallEvent {
  toolName: string;
  agentId?: string;
  sessionId?: string;
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

interface TeamToolCallState {
  byTool: Map<string, ToolCallStats>;
  byAgent: Map<string, Map<string, number>>; // agentId -> toolName -> invocations
  recent: TeamToolCallEvent[];
  applyToolCallEvent: (event: TeamToolCallEvent) => void;
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

function addErrorSample(samples: Array<{ errorType: string; count: number }>, errorType: string) {
  const idx = samples.findIndex((s) => s.errorType === errorType);
  if (idx >= 0) {
    samples[idx] = { errorType, count: samples[idx]!.count + 1 };
  } else {
    samples.push({ errorType, count: 1 });
  }
  return samples;
}

const TOOL_DURATION_LIMIT = 500;

export const useTeamToolCallStore = create<TeamToolCallState>((set) => ({
  byTool: new Map(),
  byAgent: new Map(),
  recent: [],
  applyToolCallEvent: (event) =>
    set((state) => {
      const byTool = new Map(state.byTool);
      const existing = byTool.get(event.toolName) ?? emptyToolStats(event.toolName);
      const durations = [...existing.durations];
      if (typeof event.durationMs === 'number' && event.durationMs > 0) {
        durations.push(event.durationMs);
        if (durations.length > TOOL_DURATION_LIMIT) durations.shift();
      }
      const errorSamples = [...existing.errorSamples];
      if (!event.success && event.errorType) {
        addErrorSample(errorSamples, event.errorType);
      }
      const next: ToolCallStats = {
        toolName: event.toolName,
        invocations: existing.invocations + 1,
        successes: existing.successes + (event.success ? 1 : 0),
        failures: existing.failures + (event.success ? 0 : 1),
        totalDurationMs: existing.totalDurationMs + (event.durationMs ?? 0),
        durations,
        errorSamples,
      };
      byTool.set(event.toolName, next);

      const byAgent = new Map(state.byAgent);
      if (event.agentId) {
        const inner = new Map(byAgent.get(event.agentId) ?? new Map<string, number>());
        inner.set(event.toolName, (inner.get(event.toolName) ?? 0) + 1);
        byAgent.set(event.agentId, inner);
      }

      const nextRecent = [...state.recent, event].slice(-RECENT_LIMIT);
      return { byTool, byAgent, recent: nextRecent };
    }),
  clear: () => set({ byTool: new Map(), byAgent: new Map(), recent: [] }),
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
