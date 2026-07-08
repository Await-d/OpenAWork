import type { CSSProperties } from 'react';

export const COMPACT_CJK_LABEL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  whiteSpace: 'nowrap',
  wordBreak: 'keep-all',
  overflowWrap: 'normal',
  flexShrink: 0,
};

export const ROLE_SHORT_LABEL_STYLE: CSSProperties = {
  ...COMPACT_CJK_LABEL_STYLE,
  minWidth: '2.4em',
};

export const HANDOFF_ROUTE_CHIP_STYLE: CSSProperties = {
  ...COMPACT_CJK_LABEL_STYLE,
  gap: 4,
  maxWidth: '100%',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export const STATE_COLOR: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--accent)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};
