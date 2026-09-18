/**
 * 知识图谱 · 调色板解析与颜色混合（纯函数）。
 *
 * 从 `knowledge-graph-style.ts` 拆出：颜色解析 / 混合 / 深度明度台阶 / 调色板读取
 * 属于「色彩基础设施」，与「节点·边样式装配」职责不同。`style.ts` 继续 re-export
 * 这些符号，保证既有导入路径不变。
 *
 * E · Nebula 约束：颜色全部来自 CSS 变量；同组只用一种色相，深度用「向背景混合」的明度差表达。
 */

import type { GraphNodeGroup } from '../../../data/build-knowledge-graph.js';

export type GraphColorMode = 'group' | 'role' | 'persistence';

/** 运行时从 CSS 变量解析出的调色板，键名为 camelCase（去掉 `--` 前缀）。 */
export interface GraphPalette {
  accent: string;
  contrast: string;
  complement: string;
  aux: string;
  success: string;
  warning: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
  chart7: string;
  chart8: string;
  fgStrong: string;
  fgDefault: string;
  fgMuted: string;
  fgSubtle: string;
  bgBase: string;
  bgOverlay: string;
  bgRaised: string;
  borderSubtle: string;
  borderDefault: string;
  borderEmphasis: string;
}

const PALETTE_TOKENS: Record<keyof GraphPalette, string> = {
  accent: '--accent',
  contrast: '--contrast',
  complement: '--complement',
  aux: '--aux',
  success: '--success',
  warning: '--warning',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
  chart6: '--chart-6',
  chart7: '--chart-7',
  chart8: '--chart-8',
  fgStrong: '--fg-strong',
  fgDefault: '--fg-default',
  fgMuted: '--fg-muted',
  fgSubtle: '--fg-subtle',
  bgBase: '--bg-base',
  bgOverlay: '--bg-overlay',
  bgRaised: '--bg-raised',
  borderSubtle: '--border-subtle',
  borderDefault: '--border-default',
  borderEmphasis: '--border-emphasis',
};

/**
 * 深度明度台阶：用幂曲线而非线性步长，浅层就拉开差距（外环节点数量多、彼此更近，需要更明显的明度差）。
 * `depth` 达到 `DEPTH_RAMP_DEPTH` 后收敛到 `DEPTH_DIM_MAX`，避免深层节点彻底融进背景。
 */
const DEPTH_DIM_MAX = 0.5;
const DEPTH_RAMP_DEPTH = 4;
const DEPTH_RAMP_EXPONENT = 0.65;

/**
 * 静息表面：所有组色先向背景混合固定比例，压到同一饱和度/明度带。
 * 四组语义色相保持不变（accent / contrast / complement / aux 语义映射不动），
 * 但不再各自满饱和互相争抢，读起来像同族色相而不是「一袋糖果」。
 */
const NODE_SURFACE_CALM = 0.3;

/** 组 → 语义 token：架构用 aux，治理用 contrast，记忆用 complement，知识/工作区用 accent。 */
const GROUP_TOKEN: Record<GraphNodeGroup, keyof GraphPalette> = {
  architecture: 'aux',
  governance: 'contrast',
  memory: 'complement',
  knowledge: 'accent',
  workspace: 'accent',
};

interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
const RGB_PATTERN = /^rgba?\(\s*([^)]+)\)$/i;
const RGB_COMPONENT_SEPARATOR = /[\s,/]+/;

function parseHexColor(value: string): RgbaColor | null {
  const match = HEX_PATTERN.exec(value);
  const hex = match?.[1];
  if (!hex) {
    return null;
  }
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex.slice(0, 1).repeat(2), 16);
    const g = parseInt(hex.slice(1, 2).repeat(2), 16);
    const b = parseInt(hex.slice(2, 3).repeat(2), 16);
    const a = hex.length === 4 ? parseInt(hex.slice(3, 4).repeat(2), 16) / 255 : 1;
    return { r, g, b, a };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

function parseComponent(token: string, scale: number): number {
  if (token.endsWith('%')) {
    return (parseFloat(token) / 100) * scale;
  }
  return parseFloat(token);
}

function parseRgbColor(value: string): RgbaColor | null {
  const match = RGB_PATTERN.exec(value);
  const body = match?.[1];
  if (!body) {
    return null;
  }
  const parts = body.split(RGB_COMPONENT_SEPARATOR).filter((part) => part.length > 0);
  if (parts.length < 3) {
    return null;
  }
  const r = parseComponent(parts[0] ?? '', 255);
  const g = parseComponent(parts[1] ?? '', 255);
  const b = parseComponent(parts[2] ?? '', 255);
  const a = parts.length >= 4 ? parseFloat(parts[3] ?? '1') : 1;
  if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b, a };
}

/** 解析 `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`，以及 rgb 与 rgba 函数语法；其它语法返回 null。 */
function parseColor(input: string): RgbaColor | null {
  const value = input.trim().toLowerCase();
  if (value.length === 0) {
    return null;
  }
  if (value.startsWith('#')) {
    return parseHexColor(value);
  }
  return parseRgbColor(value);
}

function toHexByte(channel: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(channel)));
  return clamped.toString(16).padStart(2, '0');
}

function formatHexColor({ r, g, b, a }: RgbaColor): string {
  const base = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  if (a >= 1) {
    return base;
  }
  return `${base}${toHexByte(a * 255)}`;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

/**
 * 将 `base` 向 `target` 线性混合 `amount`（0 = 原色，1 = 目标色）。
 * 输出统一为 8 位十六进制（无透明度时退化为 6 位）——避免拼接 CSS 颜色函数字面量。
 * 无法解析的输入（例如 `hsl(...)`）原样返回 `base`，保证降级安全。
 */
export function mixColorToward(base: string, target: string, amount: number): string {
  const amountValue = clampUnit(amount);
  if (amountValue === 0) {
    return base;
  }
  if (amountValue === 1) {
    return target;
  }
  const baseColor = parseColor(base);
  const targetColor = parseColor(target);
  if (!baseColor || !targetColor) {
    return base;
  }
  return formatHexColor({
    r: baseColor.r + (targetColor.r - baseColor.r) * amountValue,
    g: baseColor.g + (targetColor.g - baseColor.g) * amountValue,
    b: baseColor.b + (targetColor.b - baseColor.b) * amountValue,
    a: baseColor.a + (targetColor.a - baseColor.a) * amountValue,
  });
}

/** 深度对应的背景混合比例：0 保持原色，随深度按幂曲线增大并钳制在 `DEPTH_DIM_MAX`。 */
export function depthMixAmount(depth: number): number {
  const normalized = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
  const ramp = Math.min(1, normalized / DEPTH_RAMP_DEPTH);
  return DEPTH_DIM_MAX * Math.pow(ramp, DEPTH_RAMP_EXPONENT);
}

/** 组语义色 → 静息表面色（向背景混合固定比例，把四组色相压到同一明度带）。 */
export function resolveGroupSurfaceColor(group: GraphNodeGroup, palette: GraphPalette): string {
  return mixColorToward(palette[GROUP_TOKEN[group]], palette.bgBase, NODE_SURFACE_CALM);
}

/** 解析 E · Nebula 调色板：读 `document.documentElement` 计算样式，缺失变量时回退为变量名本身。 */
export function resolveGraphPalette(): GraphPalette {
  const styles =
    typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const read = (token: string): string => {
    if (!styles) {
      return token;
    }
    const value = styles.getPropertyValue(token).trim();
    return value.length > 0 ? value : token;
  };
  const keys = Object.keys(PALETTE_TOKENS) as (keyof GraphPalette)[];
  const palette = {} as GraphPalette;
  for (const key of keys) {
    palette[key] = read(PALETTE_TOKENS[key]);
  }
  return palette;
}

/** WCAG 相对亮度计算所需的通道线性化。 */
function channelLuminance(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度（0..1）；无法解析颜色时返回 null。 */
export function relativeLuminance(value: string): number | null {
  const color = parseColor(value);
  if (!color) {
    return null;
  }
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}
