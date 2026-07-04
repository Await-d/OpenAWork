import type { CSSProperties } from 'react';

const SIDEBAR_WIDTH = 260;
const COLLAPSED_WIDTH = 56;

export const truncateStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const labelStyle: CSSProperties = { ...truncateStyle, fontSize: 12, fontWeight: 600 };
export const navStyle: CSSProperties = { display: 'grid', gap: 10, padding: '0 8px' };

export const sectionTitleStyle: CSSProperties = {
  color: 'var(--fg-subtle)',
  fontSize: 10,
  fontWeight: 800,
  padding: '0 8px',
  textTransform: 'uppercase',
};

export const sectionHeaderStyle: CSSProperties = {
  alignItems: 'center',
  color: 'var(--fg-muted)',
  display: 'flex',
  fontSize: 11,
  fontWeight: 700,
  gap: 8,
  minWidth: 0,
  padding: '4px 6px',
};

export const sessionHeaderStyle: CSSProperties = {
  ...sectionHeaderStyle,
  justifyContent: 'space-between',
};

export const runningDotStyle: CSSProperties = {
  background: 'var(--success)',
  borderRadius: '50%',
  boxShadow: '0 0 6px var(--success)',
  flexShrink: 0,
  height: 7,
  width: 7,
};

export const errorStyle: CSSProperties = {
  color: 'var(--danger)',
  fontSize: 11,
  padding: '4px 6px',
};

export const iconButtonStyle: CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  color: 'var(--fg-default)',
  cursor: 'pointer',
  height: 22,
  width: 22,
};

export const miniButtonStyle: CSSProperties = { ...iconButtonStyle, fontSize: 11, width: 42 };
export const footerButtonStyle: CSSProperties = { ...iconButtonStyle, height: 30, width: 30 };

export const sessionPanelStyle: CSSProperties = {
  borderTop: '1px solid var(--border-subtle)',
  display: 'grid',
  flex: 1,
  gap: 6,
  minHeight: 0,
  overflow: 'auto',
  padding: '8px',
};

export const footerStyle: CSSProperties = {
  alignItems: 'center',
  borderTop: '1px solid var(--border-subtle)',
  display: 'flex',
  gap: 6,
  justifyContent: 'center',
  padding: 8,
};

export const logoStyle: CSSProperties = {
  alignItems: 'center',
  background: 'var(--accent)',
  borderRadius: 8,
  color: 'var(--fg-on-accent)',
  display: 'inline-flex',
  fontSize: 13,
  fontWeight: 900,
  height: 24,
  justifyContent: 'center',
  width: 24,
};

export function sidebarStyle(collapsed: boolean): CSSProperties {
  return {
    background: 'var(--bg-raised)',
    borderRight: '1px solid var(--border-default)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 8,
    height: '100%',
    overflow: 'hidden',
    transition: 'width 200ms ease',
    width: collapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH,
  };
}

export function brandStyle(collapsed: boolean): CSSProperties {
  return {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    minHeight: 42,
    padding: collapsed ? '8px 16px' : '8px 12px',
  };
}

export function rowStyle(active: boolean, collapsed: boolean): CSSProperties {
  return {
    alignItems: 'center',
    background: active ? 'var(--accent-subtle)' : 'transparent',
    border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
    borderRadius: 8,
    color: active ? 'var(--accent)' : 'var(--fg-muted)',
    display: 'flex',
    gap: 8,
    justifyContent: collapsed ? 'center' : 'flex-start',
    minHeight: 34,
    padding: collapsed ? 0 : '0 10px',
    textDecoration: 'none',
  };
}

export function sessionRowStyle(active: boolean): CSSProperties {
  return {
    ...rowStyle(active, false),
    cursor: 'pointer',
    fontSize: 12,
    justifyContent: 'space-between',
    width: '100%',
  };
}
