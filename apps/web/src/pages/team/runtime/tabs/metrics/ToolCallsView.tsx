/**
 * 260516-team-page-v2 · T-13 · ToolCallsView
 *
 * 「工具调用统计」tab：从 useTeamToolCallStore 读取工具维度统计。
 *
 * 说明：
 *   - runtime 快照可恢复总量与按 tool / agent 的明细排行
 *   - 实时 team_tool_call 事件继续在两次快照之间增量补齐最新调用
 */

import { useMemo, type CSSProperties } from 'react';
import { useLayerStore, type LayerNode } from '../../../../../stores/team/team-events.js';
import {
  useTeamToolCallStore,
  quantile,
  type ToolCallAggregateBucket,
  type ToolCallStats,
} from '../../../../../stores/team/team-usage.js';
import { TabContainer } from '../TabContainer.js';
import {
  EmptyState,
  CK_SECTION_LABEL_STYLE,
  CK_BORDER,
  CK_SURFACE,
} from '../../shared/content-kit/index.js';

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const SECTION_TITLE_STYLE = CK_SECTION_LABEL_STYLE;

const ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${CK_BORDER}`,
  background: CK_SURFACE,
};

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

interface ToolStatsDerived extends ToolCallStats {
  failureRate: number;
  avgMs: number;
  p50: number;
  p95: number;
}

function deriveStats(stats: ToolCallStats): ToolStatsDerived {
  const sorted = stats.durations.slice().sort((a, b) => a - b);
  return {
    ...stats,
    failureRate: stats.invocations > 0 ? stats.failures / stats.invocations : 0,
    avgMs: stats.invocations > 0 ? stats.totalDurationMs / stats.invocations : 0,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
  };
}

function emptyAggregateBucket(): ToolCallAggregateBucket {
  return {
    invocations: 0,
    failures: 0,
  };
}

function mergeAggregateBuckets(
  left: ToolCallAggregateBucket,
  right: ToolCallAggregateBucket,
): ToolCallAggregateBucket {
  return {
    invocations: left.invocations + right.invocations,
    failures: left.failures + right.failures,
  };
}

function mergeToolStats(left: ToolCallStats, right: ToolCallStats): ToolCallStats {
  const errorCounts = new Map<string, number>();
  for (const sample of [...left.errorSamples, ...right.errorSamples]) {
    errorCounts.set(sample.errorType, (errorCounts.get(sample.errorType) ?? 0) + sample.count);
  }
  const durations = [...left.durations, ...right.durations].sort((a, b) => a - b).slice(-500);
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

function collectSessionScope(nodes: Map<string, LayerNode>, rootSessionId: string): Set<string> {
  const scope = new Set<string>([rootSessionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes.values()) {
      if (!node.parentSessionId || scope.has(node.sessionId)) {
        continue;
      }
      if (scope.has(node.parentSessionId)) {
        scope.add(node.sessionId);
        changed = true;
      }
    }
  }
  return scope;
}

function aggregateLayerBuckets(
  map: Map<string, Map<string, ToolCallAggregateBucket>>,
  sessionScope: Set<string>,
): Map<string, ToolCallAggregateBucket> {
  const aggregated = new Map<string, ToolCallAggregateBucket>();
  for (const sessionId of sessionScope) {
    const inner = map.get(sessionId);
    if (!inner) {
      continue;
    }
    for (const [layer, bucket] of inner.entries()) {
      aggregated.set(
        layer,
        mergeAggregateBuckets(aggregated.get(layer) ?? emptyAggregateBucket(), bucket),
      );
    }
  }
  return aggregated;
}

function aggregateToolStats(
  map: Map<string, Map<string, ToolCallStats>>,
  sessionScope: Set<string>,
): Map<string, ToolCallStats> {
  const aggregated = new Map<string, ToolCallStats>();
  for (const sessionId of sessionScope) {
    const inner = map.get(sessionId);
    if (!inner) {
      continue;
    }
    for (const [toolName, stats] of inner.entries()) {
      aggregated.set(
        toolName,
        aggregated.has(toolName)
          ? mergeToolStats(aggregated.get(toolName)!, stats)
          : {
              ...stats,
              durations: [...stats.durations],
              errorSamples: [...stats.errorSamples],
            },
      );
    }
  }
  return aggregated;
}

function aggregateAgentStats(
  map: Map<string, Map<string, Map<string, number>>>,
  sessionScope: Set<string>,
): Map<string, Map<string, number>> {
  const aggregated = new Map<string, Map<string, number>>();
  for (const sessionId of sessionScope) {
    const agentMap = map.get(sessionId);
    if (!agentMap) {
      continue;
    }
    for (const [agentId, toolMap] of agentMap.entries()) {
      const nextToolMap = new Map(aggregated.get(agentId) ?? new Map<string, number>());
      for (const [toolName, count] of toolMap.entries()) {
        nextToolMap.set(toolName, (nextToolMap.get(toolName) ?? 0) + count);
      }
      aggregated.set(agentId, nextToolMap);
    }
  }
  return aggregated;
}

export interface ToolCallsViewProps {
  selectedSessionId?: string | null;
  selectedSessionTitle?: string | null;
}

export function ToolCallsView({
  selectedSessionId = null,
  selectedSessionTitle = null,
}: ToolCallsViewProps = {}) {
  const nodes = useLayerStore((s) => s.nodes);
  const byTool = useTeamToolCallStore((s) => s.byTool);
  const byAgent = useTeamToolCallStore((s) => s.byAgent);
  const byLayer = useTeamToolCallStore((s) => s.byLayer);
  const bySession = useTeamToolCallStore((s) => s.bySession);
  const bySessionLayer = useTeamToolCallStore((s) => s.bySessionLayer);
  const bySessionTool = useTeamToolCallStore((s) => s.bySessionTool);
  const bySessionAgent = useTeamToolCallStore((s) => s.bySessionAgent);
  const totalFailures = useTeamToolCallStore((s) => s.totalFailures);
  const totalInvocations = useTeamToolCallStore((s) => s.totalInvocations);
  const sessionScope = useMemo(
    () => (selectedSessionId ? collectSessionScope(nodes, selectedSessionId) : null),
    [nodes, selectedSessionId],
  );

  const scopedTotal = useMemo(() => {
    if (!sessionScope) {
      return { totalFailures, totalInvocations };
    }
    let invocations = 0;
    let failures = 0;
    for (const sessionId of sessionScope) {
      const bucket = bySession.get(sessionId);
      if (!bucket) {
        continue;
      }
      invocations += bucket.invocations;
      failures += bucket.failures;
    }
    return {
      totalFailures: failures,
      totalInvocations: invocations,
    };
  }, [bySession, sessionScope, totalFailures, totalInvocations]);

  const tools = useMemo(
    () =>
      Array.from((sessionScope ? aggregateToolStats(bySessionTool, sessionScope) : byTool).values())
        .map(deriveStats)
        .sort((a, b) => b.invocations - a.invocations),
    [bySessionTool, byTool, sessionScope],
  );

  const layerRows = useMemo(
    () =>
      Array.from(
        (sessionScope ? aggregateLayerBuckets(bySessionLayer, sessionScope) : byLayer).entries(),
      ).sort((a, b) => {
        if (b[1].invocations !== a[1].invocations) {
          return b[1].invocations - a[1].invocations;
        }
        return a[0].localeCompare(b[0], 'zh-CN');
      }),
    [byLayer, bySessionLayer, sessionScope],
  );

  const sessionRows = useMemo(() => {
    const entries = Array.from(
      (sessionScope
        ? new Map(
            Array.from(bySession.entries()).filter(([sessionId]) => sessionScope.has(sessionId)),
          )
        : bySession
      ).entries(),
    );
    return entries.sort((a, b) => b[1].invocations - a[1].invocations).slice(0, 8);
  }, [bySession, sessionScope]);
  const sessionCount = useMemo(
    () =>
      sessionScope
        ? Array.from(bySession.keys()).filter((sessionId) => sessionScope.has(sessionId)).length
        : bySession.size,
    [bySession, sessionScope],
  );

  const scopedAgents = useMemo(
    () => (sessionScope ? aggregateAgentStats(bySessionAgent, sessionScope) : byAgent),
    [byAgent, bySessionAgent, sessionScope],
  );

  if (tools.length === 0 && scopedTotal.totalInvocations === 0) {
    return (
      <TabContainer
        title="工具调用统计"
        subtitle={
          selectedSessionId
            ? '按当前会话及其子树的 tool / agent 拆分调用次数、错误率与 P95 耗时。'
            : '按 tool / agent 拆分调用次数、错误率与 P95 耗时。'
        }
      >
        <div style={CONTAINER_STYLE}>
          <EmptyState
            emoji="🛠️"
            title={selectedSessionId ? '当前会话暂无工具调用数据' : '暂无工具调用数据'}
            description={
              selectedSessionId ? (
                <>
                  {selectedSessionTitle ?? `会话 ${selectedSessionId.slice(0, 8)}`} 及其子树尚未产生
                  工具调用。
                  <br />
                  一旦有 team tool call 事件或快照聚合写入，这里会自动按当前会话范围展示。
                </>
              ) : (
                <>
                  工具调用来自 team runtime 的快照与实时事件。
                  <br />
                  当团队开始执行工具后，这里会自动出现总量与按工具拆分的明细。
                </>
              )
            }
          />
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="工具调用统计"
      subtitle={
        selectedSessionId
          ? '按当前会话及其子树的 tool / agent 拆分调用次数、错误率与 P95 耗时。'
          : '按 tool / agent 拆分调用次数、错误率与 P95 耗时。'
      }
    >
      <div style={CONTAINER_STYLE}>
        {selectedSessionId ? (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
              background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
              color: 'var(--fg-default)',
              fontSize: 12,
            }}
          >
            当前统计范围：{selectedSessionTitle ?? `会话 ${selectedSessionId.slice(0, 8)}`} 及其子树
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={SECTION_TITLE_STYLE}>总览</span>
          <div
            style={{
              display: 'grid',
              gap: 6,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <SummaryCard label="总调用数" value={String(scopedTotal.totalInvocations)} />
            <SummaryCard
              label="失败数"
              value={String(scopedTotal.totalFailures)}
              tone={scopedTotal.totalFailures > 0 ? 'warning' : 'default'}
            />
            <SummaryCard label="活跃层级" value={String(layerRows.length)} />
            <SummaryCard label="涉及会话" value={String(sessionCount)} />
          </div>
        </div>

        {layerRows.length > 0 ? (
          <>
            <span style={SECTION_TITLE_STYLE}>按层级拆分</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {layerRows.map(([layer, bucket]) => (
                <AggregateRow
                  key={layer}
                  label={formatLayerLabel(layer)}
                  invocations={bucket.invocations}
                  failures={bucket.failures}
                />
              ))}
            </div>
          </>
        ) : null}

        {sessionRows.length > 0 ? (
          <>
            <span style={SECTION_TITLE_STYLE}>按会话拆分</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {sessionRows.map(([sessionId, bucket]) => (
                <AggregateRow
                  key={sessionId}
                  label={`会话 ${sessionId.slice(0, 8)}`}
                  invocations={bucket.invocations}
                  failures={bucket.failures}
                />
              ))}
            </div>
          </>
        ) : null}

        <span style={SECTION_TITLE_STYLE}>工具调用排行</span>
        {tools.length > 0 ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {tools.map((tool) => (
              <ToolRow key={tool.toolName} tool={tool} />
            ))}
          </div>
        ) : (
          <div style={ROW_STYLE}>
            <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>暂无工具明细</strong>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              当前统计范围内还没有可展示的工具级明细。
            </span>
          </div>
        )}

        {scopedAgents.size > 0 ? (
          <>
            <span style={SECTION_TITLE_STYLE}>按 agent 拆分</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {Array.from(scopedAgents.entries()).map(([agentId, toolMap]) => (
                <div key={agentId} style={ROW_STYLE}>
                  <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{agentId}</strong>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Array.from(toolMap.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([toolName, count]) => (
                        <span
                          key={toolName}
                          style={{
                            padding: '2px 10px',
                            borderRadius: 999,
                            background: 'var(--bg-overlay)',
                            border:
                              '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                            fontSize: 11,
                            color: 'var(--fg-default)',
                          }}
                        >
                          {toolName} <strong style={{ color: 'var(--fg-strong)' }}>{count}</strong>
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </TabContainer>
  );
}

function formatLayerLabel(layer: string): string {
  switch (layer) {
    case 'user':
      return '用户';
    case 'reception':
      return '接待';
    case 'pm1':
      return 'PM1';
    case 'pm2':
      return 'PM2';
    case 'executor':
      return '执行';
    case 'tester':
      return '测试';
    case 'reviewer':
      return '评审';
    default:
      return layer;
  }
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div style={ROW_STYLE}>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 700 }}>{label}</span>
      <strong
        style={{
          fontSize: 22,
          lineHeight: 1.15,
          color: tone === 'warning' ? 'var(--warning)' : 'var(--fg-strong)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function AggregateRow({
  label,
  invocations,
  failures,
}: {
  label: string;
  invocations: number;
  failures: number;
}) {
  const failurePct = invocations > 0 ? Math.round((failures / invocations) * 100) : 0;
  return (
    <div style={ROW_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
        <strong style={{ color: 'var(--fg-strong)' }}>{label}</strong>
        <span style={{ color: 'var(--fg-muted)' }}>{invocations} 次</span>
        <span
          style={{
            color: failures > 0 ? 'var(--warning)' : 'var(--fg-muted)',
            fontWeight: failures > 0 ? 700 : 600,
          }}
        >
          失败 {failures} {invocations > 0 ? `(${failurePct}%)` : ''}
        </span>
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolStatsDerived }) {
  const failurePct = Math.round(tool.failureRate * 100);
  const failureColor =
    failurePct > 30 ? 'var(--danger)' : failurePct > 10 ? 'var(--warning)' : 'var(--success)';
  return (
    <div style={ROW_STYLE}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
        }}
      >
        <strong
          style={{
            minWidth: 160,
            color: 'var(--fg-strong)',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {tool.toolName}
        </strong>
        <span style={{ color: 'var(--fg-muted)' }}>{tool.invocations} 次</span>
        <span style={{ color: failureColor, fontWeight: 700 }}>
          失败 {tool.failures} ({failurePct}%)
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
          avg {formatMs(tool.avgMs)} · p50 {formatMs(tool.p50)} · p95 {formatMs(tool.p95)}
        </span>
      </div>
      {tool.errorSamples.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tool.errorSamples
            .slice()
            .sort((a, b) => b.count - a.count)
            .map((sample) => (
              <span
                key={sample.errorType}
                style={{
                  padding: '1px 8px',
                  borderRadius: 999,
                  background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                  color: 'var(--danger)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {sample.errorType} × {sample.count}
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}
