import type { CSSProperties } from 'react';

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

export const IS: CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
};

export const SS: CSSProperties = {
  marginBottom: '1rem',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 12,
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.625rem',
};

export const ST: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--fg-muted)',
};

export const BP: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};
