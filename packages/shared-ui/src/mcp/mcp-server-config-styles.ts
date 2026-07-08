import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export const inputBase: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 'var(--radius-sm, 6px)',
  boxSizing: 'border-box',
  color: 'var(--fg-default)',
  fontSize: 12,
  padding: 'var(--spacing-1, 4px) var(--spacing-2, 8px)',
  width: '100%',
};

export const mcpServerConfigFocusVisibleCss = `
[data-openawork-mcp-server-config] :where(input, select, textarea, button, summary):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}

[data-openawork-mcp-server-config] [data-mcp-danger-action]:focus-visible {
  outline-color: var(--complement);
  box-shadow: 0 0 0 4px var(--complement-subtle);
}
`;

export const lockedInputStyle: CSSProperties = {
  ...inputBase,
  background: 'var(--bg-surface)',
  color: 'var(--fg-muted)',
};

export const labelStyle: CSSProperties = {
  color: 'var(--fg-muted)',
  display: 'block',
  fontSize: 12,
  marginBottom: 'var(--spacing-1, 4px)',
};

export const badgeStyle: CSSProperties = {
  border: '1px solid var(--accent-border)',
  borderRadius: 'var(--radius-pill, 9999px)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.4,
  padding: '1px 7px',
};

export const dangerButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm, 6px)',
  color: color.danger,
  cursor: 'pointer',
  fontSize: 12,
  padding: 'var(--spacing-1, 4px) var(--spacing-2, 8px)',
};

export const secondaryButtonStyle: CSSProperties = {
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 'var(--radius-sm, 6px)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  padding: 'var(--spacing-1, 4px) var(--spacing-3, 12px)',
};

export const panelStyle: CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 'var(--radius-lg, 12px)',
  fontFamily: 'system-ui, sans-serif',
  overflow: 'hidden',
};

export const headerStyle: CSSProperties = {
  borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  padding: 'var(--spacing-4, 16px) var(--spacing-6, 24px)',
};

export const gridStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-2, 8px)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
};
