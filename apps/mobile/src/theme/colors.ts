/**
 * Mobile design system color tokens.
 * Extracted from designs/mobile-ui.pen — light theme.
 */
export const colors = {
  /* ── Background ─────────────────────────────────────────── */
  bgBase: '#F5F7FB',

  /* ── Surface layers (lightest → deepest) ────────────────── */
  surface1: '#FFFFFF',
  surface2: '#EEF2F8',
  surface3: '#E7ECF6',
  surfaceSoft: '#F1F4FA',
  surfaceGlass: '#FFFFFFD9',

  /* ── Text ───────────────────────────────────────────────── */
  textStrong: '#161A3A',
  textDefault: '#43497A',
  textMuted: '#7C83A9',
  textSubtle: '#A8AEC8',

  /* ── Accent (primary brand — indigo) ────────────────────── */
  accent: '#6471F0',
  accentBorder: '#6471F052',
  accentMuted: '#6471F01A',

  /* ── Aux (secondary — blue) ─────────────────────────────── */
  aux: '#3AA0FF',
  auxBorder: '#3AA0FF52',
  auxMuted: '#3AA0FF18',

  /* ── Contrast (tertiary — purple) ───────────────────────── */
  contrast: '#A06BFF',
  contrastBorder: '#A06BFF52',
  contrastMuted: '#A06BFF18',

  /* ── Complement (warm — pink/red) ───────────────────────── */
  complement: '#E0497A',
  complementBorder: '#E0497A52',
  complementMuted: '#E0497A18',

  /* ── Semantic ───────────────────────────────────────────── */
  success: '#16A67A',
  successBorder: '#16A67A52',
  successMuted: '#16A67A18',

  warning: '#E5A100',
  warningBorder: '#E5A10052',
  warningMuted: '#E5A10018',

  danger: '#E5484D',
  dangerBorder: '#E5484D52',
  dangerMuted: '#E5484D18',

  /* ── Line / Border ──────────────────────────────────────── */
  lineDefault: '#0F173D1C',
  lineStrong: '#0F173D2E',
  lineSubtle: '#0F173D0D',

  /* ── Black / White helpers ──────────────────────────────── */
  white: '#FFFFFF',
  black: '#000000',
  transparent: '#00000000',
} as const;

export type ColorToken = keyof typeof colors;
