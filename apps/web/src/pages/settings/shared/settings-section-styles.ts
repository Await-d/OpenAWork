import type { CSSProperties } from 'react';

export const UV: CSSProperties = {
  '--color-surface': 'var(--surface)',
  '--color-surface-raised': 'var(--bg-2)',
  '--color-border': 'var(--border)',
  '--color-border-subtle': 'var(--border-subtle)',
  '--color-text': 'var(--text)',
  '--color-text-secondary': 'var(--text-2)',
  '--color-muted': 'var(--text-3)',
  '--color-accent': 'var(--accent)',
  '--color-accent-muted': 'var(--accent-muted)',
  '--color-bg': 'var(--bg)',
  '--color-background': 'var(--bg)',
  '--color-foreground': 'var(--text)',
  '--color-primary': 'var(--accent)',
  '--color-primary-foreground': 'var(--accent-text)',
} as CSSProperties;

export const IS: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
};

export const SS: CSSProperties = {
  marginBottom: '1rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
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
  color: 'var(--text-3)',
};

export const BP: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};
