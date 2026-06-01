/**
 * 260530-team-page · Wave 1 · SessionStatsPanel（F2 当前会话统计）
 *
 * 聚合「当前选中 session」维度的统计：消息/handoff/运行时长/token/费用/工具调用。
 *
 * 数据来源（全部为既有 store，无新后端依赖）：
 *   - useHandoffStore：该 session 关联的 handoff（运行时长、handoff 数、状态）
 *   - useLayerStore：session→roleLayer、子 session 关系（用于"含子树"聚合）
 *   - useTeamUsageStore.bySession：该 session 的 token / 费用（等待后端 team_usage 接入）
 *   - useTeamToolCallStore：工具调用（按 session 维度——store 暂未分 session，
 *     故工具调用数展示为"全局/等待 session 维度接入"，不假装是本 session 的）
 *
 * 诚实标注：token/费用/工具调用依赖未接入的 team_usage / team_tool_call 事件。
 * 未接入时这些卡片显示 "—" 或 0，并通过 hint 说明数据来源。
 */

import { useMemo, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { useTeamUsageStore } from '../../../../../stores/team/team-usage.js';
import { StatCard, MetricGrid, EmptyState, SectionPanel } from '../../shared/content-kit/index.js';

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export interface SessionStatsPanelProps {
  /** 当前选中的 session id。 */
  sessionId: string | null;
  /** 该 session 的显示标题（可选）。 */
  sessionTitle?: string | null;
}

export function SessionStatsPanel({ sessionId, sessionTitle }: SessionStatsPanelProps) {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);
  const bySession = useTeamUsageStore((s) => s.bySession);

  // 收集本 session + 其所有子孙 session 的 id（用于"含子树"聚合）。
  const sessionScope = useMemo(() => {
    if (!sessionId) return new Set<string>();
    const childrenOf = new Map<string, string[]>();
    for (const node of nodes.values()) {
      if (!node.parentSessionId) continue;
      const list = childrenOf.get(node.parentSessionId) ?? [];
      list.push(node.sessionId);
      childrenOf.set(node.parentSessionId, list);
    }
    const scope = new Set<string>([sessionId]);
    const stack = [sessionId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of childrenOf.get(current) ?? []) {
        if (!scope.has(child)) {
          scope.add(child);
          stack.push(child);
        }
      }
    }
    return scope;
  }, [sessionId, nodes]);

  const relatedHandoffs = useMemo<HandoffEntry[]>(() => {
    if (sessionScope.size === 0) return [];
    return Array.from(handoffs.values()).filter(
      (entry) => entry.sessionId && sessionScope.has(entry.sessionId),
    );
  }, [handoffs, sessionScope]);

  const stats = useMemo(() => {
    let runtimeMs = 0;
    let runningCount = 0;
    let failedCount = 0;
    for (const entry of relatedHandoffs) {
      const start = entry.startedAt;
      const end = entry.endedAt;
      if (start && end && end > start) runtimeMs += end - start;
      if (entry.state === 'running' || entry.state === 'claimed' || entry.state === 'pending')
        runningCount += 1;
      if (entry.state === 'failed') failedCount += 1;
    }

    // token / 费用：本 session + 子树聚合（来自 bySession，未接入时为 0）
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let usageCalls = 0;
    for (const id of sessionScope) {
      const bucket = bySession.get(id);
      if (bucket) {
        inputTokens += bucket.inputTokens;
        outputTokens += bucket.outputTokens;
        costUsd += bucket.costUsd;
        usageCalls += bucket.count;
      }
    }

    const node = sessionId ? nodes.get(sessionId) : undefined;
    return {
      childCount: sessionScope.size - 1,
      handoffCount: relatedHandoffs.length,
      runningCount,
      failedCount,
      runtimeMs,
      inputTokens,
      outputTokens,
      costUsd,
      usageCalls,
      layer: node?.roleLayer ?? null,
      state: node?.state ?? null,
    };
  }, [relatedHandoffs, sessionScope, bySession, nodes, sessionId]);

  if (!sessionId) {
    return (
      <EmptyState
        emoji="📊"
        title="未选择会话"
        description="在左侧选择一个团队会话后，这里会显示该会话（含子层级）的消息、耗时、token 与费用统计。"
      />
    );
  }

  const hasUsage = stats.usageCalls > 0;

  return (
    <div style={CONTAINER_STYLE}>
      <SectionPanel
        title={sessionTitle || `会话 ${sessionId.slice(0, 8)}…`}
        hint={stats.layer ? LAYER_LABELS[stats.layer] : undefined}
      >
        <MetricGrid minColumnWidth={150}>
          <StatCard
            label="子层级会话"
            value={String(stats.childCount)}
            icon="teams"
            note="含本会话派生的下层 session"
          />
          <StatCard
            label="Handoff 数"
            value={String(stats.handoffCount)}
            icon="tasks"
            note={`运行中 ${stats.runningCount} · 失败 ${stats.failedCount}`}
            tone={stats.failedCount > 0 ? 'danger' : 'default'}
          />
          <StatCard
            label="累计运行时长"
            value={formatDuration(stats.runtimeMs)}
            icon="timer"
            note="各 handoff 执行时长之和"
          />
          <StatCard
            label="LLM 调用"
            value={hasUsage ? String(stats.usageCalls) : '—'}
            icon="play"
            note={hasUsage ? '本会话及子树' : '暂无用量记录'}
          />
          <StatCard
            label="输入 token"
            value={hasUsage ? formatTokens(stats.inputTokens) : '—'}
            note={hasUsage ? undefined : '暂无用量记录'}
          />
          <StatCard
            label="输出 token"
            value={hasUsage ? formatTokens(stats.outputTokens) : '—'}
            note={hasUsage ? undefined : '暂无用量记录'}
          />
          <StatCard
            label="估算成本"
            value={hasUsage ? formatCost(stats.costUsd) : '—'}
            tone={hasUsage ? 'accent' : 'default'}
            note={hasUsage ? undefined : '暂无用量记录'}
          />
        </MetricGrid>
      </SectionPanel>

      {!hasUsage ? (
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          token / 费用来自 agent-gateway 的 <code>team_usage</code> 用量记录（已持久化）。
          本会话还没有产生 LLM 调用时显示 “—”，团队执行后会按本会话及其子层级自动聚合，
          刷新 / 重连后依然保留。
        </span>
      ) : null}
    </div>
  );
}
