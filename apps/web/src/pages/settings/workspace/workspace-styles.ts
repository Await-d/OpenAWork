import type { CSSProperties } from 'react';

/**
 * workspace 设置页共享样式常量。
 *
 * 只收纳 `workspace-tab-content.tsx` 与 `system-desktop-control-card.tsx` 中
 * **逐值完全一致**的常量（避免仅差一个数字的样式被强行合并成错误的统一值）；
 * 有差异的样式（DASHED_CARD / BADGE / ACTIVE_BADGE / DANGER_BTN）仍留在各自文件内。
 */

export const WORKSPACE_CARD: CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
  padding: '8px 10px',
};

export const WORKSPACE_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

export const WORKSPACE_SECTION_TITLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  margin: 0,
  lineHeight: 1.3,
  letterSpacing: '0.01em',
};

export const WORKSPACE_SECTION_SUB: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  margin: 0,
  marginTop: 2,
  lineHeight: 1.4,
};

export const WORKSPACE_ACTION_BTN: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  fontSize: 10,
  fontWeight: 600,
  padding: '4px 9px',
  cursor: 'pointer',
  lineHeight: 1.4,
};

export const WORKSPACE_GHOST_BTN: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 10,
  padding: '4px 8px',
  cursor: 'pointer',
  lineHeight: 1.4,
};

export const WORKSPACE_FIELD_INPUT: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-base) 70%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  fontSize: 10,
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
