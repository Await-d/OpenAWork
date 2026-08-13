/**
 * 260530-team-page · content-kit · StatCard
 *
 * 统一指标卡，替换 UsageView / TimingView / HealthView / OverviewTab 中各自
 * 手搓的 StatCard / UsageCard。
 *
 *   ┌───────────────────────────┐
 *   │ [icon] 标签        [trend] │   ← 头部（可选 icon / trend）
 *   │ 26.2k                      │   ← 值（大号）
 *   │ 补充说明                   │   ← note（可选）
 *   └───────────────────────────┘
 *
 * 设计原则：纯展示原子，不感知具体 tab。可点击（onClick）时整卡变按钮，
 * 用于"下钻单层详情"等场景。
 */

import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconKey } from '../TeamIcons.js';
import {
  CK_BORDER,
  CK_SURFACE,
  CK_RADIUS,
  ckToneColor,
  type CkTone,
} from './content-kit-tokens.js';

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** 值的语义色，默认中性。 */
  tone?: CkTone;
  /** 可选左侧图标。 */
  icon?: IconKey;
  /** 可选补充说明（值下方一行小字）。 */
  note?: ReactNode;
  /** 可选趋势标记（右上角箭头）。 */
  trend?: 'up' | 'down' | 'stable';
  /** 可点击时整卡变按钮（下钻）。 */
  onClick?: () => void;
  /** 选中态（下钻当前层时高亮）。 */
  active?: boolean;
  /** 左侧 accent 竖条（默认 false）。 */
  accentBar?: boolean;
}

const TREND_META: Record<'up' | 'down' | 'stable', { color: string; icon: IconKey }> = {
  up: { color: 'var(--success)', icon: 'trend-up' },
  down: { color: 'var(--danger)', icon: 'trend-down' },
  stable: { color: 'var(--fg-muted)', icon: 'trend-stable' },
};

const BASE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: CK_RADIUS,
  border: `1px solid ${CK_BORDER}`,
  background: CK_SURFACE,
  textAlign: 'left',
  width: '100%',
  minWidth: 0,
};

export function StatCard({
  label,
  value,
  tone = 'default',
  icon,
  note,
  trend,
  onClick,
  active = false,
  accentBar = false,
}: StatCardProps) {
  const trendMeta = trend ? TREND_META[trend] : null;
  const interactive = Boolean(onClick);

  const style: CSSProperties = {
    ...BASE_STYLE,
    ...(accentBar
      ? {
          border: '1px solid var(--border-default)',
          background: 'white',
          boxShadow: 'var(--shadow-md)',
        }
      : {}),
    ...(active
      ? {
          borderColor: 'color-mix(in srgb, var(--accent) 55%, transparent)',
          boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent)',
        }
      : {}),
    ...(interactive ? { cursor: 'pointer' } : {}),
  };

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--fg-muted)',
        fontSize: 11,
      }}
    >
      {icon ? <Icon name={icon} size={12} color="var(--accent)" /> : null}
      <span style={{ fontWeight: 600, color: 'var(--fg-default)', minWidth: 0 }}>{label}</span>
      {trendMeta ? (
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
          <Icon name={trendMeta.icon} size={11} color={trendMeta.color} />
        </span>
      ) : null}
    </div>
  );

  const body = (
    <>
      {header}
      <span
        style={{
          fontSize: 22,
          lineHeight: 1.15,
          fontWeight: 800,
          color: ckToneColor(tone),
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      {note ? (
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.4 }}>{note}</span>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="team-card-soft"
        data-active={active || undefined}
        aria-pressed={active}
        style={style}
      >
        {body}
      </button>
    );
  }

  return <div style={style}>{body}</div>;
}
