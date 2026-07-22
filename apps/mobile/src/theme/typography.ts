import { Platform } from 'react-native';

/**
 * Typography tokens for the mobile design system.
 * Font family: Inter (body/caption), IBM Plex Mono (code).
 */
const interFamily = Platform.select({
  ios: 'Inter',
  android: 'Inter',
  default: 'Inter',
});

const monoFamily = Platform.select({
  ios: 'IBM Plex Mono',
  android: 'IBM Plex Mono',
  default: 'IBM Plex Mono',
});

export const fontFamily = {
  body: interFamily,
  caption: interFamily,
  head: interFamily,
  mono: monoFamily,
} as const;

/** Font weights matching design tokens. */
export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

/**
 * Pre-composed text presets for common UI elements.
 * Each preset includes fontFamily, fontSize, fontWeight, and lineHeight.
 */
export const textPresets = {
  /** Large page titles (25–28px) */
  title: {
    fontFamily: fontFamily.head,
    fontSize: 28,
    fontWeight: fontWeight.bold,
    lineHeight: 28 * 1.25,
  },
  /** Section headers (16–18px) */
  heading: {
    fontFamily: fontFamily.head,
    fontSize: 18,
    fontWeight: fontWeight.bold,
    lineHeight: 18 * 1.25,
  },
  /** Sub-section headers (14–16px) */
  subheading: {
    fontFamily: fontFamily.body,
    fontSize: 16,
    fontWeight: fontWeight.semibold,
    lineHeight: 16 * 1.25,
  },
  /** Standard body text (13–14px) */
  body: {
    fontFamily: fontFamily.body,
    fontSize: 14,
    fontWeight: fontWeight.medium,
    lineHeight: 14 * 1.25,
  },
  /** Secondary body text (12–13px) */
  bodySmall: {
    fontFamily: fontFamily.body,
    fontSize: 13,
    fontWeight: fontWeight.medium,
    lineHeight: 13 * 1.25,
  },
  /** Labels, badges, chips (11–12px) */
  label: {
    fontFamily: fontFamily.caption,
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    lineHeight: 12 * 1.25,
  },
  /** Tiny labels, metadata (10–11px) */
  caption: {
    fontFamily: fontFamily.caption,
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    lineHeight: 10 * 1.25,
  },
  /** Card title (15px) */
  cardTitle: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    fontWeight: fontWeight.bold,
    lineHeight: 15 * 1.25,
  },
  /** Card description (11px) */
  cardDescription: {
    fontFamily: fontFamily.body,
    fontSize: 11,
    fontWeight: fontWeight.medium,
    lineHeight: 11 * 1.25,
  },
  /** Code / mono text */
  code: {
    fontFamily: fontFamily.mono,
    fontSize: 13,
    fontWeight: fontWeight.medium,
    lineHeight: 13 * 1.4,
  },
} as const;
