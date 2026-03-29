export const tokens = {
  color: {
    bg: '#0a0f1e',
    surface: '#111827',
    surface2: '#1a2235',
    surfaceGlass: 'rgba(17,24,39,0.8)',
    border: '#1e2d3d',
    borderSubtle: 'rgba(123, 132, 146, 0.18)',
    text: '#f1f5f9',
    muted: '#64748b',
    accent: 'var(--color-accent, #656d7a)',
    accentHover: 'var(--color-accent-hover, #7b8492)',
    success: '#10b981',
    warning: 'var(--color-warning, #a88a3c)',
    danger: '#ef4444',
    info: '#3b82f6',
  },
  radius: { sm: 6, md: 10, lg: 16, xl: 24 },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.4)',
    md: '0 4px 16px rgba(0,0,0,0.5)',
    lg: '0 8px 32px rgba(0,0,0,0.6)',
    glass: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
  },
  blur: { sm: 'blur(8px)', md: 'blur(16px)', lg: 'blur(24px)' },
  spacing: { rail: 48, panel: 260, topbar: 48 },
} as const;
export type Tokens = typeof tokens;
