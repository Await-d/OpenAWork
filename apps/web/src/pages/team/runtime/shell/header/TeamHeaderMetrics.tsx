/**
 * TeamHeaderMetrics · page-header 中部指标卡片
 *
 * 紧凑展示当前工作区的关键指标。设计原则：
 * - 把「成员 / 任务 / 汇报」3 个低优先级数字合并到一个 split-pill 里，
 *   减少视觉碎片
 * - 把「运行中会话 / 活跃 Handoff」做成显眼的 accent 状态徽章
 *   （仅在 > 0 时出现），它们才是用户最关心的实时数据
 * - 整行高度 ≤ 28px，hover 显示完整说明
 *
 * 数据源：useTeamRuntimeReferenceViewData().metricCards + handoff store
 */

import type { CSSProperties } from 'react';
import type { AgentTeamsMetricCard } from '../../data/team-runtime-types.js';

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
  gap: 8,
  padding: 0,
  margin: 0,
  flexShrink: 0,
};

// ─── 合并 pill：成员 / 任务 / 汇报 ─────────────
const SPLIT_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 4px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 45%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 60%, transparent)',
  fontSize: 11,
  lineHeight: 1.2,
  cursor: 'default',
};

const SPLIT_CELL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 8px',
  color: 'var(--text-2)',
};

const SPLIT_DIVIDER_STYLE: CSSProperties = {
  width: 1,
  height: 12,
  background: 'color-mix(in srgb, var(--border) 50%, transparent)',
  flexShrink: 0,
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

// ─── accent 高亮徽章：运行 / 派发 ─────────────
const ACTIVITY_BADGE_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
  cursor: 'default',
};

const RUNNING_BADGE_STYLE: CSSProperties = {
  ...ACTIVITY_BADGE_BASE,
  background: 'color-mix(in srgb, var(--success, var(--success, var(--success, #3dd49a))) 14%, transparent)',
  color: 'var(--success, var(--success, var(--success, #3dd49a)))',
  border: '1px solid color-mix(in srgb, var(--success, var(--success, var(--success, #3dd49a))) 35%, transparent)',
};

const HANDOFF_BADGE_STYLE: CSSProperties = {
  ...ACTIVITY_BADGE_BASE,
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  color: 'var(--accent)',
  border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
};

const ICON_STYLE: CSSProperties = {
  flexShrink: 0,
  opacity: 0.85,
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
        <span
          aria-hidden="true"
          style={{
            ...ICON_STYLE,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'currentColor',
            boxShadow: '0 0 0 3px color-mix(in srgb, currentColor 22%, transparent)',
            display: 'inline-block',
          }}
        />
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
      {/* 显眼实时状态：仅在有数据时出现 */}
      {typeof runningSessionCount === 'number' && runningSessionCount > 0 ? (
        <span style={RUNNING_BADGE_STYLE} title={`${runningSessionCount} 个会话正在运行`}>
          <MetricIcon kind="running" />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{runningSessionCount}</span>
          <span style={{ fontWeight: 500, opacity: 0.85 }}>运行</span>
        </span>
      ) : null}
      {typeof activeHandoffCount === 'number' && activeHandoffCount > 0 ? (
        <span style={HANDOFF_BADGE_STYLE} title={`${activeHandoffCount} 个 Handoff 正在派发`}>
          <MetricIcon kind="handoff" />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{activeHandoffCount}</span>
          <span style={{ fontWeight: 500, opacity: 0.85 }}>派发</span>
        </span>
      ) : null}

      {/* 静态指标合并 split-pill */}
      {metrics.length > 0 ? (
        <span style={SPLIT_PILL_STYLE}>
          {metrics.map((metric, i) => (
            <span key={metric.icon} style={{ display: 'inline-flex' }}>
              {i > 0 ? <span style={SPLIT_DIVIDER_STYLE} /> : null}
              <span style={SPLIT_CELL_STYLE} title={`${metric.label}: ${metric.value}`}>
                <MetricIcon kind={metric.icon} />
                <span style={VALUE_STYLE}>{metric.value}</span>
                <span style={LABEL_STYLE}>{metric.label}</span>
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
