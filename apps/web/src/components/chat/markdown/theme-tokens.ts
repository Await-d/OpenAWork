/**
 * Markdown 富内容（表格 / Mermaid 图表）与应用主题之间的桥接层。
 *
 * 为什么需要这一层：
 * 1. 应用主题由 `index.css` 中 8 套主题 × 明暗模式共 16 组 CSS 变量描述，
 *    组件本身拿不到「当前这套主题最终长什么样」的结构化信息；
 * 2. Mermaid 的 `themeVariables` 会被内部用 khroma 做颜色运算（darken /
 *    混合 / 对比度推导），只接受 hex、rgb()、rgba() 这类可解析的绝对颜色。
 *    直接传 `var(--accent)` 或 `color-mix(...)` 会被 khroma 解析失败，
 *    最终整张图退化成黑色；
 * 3. 因此这里统一「读计算样式 → 解析成通道值 → 在 JS 里做混合」，
 *    让图表配色跟随主题，而不是二选一的 dark/default。
 *
 * 所有函数都不依赖 React，便于单测。
 */

/** 颜色通道值。`a` 为 0~1 的不透明度。 */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 当前生效的主题标识。 */
export type MarkdownThemeMode = 'dark' | 'light';

/**
 * 富内容渲染用到的主题 token 快照。
 * 取值均为可直接解析的具体颜色（hex 或 rgba()）。
 */
export interface MarkdownThemeTokens {
  /** 生效的主题风格名（nebula / aurora / …），仅用于调试与缓存键。 */
  style: string;
  /** 生效的明暗模式。 */
  mode: MarkdownThemeMode;
  bgBase: string;
  bgRaised: string;
  bgOverlay: string;
  bgSurface: string;
  bgElevated: string;
  fgStrong: string;
  fgDefault: string;
  fgMuted: string;
  fgSubtle: string;
  fgOnAccent: string;
  accent: string;
  accentHover: string;
  accentBorder: string;
  contrast: string;
  contrastBorder: string;
  complement: string;
  aux: string;
  success: string;
  warning: string;
  danger: string;
  borderSubtle: string;
  borderDefault: string;
  borderEmphasis: string;
  borderStrong: string;
  /** 主题自带的 8 色图表色板，用于思维导图分支等场景。 */
  chart: string[];
}

/** 读取主题变量时使用的兜底值（nebula dark），只在变量缺失时生效。 */
const FALLBACKS = {
  bgBase: '#0b1020',
  bgRaised: '#0f1428',
  bgOverlay: '#141a33',
  bgSurface: '#1a2140',
  bgElevated: '#212a4d',
  fgStrong: '#f2f4ff',
  fgDefault: '#c3c9e8',
  fgMuted: '#8b93bd',
  fgSubtle: '#5c6490',
  fgOnAccent: '#0b1020',
  accent: '#7c8cff',
  accentHover: '#9aa6ff',
  accentBorder: 'rgba(124, 140, 255, 0.4)',
  contrast: '#a06bff',
  contrastBorder: 'rgba(160, 107, 255, 0.4)',
  complement: '#ff6f9c',
  aux: '#3aa0ff',
  success: '#38e2c1',
  warning: '#a06bff',
  danger: '#ff6f9c',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderDefault: 'rgba(255, 255, 255, 0.1)',
  borderEmphasis: 'rgba(255, 255, 255, 0.16)',
  borderStrong: 'rgba(255, 255, 255, 0.24)',
} as const;

/** 主题缺失时使用的 8 色图表色板兜底。 */
export const FALLBACK_CHART_PALETTE: readonly string[] = [
  '#7c8cff',
  '#a06bff',
  '#3aa0ff',
  '#ff6f9c',
  '#c084fc',
  '#38e2c1',
  '#67e8f9',
  '#f0abfc',
];

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
const FUNCTIONAL_PATTERN = /^rgba?\(([^)]*)\)$/i;

/**
 * 解析 hex / rgb() / rgba() 颜色。
 * 不支持的色彩空间（oklch、color-mix 等）返回 `null`，由调用方决定兜底策略。
 */
export function parseCssColor(value: string): RgbaColor | null {
  const input = value.trim().toLowerCase();
  if (input === '') {
    return null;
  }

  const hexMatch = HEX_PATTERN.exec(input);
  if (hexMatch?.[1]) {
    return parseHexColor(hexMatch[1]);
  }

  const functionalMatch = FUNCTIONAL_PATTERN.exec(input);
  if (functionalMatch) {
    return parseFunctionalColor(functionalMatch[1] ?? '');
  }

  return null;
}

function parseHexColor(digits: string): RgbaColor | null {
  const expanded = digits.length <= 4 ? expandShorthandHex(digits) : digits;
  if (expanded.length !== 6 && expanded.length !== 8) {
    return null;
  }

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const a = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
    return null;
  }

  return { r, g, b, a };
}

function expandShorthandHex(digits: string): string {
  return [...digits].map((digit) => digit + digit).join('');
}

function parseFunctionalColor(body: string): RgbaColor | null {
  const [channelPart = '', alphaPart = ''] = body.split('/');
  const channels = channelPart
    .trim()
    .split(/[\s,]+/)
    .filter((segment) => segment !== '');

  if (channels.length < 3) {
    return null;
  }

  const r = parseChannel(channels[0]);
  const g = parseChannel(channels[1]);
  const b = parseChannel(channels[2]);
  if (r === null || g === null || b === null) {
    return null;
  }

  const rawAlpha = alphaPart.trim() !== '' ? alphaPart : (channels[3] ?? '1');
  return { r, g, b, a: parseAlpha(rawAlpha) };
}

function parseChannel(segment: string | undefined): number | null {
  if (segment === undefined) {
    return null;
  }

  const raw = segment.trim();
  if (raw === '') {
    return null;
  }

  if (raw.endsWith('%')) {
    const percent = Number.parseFloat(raw.slice(0, -1));
    return Number.isNaN(percent) ? null : clampByte((percent / 100) * 255);
  }

  const numeric = Number.parseFloat(raw);
  return Number.isNaN(numeric) ? null : clampByte(numeric);
}

function parseAlpha(segment: string | undefined): number {
  if (segment === undefined) {
    return 1;
  }

  const raw = segment.trim();
  if (raw === '') {
    return 1;
  }

  if (raw.endsWith('%')) {
    const percent = Number.parseFloat(raw.slice(0, -1));
    return Number.isNaN(percent) ? 1 : clamp01(percent / 100);
  }

  const numeric = Number.parseFloat(raw);
  return Number.isNaN(numeric) ? 1 : clamp01(numeric);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** 序列化为 CSS 颜色：不透明输出 hex，带透明度输出 rgba()。 */
export function formatCssColor(color: RgbaColor): string {
  const r = Math.round(clampByte(color.r));
  const g = Math.round(clampByte(color.g));
  const b = Math.round(clampByte(color.b));

  if (color.a >= 1) {
    return `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;
  }

  return `rgba(${r}, ${g}, ${b}, ${roundAlpha(clamp01(color.a))})`;
}

function toHexPair(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function roundAlpha(alpha: number): number {
  return Math.round(alpha * 1000) / 1000;
}

/**
 * 把 `overlay` 按 `ratio` 混入 `base`。
 * 先做一次 alpha 合成再插值，因此「半透明强调色叠在不透明底色上」也能
 * 得到可直接用于 SVG 填充的不透明结果。
 */
export function mixColors(base: RgbaColor, overlay: RgbaColor, ratio: number): RgbaColor {
  const t = clamp01(ratio);
  const resolved = compositeOver(overlay, base);

  return {
    r: base.r + (resolved.r - base.r) * t,
    g: base.g + (resolved.g - base.g) * t,
    b: base.b + (resolved.b - base.b) * t,
    a: base.a + (resolved.a - base.a) * t,
  };
}

function compositeOver(overlay: RgbaColor, base: RgbaColor): RgbaColor {
  const alpha = overlay.a + base.a * (1 - overlay.a);
  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const channel = (over: number, under: number): number =>
    (over * overlay.a + under * base.a * (1 - overlay.a)) / alpha;

  return {
    r: channel(overlay.r, base.r),
    g: channel(overlay.g, base.g),
    b: channel(overlay.b, base.b),
    a: alpha,
  };
}

/** 按 WCAG 相对亮度公式计算亮度。 */
export function relativeLuminance(color: RgbaColor): number {
  const linear = (value: number): number => {
    const channel = clampByte(value) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG 对比度（1 ~ 21）。 */
export function contrastRatio(first: RgbaColor, second: RgbaColor): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 在给定背景上挑选可读性更好的文字色。
 * 优先使用 `preferred`，只有当 `alternative` 对比度明显更高时才替换，
 * 这样既能保证可读，又不会让同一主题内文字色频繁跳变。
 */
export function pickReadableColor(
  background: RgbaColor,
  preferred: RgbaColor,
  alternative: RgbaColor,
): RgbaColor {
  const preferredRatio = contrastRatio(background, preferred);
  if (preferredRatio >= 4.5) {
    return preferred;
  }

  return contrastRatio(background, alternative) > preferredRatio ? alternative : preferred;
}

/** 解析颜色并兜底：解析失败时退回兜底值。 */
export function resolveColor(value: string, fallback: string): RgbaColor {
  return parseCssColor(value) ?? parseCssColor(fallback) ?? { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * 读取 `<html>` 上当前生效的主题标识。
 *
 * 注意：`data-mode` 是 App 依据「主题模式 + 系统偏好」解析后的**最终**明暗值，
 * 因此这里不能直接用 store 里的 `themeMode`（system 时会错判）。
 */
export function readAppliedTheme(documentRef?: Document): {
  mode: MarkdownThemeMode;
  style: string;
} {
  const doc = documentRef ?? (typeof document === 'undefined' ? null : document);
  if (!doc) {
    return { mode: 'dark', style: 'nebula' };
  }

  const root = doc.documentElement;
  const style = root.getAttribute('data-theme') ?? 'nebula';
  const modeAttr = root.getAttribute('data-mode');
  if (modeAttr === 'light' || modeAttr === 'dark') {
    return { mode: modeAttr, style };
  }

  // 属性尚未写入（App 在 effect 中设置）时，退回到系统偏好。
  const prefersLight =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
      : false;

  return { mode: prefersLight ? 'light' : 'dark', style };
}

/** 读取主题变量并归一化为可解析颜色。缺失或不可解析时退回兜底值。 */
export function readMarkdownThemeTokens(documentRef?: Document): MarkdownThemeTokens {
  const doc = documentRef ?? (typeof document === 'undefined' ? null : document);
  const { mode, style } = readAppliedTheme(doc ?? undefined);

  if (!doc || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return buildFallbackTokens(mode, style);
  }

  const computed = window.getComputedStyle(doc.documentElement);
  const read = (name: string, fallback: string): string => {
    const raw = computed.getPropertyValue(name).trim();
    if (raw === '') {
      return fallback;
    }

    const parsed = parseCssColor(raw);
    return parsed ? formatCssColor(parsed) : fallback;
  };

  const chart = FALLBACK_CHART_PALETTE.map((fallback, index) =>
    read(`--chart-${index + 1}`, fallback),
  );

  return {
    style,
    mode,
    bgBase: read('--bg-base', FALLBACKS.bgBase),
    bgRaised: read('--bg-raised', FALLBACKS.bgRaised),
    bgOverlay: read('--bg-overlay', FALLBACKS.bgOverlay),
    bgSurface: read('--bg-surface', FALLBACKS.bgSurface),
    bgElevated: read('--bg-elevated', FALLBACKS.bgElevated),
    fgStrong: read('--fg-strong', FALLBACKS.fgStrong),
    fgDefault: read('--fg-default', FALLBACKS.fgDefault),
    fgMuted: read('--fg-muted', FALLBACKS.fgMuted),
    fgSubtle: read('--fg-subtle', FALLBACKS.fgSubtle),
    fgOnAccent: read('--fg-on-accent', FALLBACKS.fgOnAccent),
    accent: read('--accent', FALLBACKS.accent),
    accentHover: read('--accent-hover', FALLBACKS.accentHover),
    accentBorder: read('--accent-border', FALLBACKS.accentBorder),
    contrast: read('--contrast', FALLBACKS.contrast),
    contrastBorder: read('--contrast-border', FALLBACKS.contrastBorder),
    complement: read('--complement', FALLBACKS.complement),
    aux: read('--aux', FALLBACKS.aux),
    success: read('--success', FALLBACKS.success),
    warning: read('--warning', FALLBACKS.warning),
    danger: read('--danger', FALLBACKS.danger),
    borderSubtle: read('--border-subtle', FALLBACKS.borderSubtle),
    borderDefault: read('--border-default', FALLBACKS.borderDefault),
    borderEmphasis: read('--border-emphasis', FALLBACKS.borderEmphasis),
    borderStrong: read('--border-strong', FALLBACKS.borderStrong),
    chart,
  };
}

function buildFallbackTokens(mode: MarkdownThemeMode, style: string): MarkdownThemeTokens {
  return {
    style,
    mode,
    ...FALLBACKS,
    chart: [...FALLBACK_CHART_PALETTE],
  };
}
