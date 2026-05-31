/**
 * 260530-team-page · content-kit · MiniBar
 *
 * 统一的"标签 + 进度条 + 数值"行，替换 OverviewTab 活动分布 / UsageView
 * 用量条等处复制的进度条结构。
 */

import type { CSSProperties, ReactNode } from 'react';

export interface MiniBarProps {
  label: ReactNode;
  /** 0–100 的百分比（内部 clamp）。 */
  percent: number;
  /** 条颜色，默认 accent。 */
  color?: string;
  /** 右侧数值文本（如 "12 次 (34%)"）。 */
  valueText?: ReactNode;
  /** 左侧可选图标节点。 */
  leading?: ReactNode;
  onClick?: () => void;
  /** 暗淡（未选中筛选项）。 */
  dimmed?: boolean;
}

const TRACK_STYLE: CSSProperties = {
  height: 5,
  borderRadius: 999,
  background: 'var(--border-subtle)',
  overflow: 'hidden',
};

export function MiniBar({
  label,
  percent,
  color = 'var(--accent)',
  valueText,
  leading,
  onClick,
  dimmed = false,
}: MiniBarProps) {
  const pct = Math.max(0, Math.min(100, percent));
  const interactive = Boolean(onClick);

  const content = (
    <>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
      >
        <span
          style={{
            display: 'flex',
            gap: 5,
            alignItems: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--fg-default)',
            minWidth: 0,
          }}
        >
          {leading}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
        </span>
        {valueText ? (
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', flexShrink: 0 }}>{valueText}</span>
        ) : null}
      </div>
      <div style={TRACK_STYLE}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 999,
            background: color,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </>
  );

  const baseStyle: CSSProperties = {
    display: 'grid',
    gap: 4,
    opacity: dimmed ? 0.5 : 1,
    transition: 'opacity 0.15s',
    minWidth: 0,
  };

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...baseStyle,
          background: 'none',
          border: 'none',
          padding: 0,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        {content}
      </button>
    );
  }

  return <div style={baseStyle}>{content}</div>;
}
