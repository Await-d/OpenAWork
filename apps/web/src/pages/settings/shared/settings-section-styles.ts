import type { CSSProperties } from 'react';

// 共享 UI 变量映射
export const UV: CSSProperties = {
  '--color-surface': 'var(--bg-overlay)',
  '--color-surface-raised': 'var(--bg-overlay)',
  '--color-border': 'var(--border-default)',
  '--color-border-subtle': 'var(--border-subtle)',
  '--color-text': 'var(--fg-strong)',
  '--color-text-secondary': 'var(--fg-default)',
  '--color-muted': 'var(--fg-muted)',
  '--color-accent': 'var(--accent)',
  '--color-accent-muted': 'var(--accent-muted)',
  '--color-bg': 'var(--bg-base)',
  '--color-background': 'var(--bg-base)',
  '--color-foreground': 'var(--fg-strong)',
  '--color-primary': 'var(--accent)',
  '--color-primary-foreground': 'var(--fg-on-accent)',
} as CSSProperties;

// 输入框样式 - 极简
export const IS: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 3,
  padding: '3px 6px',
  color: 'var(--fg-strong)',
  fontSize: 11,
  outline: 'none',
};

// Section 容器样式 - 极简
export const SS: CSSProperties = {
  marginBottom: '2px',
  padding: '6px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

// Section 标题样式 - 极简
export const ST: CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--fg-muted)',
  letterSpacing: '0.04em',
};

// Primary Button 样式 - 清晰可见
export const BP: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  border: 'none',
  borderRadius: 3,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

// Secondary Button 样式 - 清晰可见
export const BS: CSSProperties = {
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

// Ghost Button 样式 - 次要操作
export const BG: CSSProperties = {
  background: 'transparent',
  color: 'var(--fg-default)',
  border: '1px solid transparent',
  borderRadius: 3,
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 400,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

// Danger Button 样式 - 危险操作
export const BD: CSSProperties = {
  background: 'var(--danger)',
  color: 'var(--fg-on-accent)',
  border: 'none',
  borderRadius: 3,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

// 标签 Badge 样式 - 极简
export const BADGE: CSSProperties = {
  borderRadius: 2,
  padding: '0 4px',
  fontSize: 10,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
};

// 卡片样式 - 极简
export const CARD: CSSProperties = {
  borderRadius: 3,
  border: '1px solid var(--border-subtle)',
  padding: '4px 6px',
};

// 面板样式 - 极简
export const PANEL: CSSProperties = {
  borderRadius: 3,
  padding: '4px 6px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
};

// 分隔线样式 - 极简
export const DIVIDER: CSSProperties = {
  width: 1,
  height: 12,
  background: 'var(--border-subtle)',
  flexShrink: 0,
};

// 工具栏容器样式 - 极简
export const TOOLBAR: CSSProperties = {
  display: 'flex',
  gap: 3,
  flexWrap: 'wrap',
  alignItems: 'center',
};

// 搜索输入框样式 - 极简
export const SEARCH_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 120,
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 3,
  padding: '3px 6px',
  color: 'var(--fg-strong)',
  fontSize: 11,
  outline: 'none',
};

// 详情预览样式 - 限制高度
export const CODE_BLOCK: CSSProperties = {
  margin: 0,
  padding: '4px 6px',
  borderRadius: 2,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  fontSize: 10,
  fontFamily: 'monospace',
  lineHeight: 1.3,
  color: 'var(--fg-default)',
  overflowX: 'auto',
  maxHeight: 120,
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

// 两栏布局容器
export const TWO_COLUMN: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'flex-start',
};

// 左侧面板（列表）
export const LEFT_PANEL: CSSProperties = {
  flex: '1 1 45%',
  minWidth: 200,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

// 右侧面板（详情）
export const RIGHT_PANEL: CSSProperties = {
  flex: '1 1 45%',
  minWidth: 200,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

// 列表容器 - 限制高度，允许滚动
export const LIST_CONTAINER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 300,
  overflowY: 'auto',
};
