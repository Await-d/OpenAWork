/**
 * 知识图谱 · 标签文本排版（纯函数，无 DOM / G6 / React 依赖）。
 *
 * 绘制层（`knowledge-graph-style.ts`）与碰撞估算层（`knowledge-graph-labels.ts`）必须使用
 * **同一套**字号、宽度上限与截断结果，否则估算盒与实际绘制盒会不一致——碰撞过滤器以为
 * 两个标签不重叠，实际却叠在一起。因此「字形宽度估算 + 截断 + 聚合标签拼装 +
 * 聚合字号/宽度策略」集中在本模块，供两层共同引用。
 *
 * 聚合标签（`名称 · 数量`）的数量承载语义，截断一律只裁名称，计数永远完整可见。
 */

import type { GraphNodeModel } from './knowledge-graph-model.js';
import { aggregateRadiusFor } from './knowledge-graph-radius.js';

/** G6 单行文本行高相对字号的系数（绘制与盒估算共用）。 */
export const LABEL_LINE_HEIGHT_RATIO = 1.4;
/** 全角字形（中文/日文/韩文/全角符号）按 1em 估算宽度。 */
const WIDE_GLYPH_EM = 1;
/**
 * 拉丁等半角字形按 0.66em 估算宽度。
 *
 * 该值经真实渲染反推：浏览器在 11–14px 下渲染 `knowledge` 等拉丁串时，实测宽度约为
 * 字号的 0.62–0.66em，旧的 0.55em 会让估算盒比绘制盒窄最多约 18%，碰撞过滤因此放行
 * 实际相撞的标签。宁可略微高估（更早丢弃）也不能低估（放行重叠）。
 */
const NARROW_GLYPH_EM = 0.66;
/**
 * 估算宽度的安全余量：真实字形宽度由 G6 的字体度量决定，启发式估算无法逐字精确复现。
 * 统一放大一点，保证「估算宽度 ≥ 实际绘制宽度」恒成立（实测余量 3% 已覆盖字体回退差异）。
 */
const WIDTH_SAFETY_RATIO = 1.03;
/** 宽字形码点区间（CJK 部首起，覆盖假名、韩文音节、全角形式与兼容表意文字）。 */
const WIDE_GLYPH_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2026, 0x2026],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
];

/** 截断只允许出现一个省略号，绝不产生 `……` 或 `：…` 这类残句。 */
export const LABEL_ELLIPSIS = '…';
/** 聚合标签的「名称 · 数量」分隔符。 */
export const AGGREGATE_LABEL_SEPARATOR = ' · ';
/** 宽度极紧时的紧凑分隔符：省掉两侧空格，把省下的空间让给名称片段。 */
const AGGREGATE_LABEL_COMPACT_SEPARATOR = '·';
/**
 * 截断预算相对宽度上限的安全余量：估算用启发式字形宽度，G6 用真实字形测量。
 * 留出余量可保证预截断后的文本不会再被 G6 截第二次（那会切掉计数）。
 */
const TRUNCATION_SAFETY_RATIO = 0.96;
/** 允许保留在截断结果末尾、随后会被省略号替换的标点（避免出现 `：…` 残句）。 */
const TRAILING_PUNCTUATION = /[\s:：,，、·]+$/u;

function isWideGlyph(codePoint: number): boolean {
  for (const [start, end] of WIDE_GLYPH_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

/** 估算未截断文本的绘制宽度（宽度以 `em` 近似后乘以字号，并留统一安全余量）。 */
export function estimateLabelTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) {
    em += isWideGlyph(char.codePointAt(0) ?? 0) ? WIDE_GLYPH_EM : NARROW_GLYPH_EM;
  }
  return em * fontSize * WIDTH_SAFETY_RATIO;
}

/**
 * 按估算宽度截断文本：超宽时保留前缀 + 单个省略号（省略号计入预算），不超宽则原样返回。
 * 逐 **Unicode 码点**裁剪（`for...of` 迭代码点），不会在代理对中间切断产生乱码；
 * 末尾标点先剥掉再补省略号，避免 `名称：…` 这种残句。
 */
export function truncateLabelToWidth(text: string, fontSize: number, maxWidth: number): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    return LABEL_ELLIPSIS;
  }
  if (estimateLabelTextWidth(text, fontSize) <= maxWidth) {
    return text;
  }
  const budget = maxWidth - estimateLabelTextWidth(LABEL_ELLIPSIS, fontSize);
  let kept = '';
  let width = 0;
  for (const point of text) {
    const pointWidth = estimateLabelTextWidth(point, fontSize);
    if (width + pointWidth > budget) {
      break;
    }
    kept += point;
    width += pointWidth;
  }
  const trimmed = kept.replace(TRAILING_PUNCTUATION, '');
  return `${trimmed.length > 0 ? trimmed : kept}${LABEL_ELLIPSIS}`;
}

/**
 * 折叠聚合标签：`名称 · 数量`。
 * 宽度不足时只截断**名称**——先为完整计数预留宽度，再用剩余预算截断名称，
 * 因此计数在任何宽度下都完整可读。若连一个名称字形都放不下（可能只剩 `… · 6`），
 * 先改用紧凑分隔符挤出名称空间；再放不下就只保留完整计数，绝不渲染裸省略号 + 计数。
 */
export function buildAggregateLabelText(
  name: string,
  count: number,
  options: { readonly fontSize: number; readonly maxWidth: number },
): string {
  const { fontSize, maxWidth } = options;
  const suffix = `${AGGREGATE_LABEL_SEPARATOR}${formatAggregateCount(count)}`;
  const suffixWidth = estimateLabelTextWidth(suffix, fontSize);
  const nameBudget = maxWidth * TRUNCATION_SAFETY_RATIO - suffixWidth;
  const truncatedName = nameBudget > 0 ? truncateLabelToWidth(name, fontSize, nameBudget) : '';
  if (truncatedName.length > 0 && truncatedName !== LABEL_ELLIPSIS) {
    return `${truncatedName}${suffix}`;
  }

  const compactSuffix = `${AGGREGATE_LABEL_COMPACT_SEPARATOR}${formatAggregateCount(count)}`;
  const compactBudget =
    maxWidth * TRUNCATION_SAFETY_RATIO - estimateLabelTextWidth(compactSuffix, fontSize);
  const compactName = compactBudget > 0 ? truncateLabelToWidth(name, fontSize, compactBudget) : '';
  if (compactName.length > 0 && compactName !== LABEL_ELLIPSIS) {
    return `${compactName}${compactSuffix}`;
  }

  return truncateLabelToWidth(formatAggregateCount(count), fontSize, maxWidth);
}

/**
 * 折叠聚合标签的最小字号。聚合节点数量少、是概览的导航主角，必须明显大于同深度的叶子标签
 * （深度 1 的叶子字号为 12.5），否则会像「一堆小字」淹没在节点里。
 */
export const AGGREGATE_LABEL_FONT_MIN = 15;
/** 聚合标签字号上限：半径再大也不继续放大，避免与节点本体抢夺注意力。 */
export const AGGREGATE_LABEL_FONT_MAX = 21;
/** 每单位折叠半径增加的字号。 */
const AGGREGATE_LABEL_FONT_RADIUS_STEP = 0.14;

/** 聚合标签字号：随折叠节点半径增长，钳制在 `[MIN, MAX]`。 */
export function aggregateLabelFontSizeForRadius(radius: number): number {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const scaled = AGGREGATE_LABEL_FONT_MIN + safeRadius * AGGREGATE_LABEL_FONT_RADIUS_STEP;
  return Math.round(Math.min(AGGREGATE_LABEL_FONT_MAX, Math.max(AGGREGATE_LABEL_FONT_MIN, scaled)));
}

/** 聚合标签宽度下限：保证「名称 · 计数」至少有足够空间读出计数。 */
export const AGGREGATE_LABEL_MIN_WIDTH = 200;
/** 每单位折叠半径换取的额外标签宽度（半径越大、节点越少，越该给它空间）。 */
export const AGGREGATE_LABEL_WIDTH_PER_RADIUS = 3.6;
/** 聚合标签宽度硬上限：既要明显宽于叶子，又不能宽到同一环上的相邻聚合互相打架。 */
export const AGGREGATE_LABEL_MAX_WIDTH = 340;

/** 聚合标签宽度上限：按折叠半径线性放宽并钳制在 `[MIN, MAX]`。 */
export function aggregateLabelMaxWidthForRadius(radius: number): number {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const scaled = AGGREGATE_LABEL_MIN_WIDTH + safeRadius * AGGREGATE_LABEL_WIDTH_PER_RADIUS;
  return Math.min(AGGREGATE_LABEL_MAX_WIDTH, scaled);
}

/**
 * 折叠聚合**盘内计数徽标**（`1.1k` / `30`）的排版。
 *
 * 字号由盘半径派生、不能独立于半径取固定值，否则拥挤收缩后的小盘会配上比盘还大的字形。
 * 几何约束：单行文本的内接圆半径 `hypot(宽/2, 高/2)` 必须 ≤ `盘半径 × INNER_RATIO`，
 * 余下的 `1 - INNER_RATIO` 即数字与 rim 之间的净空。计数是语义本体：若最小可读字号仍放不下，
 * 返回的半径会大于传入半径，由 `buildNodeStyle` 把盘面撑到徽标所需的最小半径。
 */

/** 徽标字号占盘半径的比例：随半径线性变化，让大字盘配大数字、小盘配小数字。 */
const AGGREGATE_BADGE_FONT_RADIUS_RATIO = 0.6;
/** 徽标字号下限：再小数字就不可读，此时改为撑大盘面。 */
export const AGGREGATE_BADGE_FONT_MIN = 10;
/** 徽标字号上限：盘面再大也不让徽标压过盘下方的 `名称 · 数量` 标签。 */
export const AGGREGATE_BADGE_FONT_MAX = 20;
/** 徽标文本内接圆最多占盘半径的比例，其余留作 rim 净空（0.22 ≈ 每侧 22% 半径）。 */
export const AGGREGATE_BADGE_INNER_RATIO = 0.78;
/**
 * 单行徽标字形盒高度（em）。取字形盒而非 1.4 倍行高：行高的上下留白无需落进盘内，
 * 按行高估算会把徽标所需半径高估约三成。
 */
const AGGREGATE_BADGE_TEXT_HEIGHT_EM = 1;

export interface AggregateBadgeLayout {
  readonly fontSize: number;
  /** 足以容纳该徽标的盘半径；不小于传入半径。 */
  readonly radius: number;
}

/** 徽标文本在字号为 1 时的内接圆半径（宽度沿用共享字形估算，高度取字形盒）。 */
function badgeHalfDiagonalEm(text: string): number {
  return Math.hypot(estimateLabelTextWidth(text, 1) / 2, AGGREGATE_BADGE_TEXT_HEIGHT_EM / 2);
}

/** 容纳 `fontSize` 字号的该徽标所需的最小盘半径。 */
function badgeRadiusFor(text: string, fontSize: number): number {
  return (badgeHalfDiagonalEm(text) * fontSize) / AGGREGATE_BADGE_INNER_RATIO;
}

/** 计数徽标的最终字号与盘半径：字号由半径派生并钳制，盘半径不小于徽标所需。 */
export function aggregateBadgeLayout(text: string, radius: number): AggregateBadgeLayout {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const scaled = Math.round(safeRadius * AGGREGATE_BADGE_FONT_RADIUS_RATIO);
  const fontSize = Math.min(AGGREGATE_BADGE_FONT_MAX, Math.max(AGGREGATE_BADGE_FONT_MIN, scaled));
  return { fontSize, radius: Math.max(safeRadius, badgeRadiusFor(text, fontSize)) };
}

/**
 * 承载盘内计数的节点（折叠聚合 · 工作区枢纽）的**唯一**半径契约：`aggregateRadiusFor` 的计数托底
 * 与 `aggregateBadgeLayout` 的可读性托底取大，后者再按最小可读字号收口。布局层（间距 / 环带预算）
 * 与绘制层（盘面 / 徽标字号）共用此函数，两侧不可能分叉。
 */
export function countDiscRadius(descendantCount: number, baseRadius: number): number {
  if (!Number.isFinite(descendantCount) || descendantCount <= 0) {
    return baseRadius;
  }
  const floor = Math.max(baseRadius, aggregateRadiusFor(descendantCount));
  return aggregateBadgeLayout(formatAggregateCount(descendantCount), floor).radius;
}

/** 节点柔光盘相对关键圆的半径比例；主层绘制，标签层在其下。 */
export const NODE_DEPTH_OUTER_RATIO = 1.36;

const LABEL_FONT_BASE = 14;
const LABEL_FONT_DEPTH_STEP = 1.5;
const LABEL_FONT_MIN = 10;
const LABEL_MAX_WIDTH_BASE = 96;
const LABEL_MAX_WIDTH_DEPTH_STEP = 16;
const LABEL_MAX_WIDTH_MIN = 84;
export const LABEL_MAX_LINES = 1;
export const LABEL_STRONG_DEPTH = 1;
/** 标签相对节点底边的下移量；标签消歧的盒估算与样式渲染共用此值。 */
export const LABEL_OFFSET_Y = 4;

/**
 * 标签相对节点**渲染足迹**（关键圆 + 主层柔光盘）底边的净空换算：绘制层把它写成 G6 的
 * `labelOffsetY`（G6 以关键圆下沿为锚点，因此要把足迹与关键圆的差值补回去），盒估算层直接
 * 用 `footprintRadius + LABEL_OFFSET_Y` 得到同一个顶部锚点。两侧共用保证标签永不被自身足迹压住。
 */
export function labelOffsetYFor(discRadius: number, footprintRadius: number): number {
  const extraClearance = Number.isFinite(footprintRadius - discRadius)
    ? Math.max(0, footprintRadius - discRadius)
    : 0;
  return extraClearance + LABEL_OFFSET_Y;
}

export function labelFontSizeForDepth(depth: number): number {
  return Math.max(LABEL_FONT_MIN, LABEL_FONT_BASE - depth * LABEL_FONT_DEPTH_STEP);
}

export function labelMaxWidthForDepth(depth: number): number {
  return Math.max(LABEL_MAX_WIDTH_MIN, LABEL_MAX_WIDTH_BASE - depth * LABEL_MAX_WIDTH_DEPTH_STEP);
}

export function labelFontSizeForNode(depth: number, aggregate: boolean, radius: number): number {
  return aggregate ? aggregateLabelFontSizeForRadius(radius) : labelFontSizeForDepth(depth);
}

export function labelMaxWidthForNode(depth: number, aggregate: boolean, radius = 0): number {
  const base = labelMaxWidthForDepth(depth);
  return aggregate ? Math.max(base, aggregateLabelMaxWidthForRadius(radius)) : base;
}

/**
 * 计数文案的**唯一**格式化入口：`1.2k`（≥1000）或精确整数。盘内徽标与标签尾部计数都必须
 * 经过它，两者的数字因此不可能再出现「同一节点 1.1k 与 1055 两个值」的自相矛盾。
 *
 * 取紧凑表示而非精确值，因为盘内徽标受**环拥挤收缩后的盘半径**约束：4 位数精确值在最小字号
 * 下需要比布局半径更大的盘面（`aggregateBadgeLayout` 会把盘撑大），而那正是 D2 圆盘重叠的
 * 成因之一。标签尾部与徽标共用紧凑值，只牺牲分辨率，不牺牲一致性。
 */
export function formatAggregateCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '0';
  }
  return count < 1000 ? String(Math.round(count)) : `${(count / 1000).toFixed(1)}k`;
}

function buildLabelText(
  hasCount: boolean,
  label: string,
  count: number,
  fontSize: number,
  maxWidth: number,
): string {
  if (!hasCount) {
    return truncateLabelToWidth(label, fontSize, maxWidth);
  }
  return buildAggregateLabelText(label, count, { fontSize, maxWidth });
}

/**
 * 带计数的标签最小宽度：折叠聚合与「有隐藏后代但自身已展开」的节点共用。
 * 计数后缀不可截断，因此宽度必须留得下「 · 1.1k」再加一段可读名称。
 */
export const LABEL_COUNT_MIN_WIDTH = 200;

export function labelTextForNode(node: GraphNodeModel, fontSize: number, maxWidth: number): string {
  return buildLabelText(
    node.collapsed === true || (node.descendantCount ?? 0) > 0,
    node.label,
    node.descendantCount ?? 0,
    fontSize,
    maxWidth,
  );
}

export function nodeDrawnRadius(collapsed: boolean, count: number, layoutRadius: number): number {
  const radius = collapsed
    ? aggregateBadgeLayout(formatAggregateCount(count), layoutRadius).radius
    : layoutRadius;
  return Math.round(2 * radius) / 2;
}

/**
 * 节点完整渲染足迹半径：关键圆之外还有一层 `NODE_DEPTH_OUTER_RATIO` 柔光盘，而标签层绘制在
 * **主层之下**，所以标签只要落进任一节点的足迹就会被主层切断。碰撞占用集合必须按此足迹登记，
 * 只登记关键圆半径会放行实际被切断的标签。
 */
export function nodeFootprintRadius(
  collapsed: boolean,
  count: number,
  layoutRadius: number,
): number {
  return nodeDrawnRadius(collapsed, count, layoutRadius) * NODE_DEPTH_OUTER_RATIO;
}

/**
 * 标签几何唯一事实来源：字号 / 宽度上限 / 文本 / 盘内徽标 / 绘制盘半径一次算清，由绘制层
 * （`buildNodeStyle`）与碰撞估算层（`estimateLabelBox`）共同消费，两侧不再各自推导。
 */
export interface NodeLabelGeometry {
  readonly aggregate: boolean;
  readonly fontSize: number;
  readonly maxWidth: number;
  readonly text: string;
  readonly badge: AggregateBadgeLayout | null;
  readonly badgeText: string | null;
  readonly discRadius: number;
  readonly footprintRadius: number;
}

export function resolveNodeLabelGeometry(input: {
  readonly depth: number;
  readonly label: string;
  readonly radius: number;
  readonly collapsed: boolean;
  readonly count: number;
}): NodeLabelGeometry {
  const aggregate = input.collapsed;
  const count = Number.isFinite(input.count) && input.count > 0 ? Math.round(input.count) : 0;
  // 折叠聚合永远显示计数（含 ` · 0`，计数为 0 也是信息）；已展开的节点只在确有隐藏后代时显示。
  const hasCount = aggregate || count > 0;
  const fontSize = labelFontSizeForNode(input.depth, aggregate, input.radius);
  const maxWidth = aggregate
    ? labelMaxWidthForNode(input.depth, true, input.radius)
    : hasCount
      ? Math.max(labelMaxWidthForDepth(input.depth), LABEL_COUNT_MIN_WIDTH)
      : labelMaxWidthForDepth(input.depth);
  // 计数只格式化一次，徽标与标签尾部共用同一份文本，二者不可能再给出不同的数字。
  const countText = hasCount ? formatAggregateCount(count) : null;
  const badgeText = aggregate ? countText : null;
  const badge = badgeText ? aggregateBadgeLayout(badgeText, input.radius) : null;
  const discRadius = nodeDrawnRadius(aggregate, count, input.radius);
  return {
    aggregate,
    fontSize,
    maxWidth,
    text: buildLabelText(hasCount, input.label, count, fontSize, maxWidth),
    badge,
    badgeText,
    discRadius,
    footprintRadius: nodeFootprintRadius(aggregate, count, input.radius),
  };
}
