import type { CSSProperties } from 'react';

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
