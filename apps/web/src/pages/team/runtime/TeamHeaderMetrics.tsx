/**
 * TeamHeaderMetrics · page-header 中部指标卡片
 *
 * 在 page-header 中显示当前工作区的关键指标：成员数 / 任务进度 /
 * 消息数 / handoff 数 / 运行中会话等。每个指标用紧凑徽章呈现，
 * 整行高度 ≤ 28px，hover 显示完整 tooltip。
 *
 * 数据源：来自 useTeamRuntimeReferenceViewData() 的 metricCards 字段
 * + handoffs store。
 */

import type { CSSProperties } from 'react';
import type { AgentTeamsMetricCard } from './team-runtime-types.js';

export interface TeamHeaderMetricsProps {
  /** 来自 reference data context 的 metricCards 数组（成员/任务/汇报）。 */
  metrics: AgentTeamsMetricCard[];
  /** 当前活跃的 handoff 数（来自 useHandoffStore）。 */
  activeHandoffCount?: number;
  /** 当前运行中的 session 数。 */
  runningSessionCount?: number;
}

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 0,
  margin: 0,
  flexShrink: 0,
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 9px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border) 45%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 60%, transparent)',
  color: 'var(--text-2)',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
  cursor: 'default',
  transition: 'background 150ms ease, border-color 150ms ease',
};

const VALUE_STYLE: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text)',
  fontWeight: 700,
};

const LABEL_STYLE: CSSProperties = {
  color: 'var(--text-3)',
  fontSize: 10,
};

const ICON_STYLE: CSSProperties = {
  flexShrink: 0,
  opacity: 0.85,
};

const HIGHLIGHT_STYLE: CSSProperties = {
  ...CHIP_STYLE,
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
  color: 'var(--accent)',
};

function MetricIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'members':
      return (
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={ICON_STYLE}
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'tasks':
      return (
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={ICON_STYLE}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'conversation':
      return (
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={ICON_STYLE}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'handoff':
      return (
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={ICON_STYLE}
        >
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
      );
    case 'running':
      return (
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={ICON_STYLE}
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    default:
      return null;
  }
}

export function TeamHeaderMetrics({
  metrics,
  activeHandoffCount,
  runningSessionCount,
}: TeamHeaderMetricsProps) {
  return (
    <div style={ROW_STYLE} aria-label="工作区指标">
      {metrics.map((metric) => (
        <span key={metric.icon} style={CHIP_STYLE} title={`${metric.label}: ${metric.value}`}>
          <MetricIcon kind={metric.icon} />
          <span style={VALUE_STYLE}>{metric.value}</span>
          <span style={LABEL_STYLE}>{metric.label}</span>
        </span>
      ))}
      {typeof runningSessionCount === 'number' && runningSessionCount > 0 ? (
        <span style={HIGHLIGHT_STYLE} title={`运行中会话：${runningSessionCount}`}>
          <MetricIcon kind="running" />
          <span style={VALUE_STYLE}>{runningSessionCount}</span>
          <span style={LABEL_STYLE}>运行</span>
        </span>
      ) : null}
      {typeof activeHandoffCount === 'number' && activeHandoffCount > 0 ? (
        <span style={HIGHLIGHT_STYLE} title={`活跃 Handoff：${activeHandoffCount}`}>
          <MetricIcon kind="handoff" />
          <span style={VALUE_STYLE}>{activeHandoffCount}</span>
          <span style={LABEL_STYLE}>派发</span>
        </span>
      ) : null}
    </div>
  );
}
