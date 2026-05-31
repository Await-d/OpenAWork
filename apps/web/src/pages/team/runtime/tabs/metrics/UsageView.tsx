/**
 * 260516-team-page-v2 · T-13 · UsageView
 *
 * 「用量 & 费用」tab：从 useTeamUsageStore 读取按 provider/agent/session 的聚合值。
 *
 * 当前若 store 为空（事件还未接入），显示「等待数据接入」提示。
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTeamUsageStore, type UsageBucket, type TeamUsageEvent } from '../../../../../stores/team/team-usage.js';
import { TabContainer } from '../TabContainer.js';
import { SessionStatsPanel } from './SessionStatsPanel.js';
import { ToolCallsView } from './ToolCallsView.js';
import {
  StatCard,
  MetricGrid,
  EmptyState,
  SegmentedToggle,
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

const TAB_BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--fg-muted)',
};

const TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...TAB_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--fg-strong)',
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

type GroupKey = 'provider' | 'agent' | 'session' | 'layer';

const LAYER_LABELS: Record<string, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

function formatGroupKey(group: GroupKey, key: string): string {
  if (group === 'layer') return LAYER_LABELS[key] ?? key;
  return key;
}

export interface UsageViewProps {
  /** 当前选中的 session（用于顶部"当前会话统计"面板）。 */
  selectedSessionId?: string | null;
  selectedSessionTitle?: string | null;
}

type MetricsMode = 'usage' | 'tools';

/**
 * 度量·用量 tab 入口：在「用量 & 费用」与「工具调用」之间切换。
 * 工具调用原先是独立 tab（tools），tab 整理后并入用量域。
 */
export function UsageView(props: UsageViewProps = {}) {
  const [mode, setMode] = useState<MetricsMode>('usage');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid color-mix(in srgb, var(--border-default) 32%, transparent)',
          background: 'var(--bg-base)',
        }}
      >
        <SegmentedToggle<MetricsMode>
          ariaLabel="度量视图切换"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'usage', label: '用量 & 费用', icon: '🔋' },
            { value: 'tools', label: '工具调用', icon: '🛠️' },
          ]}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {mode === 'usage' ? <UsageMetricsPanel {...props} /> : <ToolCallsView />}
      </div>
    </div>
  );
}

function UsageMetricsPanel({ selectedSessionId, selectedSessionTitle }: UsageViewProps = {}) {
  const total = useTeamUsageStore((s) => s.total);
  const byProvider = useTeamUsageStore((s) => s.byProvider);
  const byAgent = useTeamUsageStore((s) => s.byAgent);
  const bySession = useTeamUsageStore((s) => s.bySession);
  const byLayer = useTeamUsageStore((s) => s.byLayer);
  const recent = useTeamUsageStore((s) => s.recent);

  const [group, setGroup] = useState<GroupKey>('provider');
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);

  const groupedRows = useMemo(() => {
    const map =
      group === 'provider'
        ? byProvider
        : group === 'agent'
          ? byAgent
          : group === 'layer'
            ? byLayer
            : bySession;
    return Array.from(map.entries())
      .map(([key, bucket]) => ({ key, bucket }))
      .sort(
        (a, b) =>
          b.bucket.inputTokens +
          b.bucket.outputTokens -
          (a.bucket.inputTokens + a.bucket.outputTokens),
      );
  }, [byAgent, byProvider, bySession, byLayer, group]);

  const hasData = total.count > 0;

  if (!hasData) {
    return (
      <TabContainer
        title="用量 & 费用"
        subtitle="按 provider / agent / session / layer 维度聚合 token 与成本。"
      >
        <div style={CONTAINER_STYLE}>
          <SessionStatsPanel
            sessionId={selectedSessionId ?? null}
            sessionTitle={selectedSessionTitle ?? null}
          />
          <EmptyState
            emoji="🔋"
            title="暂无用量数据"
            description={
              <>
                用量数据来自 agent-gateway 的 stream usage 事件。
                <br />
                等待后端通过 team-events 推送 <code>team_usage</code> 事件， 前端{' '}
                <code>useTeamUsageStore.applyUsageEvent</code> 会自动累计。
              </>
            }
          />
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="用量 & 费用"
      subtitle="按 provider / agent / session / layer 维度聚合 token 与成本。"
    >
      <div style={CONTAINER_STYLE}>
        <SessionStatsPanel
          sessionId={selectedSessionId ?? null}
          sessionTitle={selectedSessionTitle ?? null}
        />
        <span style={SECTION_TITLE_STYLE}>总览</span>
        <MetricGrid>
          <StatCard label="调用次数" value={String(total.count)} />
          <StatCard label="输入 token" value={formatTokens(total.inputTokens)} />
          <StatCard label="输出 token" value={formatTokens(total.outputTokens)} />
          <StatCard label="缓存命中" value={formatTokens(total.cacheReadTokens)} />
          <StatCard label="缓存写入" value={formatTokens(total.cacheWriteTokens)} />
          <StatCard label="推理 token" value={formatTokens(total.reasoningTokens)} />
          <StatCard label="估算成本" value={formatCost(total.costUsd)} tone="accent" />
        </MetricGrid>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={SECTION_TITLE_STYLE}>分组明细</span>
          <span style={{ flex: 1 }} />
          <GroupBtn
            label="按 provider"
            active={group === 'provider'}
            onClick={() => {
              setGroup('provider');
              setExpandedLayer(null);
            }}
          />
          <GroupBtn
            label="按 agent"
            active={group === 'agent'}
            onClick={() => {
              setGroup('agent');
              setExpandedLayer(null);
            }}
          />
          <GroupBtn
            label="按 layer"
            active={group === 'layer'}
            onClick={() => setGroup('layer')}
          />
          <GroupBtn
            label="按 session"
            active={group === 'session'}
            onClick={() => {
              setGroup('session');
              setExpandedLayer(null);
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {groupedRows.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 12 }}>
              该维度暂无聚合数据。
            </div>
          ) : (
            groupedRows.map(({ key, bucket }) => {
              const drillable = group === 'layer';
              const expanded = drillable && expandedLayer === key;
              return (
                <div key={key} style={{ display: 'grid', gap: 4 }}>
                  <UsageRow
                    label={formatGroupKey(group, key)}
                    bucket={bucket}
                    {...(drillable
                      ? {
                          expanded,
                          onClick: () => setExpandedLayer((prev) => (prev === key ? null : key)),
                        }
                      : {})}
                  />
                  {expanded ? (
                    <LayerDrilldown
                      calls={recent.filter((event) => event.layer === key)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <span style={SECTION_TITLE_STYLE}>最近 {recent.length} 条调用</span>
        <div style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--fg-default)' }}>
          {recent
            .slice()
            .reverse()
            .slice(0, 20)
            .map((event, idx) => (
              <div
                key={`${event.timestamp}-${idx}`}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-overlay)',
                }}
              >
                <span style={{ minWidth: 90, color: 'var(--fg-muted)' }}>
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ minWidth: 90, color: 'var(--fg-default)' }}>
                  {event.provider ?? '—'}
                </span>
                <span style={{ minWidth: 80, color: 'var(--fg-default)' }}>
                  {event.model ?? ''}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  in {formatTokens(event.inputTokens)} · out {formatTokens(event.outputTokens)}
                </span>
              </div>
            ))}
        </div>
      </div>
    </TabContainer>
  );
}

function UsageRow({
  label,
  bucket,
  expanded,
  onClick,
}: {
  label: string;
  bucket: UsageBucket;
  expanded?: boolean;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  const content = (
    <>
      {interactive ? (
        <span style={{ color: 'var(--fg-muted)', fontSize: 10, flexShrink: 0 }}>
          {expanded ? '▼' : '▶'}
        </span>
      ) : null}
      <strong
        style={{
          minWidth: 140,
          color: 'var(--fg-strong)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={label}
      >
        {label}
      </strong>
      <span style={{ color: 'var(--fg-muted)' }}>{bucket.count} 次</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-default)' }}>
        in <strong style={{ color: 'var(--fg-strong)' }}>{formatTokens(bucket.inputTokens)}</strong>
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-default)' }}>
        out{' '}
        <strong style={{ color: 'var(--fg-strong)' }}>{formatTokens(bucket.outputTokens)}</strong>
      </span>
      {bucket.cacheReadTokens > 0 ? (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-muted)' }}>
          cache {formatTokens(bucket.cacheReadTokens)}
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      <span
        style={{
          color: 'var(--fg-strong)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatCost(bucket.costUsd)}
      </span>
    </>
  );

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 10,
    border: `1px solid ${CK_BORDER}`,
    background: CK_SURFACE,
    fontSize: 12,
    width: '100%',
    textAlign: 'left',
  };

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        className="team-card-soft"
        style={{ ...rowStyle, cursor: 'pointer' }}
      >
        {content}
      </button>
    );
  }

  return <div style={rowStyle}>{content}</div>;
}

/** 单层下钻：展示该层最近调用的 provider/model/token 明细。 */
function LayerDrilldown({ calls }: { calls: TeamUsageEvent[] }) {
  if (calls.length === 0) {
    return (
      <div style={{ padding: '6px 12px', marginLeft: 16, fontSize: 11, color: 'var(--fg-muted)' }}>
        该层暂无可下钻的调用明细。
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gap: 3,
        marginLeft: 16,
        padding: '6px 10px',
        borderRadius: 8,
        background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
        fontSize: 11,
        color: 'var(--fg-default)',
      }}
    >
      {calls
        .slice()
        .reverse()
        .slice(0, 12)
        .map((event, idx) => (
          <div key={`${event.timestamp}-${idx}`} style={{ display: 'flex', gap: 8 }}>
            <span style={{ minWidth: 78, color: 'var(--fg-muted)' }}>
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
            <span style={{ minWidth: 80, color: 'var(--fg-default)' }}>{event.provider ?? '—'}</span>
            <span style={{ minWidth: 90, color: 'var(--fg-default)' }}>{event.model ?? ''}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              in {formatTokens(event.inputTokens)} · out {formatTokens(event.outputTokens)}
            </span>
          </div>
        ))}
    </div>
  );
}

function GroupBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={active ? TAB_BTN_ACTIVE_STYLE : TAB_BTN_STYLE}>
      {label}
    </button>
  );
}
