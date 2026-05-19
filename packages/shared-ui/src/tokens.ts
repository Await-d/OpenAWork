/**
 * OpenAWork Design Tokens — E · Nebula
 *
 * 所有组件必须通过此文件引用设计 token，禁止硬编码色值/间距/圆角。
 * 详细规范见 packages/shared-ui/DESIGN-TOKENS.md
 */

// ── 色彩体系 ──────────────────────────────────────────────

export const color = {
  // 表面层级
  bgBase: 'var(--bg-base, #080b12)',
  bgRaised: 'var(--bg-raised, #0d1119)',
  bgOverlay: 'var(--bg-overlay, #121721)',
  bgSurface: 'var(--bg-surface, #171d29)',
  bgElevated: 'var(--bg-elevated, #1d2535)',
  bgHover: 'var(--bg-hover, #232d40)',
  bgActive: 'var(--bg-active, #2a3650)',

  // 文字层级
  fgStrong: 'var(--fg-strong, #f1f4f8)',
  fgDefault: 'var(--fg-default, #c8d1e0)',
  fgMuted: 'var(--fg-muted, #7b8a9e)',
  fgSubtle: 'var(--fg-subtle, #4d5b6e)',
  fgOnAccent: 'var(--fg-on-accent, #052e22)',
  fgOnContrast: 'var(--fg-on-contrast, #1f1200)',
  fgOnComplement: 'var(--fg-on-complement, #1f0508)',

  // 主强调色: 靛青
  accent: 'var(--accent, #5cd4c0)',
  accentHover: 'var(--accent-hover, #72e0ce)',
  accentActive: 'var(--accent-active, #4ac4b0)',
  accentMuted: 'var(--accent-muted, rgba(92, 212, 192, 0.14))',
  accentSubtle: 'var(--accent-subtle, rgba(92, 212, 192, 0.07))',
  accentBorder: 'var(--accent-border, rgba(92, 212, 192, 0.30))',

  // 对比色: 琥珀
  contrast: 'var(--contrast, #f0b429)',
  contrastHover: 'var(--contrast-hover, #f5c84d)',
  contrastMuted: 'var(--contrast-muted, rgba(240, 180, 41, 0.14))',
  contrastSubtle: 'var(--contrast-subtle, rgba(240, 180, 41, 0.07))',
  contrastBorder: 'var(--contrast-border, rgba(240, 180, 41, 0.30))',

  // 互补色: 珊瑚
  complement: 'var(--complement, #f06b7e)',
  complementHover: 'var(--complement-hover, #f5919f)',
  complementMuted: 'var(--complement-muted, rgba(240, 107, 126, 0.14))',
  complementSubtle: 'var(--complement-subtle, rgba(240, 107, 126, 0.07))',
  complementBorder: 'var(--complement-border, rgba(240, 107, 126, 0.30))',

  // 辅助色: 靛蓝
  aux: 'var(--aux, #8b9cf5)',
  auxHover: 'var(--aux-hover, #a8b5fc)',
  auxMuted: 'var(--aux-muted, rgba(139, 156, 245, 0.14))',
  auxSubtle: 'var(--aux-subtle, rgba(139, 156, 245, 0.07))',
  auxBorder: 'var(--aux-border, rgba(139, 156, 245, 0.30))',

  // 语义色
  success: 'var(--success, #3dd49a)',
  successMuted: 'var(--success-muted, rgba(61, 212, 154, 0.14))',
  successBorder: 'var(--success-border, rgba(61, 212, 154, 0.30))',
  warning: 'var(--warning, #f0b429)',
  warningMuted: 'var(--warning-muted, rgba(240, 180, 41, 0.14))',
  warningBorder: 'var(--warning-border, rgba(240, 180, 41, 0.30))',
  danger: 'var(--danger, #f06b7e)',
  dangerMuted: 'var(--danger-muted, rgba(240, 107, 126, 0.14))',
  dangerBorder: 'var(--danger-border, rgba(240, 107, 126, 0.30))',
  info: 'var(--info, #8b9cf5)',
  infoMuted: 'var(--info-muted, rgba(139, 156, 245, 0.14))',
  infoBorder: 'var(--info-border, rgba(139, 156, 245, 0.30))',

  // 线条层级
  borderInvisible: 'var(--border-invisible, hsla(215, 20%, 50%, 0.03))',
  borderSubtle: 'var(--border-subtle, hsla(215, 20%, 50%, 0.07))',
  borderDefault: 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderEmphasis: 'var(--border-emphasis, hsla(215, 16%, 55%, 0.20))',
  borderStrong: 'var(--border-strong, hsla(215, 14%, 60%, 0.30))',
} as const;

// ── 间距系统 ──────────────────────────────────────────────

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
  // 布局常量
  rail: 220,
  topbar: 56,
  pageMax: 1100,
} as const;

// ── 圆角 ──────────────────────────────────────────────────

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

// ── 阴影 ──────────────────────────────────────────────────

export const shadow = {
  sm: '0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.02)',
  md: '0 2px 4px rgba(0,0,0,0.2), 0 8px 24px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.02)',
  lg: '0 4px 8px rgba(0,0,0,0.2), 0 24px 56px -16px rgba(0,0,0,0.5)',
  glow: '0 0 16px -4px rgba(92, 212, 192, 0.25)',
  accent: '0 4px 16px -6px rgba(92, 212, 192, 0.20), inset 0 1px 0 rgba(255,255,255,0.06)',
} as const;

// ── 动效 ──────────────────────────────────────────────────

export const motion = {
  micro: { duration: '100ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  normal: { duration: '200ms', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  emphasis: { duration: '350ms', easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
} as const;

// ── 字体 ──────────────────────────────────────────────────

export const font = {
  sans: "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

// ── 图表配色 ──────────────────────────────────────────────

export const chart = {
  1: 'var(--chart-1, #5cd4c0)',
  2: 'var(--chart-2, #f0b429)',
  3: 'var(--chart-3, #8b9cf5)',
  4: 'var(--chart-4, #f06b7e)',
  5: 'var(--chart-5, #c4b5fd)',
  6: 'var(--chart-6, #86efac)',
  7: 'var(--chart-7, #67e8f9)',
  8: 'var(--chart-8, #fda4af)',
} as const;

// ── 语法高亮 ──────────────────────────────────────────────

export const highlight = {
  keyword: 'var(--hl-keyword, #8b9cf5)',
  function: 'var(--hl-function, #5cd4c0)',
  type: 'var(--hl-type, #f0b429)',
  string: 'var(--hl-string, #86efac)',
  number: 'var(--hl-number, #fda4af)',
  comment: 'var(--hl-comment, #4d5b6e)',
} as const;

// ── 向后兼容导出 ──────────────────────────────────────────
// 旧代码通过 tokens.color.xxx 访问，保持兼容

export const tokens = {
  color: {
    bg: color.bgBase,
    surface: color.bgOverlay,
    surface2: color.bgSurface,
    surfaceGlass: color.bgOverlay,
    border: color.borderDefault,
    borderSubtle: color.borderSubtle,
    text: color.fgStrong,
    muted: color.fgMuted,
    accent: color.accent,
    accentHover: color.accentHover,
    success: color.success,
    warning: color.warning,
    danger: color.danger,
    info: color.info,
  },
  radius: { sm: radius.sm, md: radius.md, lg: radius.lg, xl: radius.xl },
  shadow,
  blur: { sm: 'blur(8px)', md: 'blur(16px)', lg: 'blur(24px)' },
  spacing: {
    xxs: 2,
    xs: spacing[1],
    sm: spacing[2],
    md: spacing[3],
    lg: spacing[4],
    xl: spacing[6],
    rail: spacing.rail,
    panel: 260,
    topbar: spacing.topbar,
  },
} as const;

export type Tokens = typeof tokens;
