/**
 * 260516-team-page-v2 · T-13 · ToolCallsView
 *
 * 「工具调用统计」tab：从 useTeamToolCallStore 读取工具维度统计。
 *
 * 当前若 store 为空，显示「等待数据接入」提示。
 */

import { useMemo, type CSSProperties } from 'react';
import {
  useTeamToolCallStore,
  quantile,
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

export function ToolCallsView() {
  const byTool = useTeamToolCallStore((s) => s.byTool);
  const byAgent = useTeamToolCallStore((s) => s.byAgent);

  const tools = useMemo(
    () =>
      Array.from(byTool.values())
        .map(deriveStats)
        .sort((a, b) => b.invocations - a.invocations),
    [byTool],
  );

  if (tools.length === 0) {
    return (
      <TabContainer
        title="工具调用统计"
        subtitle="按 tool / agent 拆分调用次数、错误率与 P95 耗时。"
      >
        <div style={CONTAINER_STYLE}>
          <EmptyState
            emoji="🛠️"
            title="暂无工具调用数据"
            description={
              <>
                工具调用从 chat 流的 tool-call 事件聚合而来。
                <br />
                等待 team-events 推送 <code>team_tool_call</code> 事件，
                <code>useTeamToolCallStore.applyToolCallEvent</code> 会自动累计。
              </>
            }
          />
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer title="工具调用统计" subtitle="按 tool / agent 拆分调用次数、错误率与 P95 耗时。">
      <div style={CONTAINER_STYLE}>
        <span style={SECTION_TITLE_STYLE}>工具调用排行</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {tools.map((tool) => (
            <ToolRow key={tool.toolName} tool={tool} />
          ))}
        </div>

        {byAgent.size > 0 ? (
          <>
            <span style={SECTION_TITLE_STYLE}>按 agent 拆分</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {Array.from(byAgent.entries()).map(([agentId, toolMap]) => (
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
