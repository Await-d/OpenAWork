import type { CSSProperties } from 'react';

export const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minHeight: 0,
  flex: 1,
  overflow: 'hidden',
};

export const FLOW_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'flex-start',
  gap: 12,
  padding: '12px 16px',
  borderRadius: 'var(--radius-lg, 12px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base)) 0%, color-mix(in srgb, var(--bg-base) 96%, transparent) 100%)',
  flexShrink: 0,
  boxShadow: 'var(--shadow-sm)',
};

export const PIPELINE_SCROLL_STYLE: CSSProperties = {
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  paddingBottom: 2,
};

export const FLOW_DENSITY_TOGGLE_STYLE: CSSProperties = {
  alignSelf: 'start',
};

export const NARROW_FLOW_DENSITY_TOGGLE_STYLE: CSSProperties = {
  ...FLOW_DENSITY_TOGGLE_STYLE,
  justifySelf: 'end',
};

export const SPLIT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr)',
  gap: 14,
  overflow: 'hidden',
};

export const TIMELINE_PANEL_STYLE: CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: 'var(--radius-lg, 12px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
};

export const DETAIL_TOOLBAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
  flexShrink: 0,
  minHeight: 44,
};

export const DETAIL_PANE_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 'var(--radius-lg, 12px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
};

export const DETAIL_BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

export const CONVERSATION_WRAPPER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
};
