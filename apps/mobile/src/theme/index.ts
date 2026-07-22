import { colors } from './colors';
import { fontFamily, fontWeight, textPresets } from './typography';
import { spacing, layoutSpacing } from './spacing';
import { radii } from './radii';

/**
 * Full mobile design system theme object.
 * Import this as the single source of truth for all design tokens.
 */
export const theme = {
  colors,
  fontFamily,
  fontWeight,
  textPresets,
  spacing,
  layoutSpacing,
  radii,
} as const;

export type Theme = typeof theme;

// Re-export individual modules for convenience
export { colors } from './colors';
export type { ColorToken } from './colors';
export { fontFamily, fontWeight, textPresets } from './typography';
export { spacing, layoutSpacing } from './spacing';
export { radii } from './radii';
