/**
 * 元素检查器的内联样式 token 与语义配色映射。
 *
 * 与 `NetworkWaterfall` 的 `WF_TOKEN` 同一做法：全部写成「应用 token + `currentColor`
 * 兜底」。检查器可能被渲染在尚未加载应用级 token 表（`index.css`）的宿主里
 * （验收 harness、独立预览），裸 `var()` 在那里会在 computed-value 阶段整体失效——
 * 边框、选中底色、焦点环会一起消失，树退化成纯文本。兜底不含任何硬编码色值，
 * 只按比例混出 `currentColor`；token 表存在时兜底永远不会生效。
 *
 * 语义色的选择遵循 E · Nebula 规则：accent（靛青）= 选中 / 主交互，
 * contrast（琥珀）= warning，complement（珊瑚）= danger，aux（靛蓝）= info。
 */

import type { InspectorChipTone, InspectorLabelTone } from './browser-inspector-model.js';

export const INSPECTOR_TOKEN = {
  surface: 'var(--bg-overlay, color-mix(in oklch, currentColor 6%, transparent))',
  surfaceBase: 'var(--bg-raised, color-mix(in oklch, currentColor 4%, transparent))',
  surfaceRaised: 'var(--bg-elevated, color-mix(in oklch, currentColor 10%, transparent))',
  hoverBg: 'var(--bg-hover, color-mix(in oklch, currentColor 10%, transparent))',
  pressedBg: 'var(--bg-active, color-mix(in oklch, currentColor 14%, transparent))',
  selectedBg: 'var(--accent-subtle, color-mix(in oklch, currentColor 8%, transparent))',
  textStrong: 'var(--fg-strong, currentColor)',
  textDefault: 'var(--fg-default, currentColor)',
  textMuted: 'var(--fg-muted, color-mix(in oklch, currentColor 70%, transparent))',
  textSubtle: 'var(--fg-subtle, color-mix(in oklch, currentColor 52%, transparent))',
  borderSubtle: 'var(--border-subtle, color-mix(in oklch, currentColor 12%, transparent))',
  borderDefault: 'var(--border-default, color-mix(in oklch, currentColor 20%, transparent))',
  borderEmphasis: 'var(--border-emphasis, color-mix(in oklch, currentColor 32%, transparent))',
  focusRing: 'var(--accent-subtle, color-mix(in oklch, currentColor 10%, transparent))',
  accent: 'var(--accent, currentColor)',
  accentBorder: 'var(--accent-border, color-mix(in oklch, currentColor 60%, transparent))',
  success: 'var(--success, currentColor)',
  warning: 'var(--warning, currentColor)',
  danger: 'var(--danger, currentColor)',
  aux: 'var(--aux, currentColor)',
  mono: 'var(--font-mono, monospace)',
  radiusXs: 'var(--radius-xs, 4px)',
  radiusSm: 'var(--radius-sm, 6px)',
  radiusMd: 'var(--radius-md, 8px)',
  radiusLg: 'var(--radius-lg, 12px)',
  radiusPill: 'var(--radius-pill, 9999px)',
  motionMicro: '100ms cubic-bezier(0.4, 0, 0.2, 1)',
  motionNormal: '200ms cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

export function mergeInspectorShadows(...shadows: Array<string | null>): string {
  const parts = shadows.filter((value): value is string => value !== null);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

interface ToneChrome {
  background: string;
  border: string;
  color: string;
}

/** 芯片 / 提示条语义色（背景用 14% 混合，边框 30%，文字实色）。 */
export const INSPECTOR_CHIP_TONE: Readonly<Record<InspectorChipTone, ToneChrome>> = {
  accent: {
    background: 'color-mix(in oklch, var(--accent, currentColor) 14%, transparent)',
    border: 'var(--accent-border, color-mix(in oklch, currentColor 30%, transparent))',
    color: INSPECTOR_TOKEN.accent,
  },
  success: {
    background: 'color-mix(in oklch, var(--success, currentColor) 14%, transparent)',
    border: 'color-mix(in oklch, var(--success, currentColor) 30%, transparent)',
    color: INSPECTOR_TOKEN.success,
  },
  warning: {
    background: 'color-mix(in oklch, var(--warning, currentColor) 14%, transparent)',
    border: 'color-mix(in oklch, var(--warning, currentColor) 30%, transparent)',
    color: INSPECTOR_TOKEN.warning,
  },
  danger: {
    background: 'color-mix(in oklch, var(--danger, currentColor) 14%, transparent)',
    border: 'color-mix(in oklch, var(--danger, currentColor) 30%, transparent)',
    color: INSPECTOR_TOKEN.danger,
  },
  info: {
    background: 'color-mix(in oklch, var(--aux, currentColor) 14%, transparent)',
    border: 'color-mix(in oklch, var(--aux, currentColor) 30%, transparent)',
    color: INSPECTOR_TOKEN.aux,
  },
  muted: {
    background: INSPECTOR_TOKEN.surfaceRaised,
    border: INSPECTOR_TOKEN.borderSubtle,
    color: INSPECTOR_TOKEN.textMuted,
  },
};

/** 树行内文本片段的文字色。 */
export const INSPECTOR_LABEL_TONE: Readonly<Record<InspectorLabelTone, string>> = {
  tag: INSPECTOR_TOKEN.accent,
  attr: INSPECTOR_TOKEN.aux,
  value: INSPECTOR_TOKEN.textStrong,
  muted: INSPECTOR_TOKEN.textSubtle,
  flag: INSPECTOR_TOKEN.warning,
};
