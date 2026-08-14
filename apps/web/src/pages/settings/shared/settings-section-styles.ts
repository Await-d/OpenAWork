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

// 输入框样式 - 增强可读性
export const IS: CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
};

// Section 容器样式 - 优化间距
export const SS: CSSProperties = {
  marginBottom: '16px',
  padding: '12px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  borderBottom: '1px solid var(--border-invisible)',
};

// Section 标题样式 - 增强可读性
export const ST: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-strong)',
  letterSpacing: '0.02em',
  marginBottom: '4px',
};

// Primary Button 样式 - 清晰可见
export const BP: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
};

// Secondary Button 样式 - 清晰可见
export const BS: CSSProperties = {
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
};

// Ghost Button 样式 - 次要操作
export const BG: CSSProperties = {
  background: 'transparent',
  color: 'var(--fg-default)',
  border: '1px solid transparent',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 400,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
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

// 标签 Badge 样式 - 增强可读性
export const BADGE: CSSProperties = {
  borderRadius: 4,
  padding: '2px 6px',
  fontSize: 11,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
};

// 卡片样式 - 增强呼吸感
export const CARD: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  padding: '12px',
  background: 'var(--bg-overlay)',
};

// 面板样式 - 增强呼吸感
export const PANEL: CSSProperties = {
  borderRadius: 6,
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-subtle)',
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

// 搜索输入框样式 - 增强可读性
export const SEARCH_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 140,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
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
  gap: 16,
  alignItems: 'flex-start',
};

// 左侧面板（列表）
export const LEFT_PANEL: CSSProperties = {
  flex: '1 1 45%',
  minWidth: 280,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

// 右侧面板（详情）
export const RIGHT_PANEL: CSSProperties = {
  flex: '1 1 45%',
  minWidth: 280,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

// 列表容器 - 限制高度，允许滚动
export const LIST_CONTAINER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 400,
  overflowY: 'auto',
  padding: '4px',
};
