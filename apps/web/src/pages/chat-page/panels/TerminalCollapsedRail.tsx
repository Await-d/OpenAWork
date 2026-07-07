/**
 * TerminalCollapsedRail — 终端面板折叠态窄条 (36px)。
 *
 * 横跨底部全宽，显示：[▸] 终端 · N 个运行中 · 最后输出 &nbsp;&nbsp; [▴]
 */

import type { CSSProperties } from 'react';

export interface TerminalCollapsedRailProps {
  readonly activeTerminalCount: number;
  readonly lastOutput?: string | null;
  readonly onExpand: () => void;
}

const RAIL_STYLE: CSSProperties = {
  height: 36,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  borderRadius: 0,
  border: 'none',
  borderTop: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
  cursor: 'pointer',
  transition: 'border-color 100ms ease',
};

const INFO_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--fg-muted)',
  flex: 1,
  minWidth: 0,
};

const BADGE_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 9999,
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
  flexShrink: 0,
};

const OUTPUT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1,
  minWidth: 0,
};

export function TerminalCollapsedRail({
  activeTerminalCount,
  lastOutput,
  onExpand,
}: TerminalCollapsedRailProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      title="展开终端面板"
      aria-label="展开终端面板"
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand();
        }
      }}
      style={RAIL_STYLE}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-emphasis)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      <div style={INFO_STYLE}>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span style={{ fontWeight: 600 }}>终端</span>
        {activeTerminalCount > 0 && <span style={BADGE_STYLE}>{activeTerminalCount} 个运行中</span>}
        {lastOutput && <span style={OUTPUT_STYLE}>{lastOutput}</span>}
      </div>
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, color: 'var(--fg-muted)' }}
      >
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </div>
  );
}
