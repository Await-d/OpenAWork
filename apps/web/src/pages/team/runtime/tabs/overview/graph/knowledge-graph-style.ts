/**
 * 知识图谱视觉层 · 色彩与样式派生（纯函数）。
 *
 * E · Nebula 约束：颜色全部来自 CSS 变量；同组只用一种色相，深度用「向背景混合」的明度差表达；
 * 变暗只改透明度，不改色相。混合逻辑抽成纯函数 `mixColorToward`，便于单测。
 *
 * 色彩基础设施（解析 / 混合 / 调色板读取 / 深度台阶）已迁至 `knowledge-graph-palette.ts`，
 * 这里 re-export 以保持既有导入路径不变。
 */

import type { GraphEdgeKind, GraphRoleLayer } from '../../../data/build-knowledge-graph.js';
import { PHASE_LABELS, PHASE_ORDER, phaseRank } from './knowledge-graph-constants.js';
import { containsEdgeCurveOffset, containsEdgeQuietFactor } from './knowledge-graph-edges.js';
import type { GraphEdgeModel, GraphNodeModel } from './knowledge-graph-model.js';
import {
  depthMixAmount,
  mixColorToward,
  relativeLuminance,
  resolveGroupSurfaceColor,
  type GraphColorMode,
  type GraphPalette,
} from './knowledge-graph-palette.js';

export type { GraphColorMode, GraphPalette } from './knowledge-graph-palette.js';
export { containsEdgeCurveOffset, containsEdgeQuietFactor };
export {
  depthMixAmount,
  mixColorToward,
  resolveGraphPalette,
  resolveGroupSurfaceColor,
} from './knowledge-graph-palette.js';

const DIM_OPACITY = 0.18;

const Z_NODE_BASE = 2;
const Z_NODE_EMPHASIS = 12;
const Z_EDGE_CONTAINS = 1;
const Z_EDGE_DERIVES = 5;
const Z_EDGE_FOCUS = 10;

const NODE_LINE_WIDTH = 1.5;
const NODE_LINE_WIDTH_EMPHASIS = 2.5;
/**
 * 填充 rim：向最亮文字色 `fg-strong` 混合，暗色主题下得到比填充更亮的描边、亮色主题下得到更暗的描边。
 * 目标不是「变暗」而是「描出边缘」，让节点读作有明确 rim 的平静表面，而不是平铺的实心色块。
 */
const NODE_STROKE_MIX = 0.22;
const NODE_HALO_WIDTH = 14;
const NODE_HALO_OPACITY = 0.3;

/**
 * 节点「体积感」由**实心形状叠加**表达（WebGL 主层不保证渐变 / shadow，且半透明填充会与背景
 * 合成而忽略更早的兄弟图形）：外层低透明度色盘模拟向外的柔光衰减，内层偏心**不透明**浅盘
 * 模拟受光高光。全部由 token 派生：外盘取节点色，内盘取节点色向 `fg-strong` 混合。
 */
const NODE_DEPTH_OUTER_OPACITY = 0.13;
const NODE_DEPTH_INNER_RATIO = 0.44;
export const NODE_DEPTH_INNER_MIX = 0.3;
/** 高光盘相对节点半径的偏心量（左上方向），避免盖住居中的阶段字形。 */
const NODE_DEPTH_INNER_OFFSET_RATIO = -0.3;

/**
 * 折叠聚合的「有隐藏子节点」环：半径略大于节点本体、向最亮色混合的描边圆。
 * 与填充同色相，只在计数聚合上出现，读作「这里还可以再展开」而不是装饰光晕。
 */
const AGGREGATE_RING_RATIO = 1.24;
const AGGREGATE_RING_MIX = 0.42;
const AGGREGATE_RING_LINE_WIDTH = 2;

const NODE_SIZE_WORKSPACE = 60;
const NODE_SIZE_CATEGORY = 38;
const NODE_SIZE_ARTIFACT_PERSISTED = 30;
const NODE_SIZE_ARTIFACT = 26;
const NODE_SIZE_DEFAULT_PERSISTED = 32;
const NODE_SIZE_DEFAULT = 28;

/**
 * 标签字号 / 宽度 / 文本 / 折叠聚合「名称 · 数量」拼装与标签几何的唯一事实来源都在
 * `knowledge-graph-label-text.ts`，绘制层与碰撞估算层共用；这里 re-export 保持既有导入路径。
 */
import {
  LABEL_MAX_LINES,
  LABEL_STRONG_DEPTH,
  NODE_DEPTH_OUTER_RATIO,
  aggregateBadgeLayout,
  countDiscRadius,
  formatAggregateCount,
  labelOffsetYFor,
  resolveNodeLabelGeometry,
} from './knowledge-graph-label-text.js';
export {
  AGGREGATE_LABEL_FONT_MAX,
  AGGREGATE_LABEL_FONT_MIN,
  AGGREGATE_LABEL_MAX_WIDTH,
  AGGREGATE_LABEL_MIN_WIDTH,
  AGGREGATE_LABEL_WIDTH_PER_RADIUS,
  LABEL_OFFSET_Y,
  LABEL_STRONG_DEPTH,
  NODE_DEPTH_OUTER_RATIO,
  aggregateLabelFontSizeForRadius,
  aggregateLabelMaxWidthForRadius,
  countDiscRadius,
  formatAggregateCount,
  labelFontSizeForDepth,
  labelFontSizeForNode,
  labelMaxWidthForDepth,
  labelMaxWidthForNode,
  labelOffsetYFor,
  labelTextForNode,
  nodeDrawnRadius,
  nodeFootprintRadius,
  resolveNodeLabelGeometry,
  type NodeLabelGeometry,
} from './knowledge-graph-label-text.js';

const ICON_FONT_MIN = 9;
const ICON_FONT_RATIO = 0.46;

/**
 * contains（结构）：层级要「安静但可追踪」——比旧值更粗、更实，让树能被顺着看清。
 * 它承担主要阅读路径，因此基础可见度高于跨层的 derives。
 * 形状为轻拱的 `quadratic`（温和弯折），避免整图读成电线图。
 *
 * 展开层级后，同一个父节点可能一次挂出几十条 `contains`，全部保持满不透明度会读成爆炸图。
 * 因此按**入射扇大小**（该边两端较大的 contains 度数）线性压低非聚焦 contains 的线宽与
 * 不透明度：扇越大越安静，但永远保留可追踪的底噪；聚焦边不受影响（用户显式要求的强调）。
 */
const CONTAINS_LINE_WIDTH = 1.4;
const CONTAINS_STROKE_OPACITY = 0.5;
const CONTAINS_FOCUS_STROKE_OPACITY = 0.85;
const CONTAINS_CURVE_POSITION = 0.5;
/**
 * derives（跨层旁支）：默认是**次要**信息——细、低透明度、无箭头，
 * 只在进入焦点邻域时才抬到 accent、加箭头并播放流动，表达「本次聚焦的知识流向」。
 * 若默认就带箭头+高透明度，跨链会盖过层级结构，主次颠倒。更明显的拱形让跨链绕开图心、不横切。
 */
const DERIVES_LINE_WIDTH = 1.15;
const DERIVES_LINE_WIDTH_FOCUS = 2.2;
const DERIVES_STROKE_OPACITY = 0.32;
const DERIVES_FOCUS_STROKE_OPACITY = 0.95;
const DERIVES_DASH_ON = 9;
const DERIVES_DASH_OFF = 6;
const DERIVES_ARROW_SIZE = 8;
const DERIVES_CURVE_OFFSET = 26;
const DERIVES_CURVE_POSITION = 0.44;
const EDGE_HALO_WIDTH = 12;
const EDGE_HALO_OPACITY = 0.22;

/** 角色层 → 语义 token；优先取 `roleLayers[0]`。 */
const ROLE_TOKEN: Record<GraphRoleLayer, keyof GraphPalette> = {
  reception: 'aux',
  pm1: 'accent',
  pm2: 'contrast',
  executor: 'success',
  reviewer: 'warning',
};

/** persistence 模式：已入库用 success，未入库用 fg-muted。 */
function resolvePersistenceColor(node: GraphNodeModel, palette: GraphPalette): string {
  return node.persisted ? palette.success : palette.fgMuted;
}

/** role 模式：`roleLayers[0]` → 语义 token，缺失时回退 accent。 */
function resolveRoleColor(node: GraphNodeModel, palette: GraphPalette): string {
  const primary = node.roleLayers?.[0];
  if (!primary) {
    return palette.accent;
  }
  return palette[ROLE_TOKEN[primary]];
}

/**
 * 节点填充色：
 * - `group`：组语义色 → 静息表面色（统一明度带）→ 按深度继续向 `bg-base` 混合（同一色相，越深越沉）。
 * - `role`：角色语义色（不随深度变化）。
 * - `persistence`：success / fg-muted。
 */
export function resolveNodeColor(
  mode: GraphColorMode,
  node: GraphNodeModel,
  palette: GraphPalette,
): string {
  if (mode === 'persistence') {
    return resolvePersistenceColor(node, palette);
  }
  if (mode === 'role') {
    return resolveRoleColor(node, palette);
  }
  const surface = resolveGroupSurfaceColor(node.group, palette);
  return mixColorToward(surface, palette.bgBase, depthMixAmount(node.depth));
}

/**
 * 边颜色：
 * - `contains`：结构线，安静但可追踪（fg-muted），聚焦时抬到 fg-default。
 * - `derives`：知识派生流，base/dim 用 aux，聚焦时用 accent（active）。
 * `dim` 与 `base` 同色相——变暗由透明度完成，不改变色相。
 */
export function resolveEdgeColor(
  kind: GraphEdgeKind,
  role: 'base' | 'focus' | 'dim',
  palette: GraphPalette,
): string {
  if (kind === 'contains') {
    return role === 'focus' ? palette.fgDefault : palette.fgMuted;
  }
  return role === 'focus' ? palette.accent : palette.aux;
}

function nodeSizeForModel(node: GraphNodeModel): number {
  if (node.kind === 'workspace') {
    return NODE_SIZE_WORKSPACE;
  }
  if (node.kind === 'category') {
    return NODE_SIZE_CATEGORY;
  }
  if (node.kind === 'artifact') {
    return node.persisted ? NODE_SIZE_ARTIFACT_PERSISTED : NODE_SIZE_ARTIFACT;
  }
  return node.persisted ? NODE_SIZE_DEFAULT_PERSISTED : NODE_SIZE_DEFAULT;
}

/**
 * 节点绘制半径。折叠聚合优先采用**布局层解算出的半径**（已含环拥挤收缩），这样绘制盘、
 * 标签字号 / 宽度、以及碰撞过滤的盒估算完全共用同一份半径契约；未提供时回退到`countDiscRadius`
 * 的计数半径（折叠聚合与工作区枢纽共用同一条腿脚）。叶子仍按类型 / 持久化取原有尺寸。
 */
function nodeDrawRadiusForModel(node: GraphNodeModel, resolvedRadius?: number): number {
  if (typeof resolvedRadius === 'number' && Number.isFinite(resolvedRadius) && resolvedRadius > 0) {
    return resolvedRadius;
  }
  const count = node.descendantCount ?? 0;
  if (count > 0 && (node.collapsed === true || node.kind === 'workspace')) {
    return countDiscRadius(count, node.collapsed === true ? 0 : NODE_SIZE_WORKSPACE / 2);
  }
  return nodeSizeForModel(node) / 2;
}

function labelFillForDepth(depth: number, palette: GraphPalette): string {
  return depth <= LABEL_STRONG_DEPTH ? palette.fgDefault : palette.fgMuted;
}

/**
 * artifact 阶段用 `iconText` 表达（单字缩写），而不是为 7 个阶段各建一个节点类。
 * 缩写取自 `PHASE_LABELS`，不重复定义阶段文案。
 */
function artifactPhaseGlyph(node: GraphNodeModel): string | null {
  if (node.kind !== 'artifact') {
    return null;
  }
  const rank = phaseRank(node.phase);
  if (rank < 0) {
    return null;
  }
  const phaseKey = PHASE_ORDER[rank];
  if (!phaseKey) {
    return null;
  }
  return PHASE_LABELS[phaseKey].slice(0, 1);
}

/**
 * 阶段 glyph 颜色：在 `fg-strong` 与 `bg-base` 两个极值令牌中选与填充亮度差更大者。
 * 单字缩写要落在从浅 teal 到深蓝的所有组色/深度上，固定用 `fg-strong` 会在浅色填充上失去对比，
 * 因此按填充亮度自适应选色，保证两种主题下都可读。
 */
export function resolveGlyphColor(fill: string, palette: GraphPalette): string {
  const fillLuminance = relativeLuminance(fill);
  if (fillLuminance === null) {
    return palette.fgStrong;
  }
  const strongLuminance = relativeLuminance(palette.fgStrong) ?? 1;
  const baseLuminance = relativeLuminance(palette.bgBase) ?? 0;
  return Math.abs(strongLuminance - fillLuminance) >= Math.abs(baseLuminance - fillLuminance)
    ? palette.fgStrong
    : palette.bgBase;
}

/**
 * 高光目标色：在 `fg-strong` 与 `bg-base` 中取**更亮**者。
 * 深色主题下 `fg-strong` 更亮、浅色主题下 `bg-base` 更亮，因此高光在两种主题下都表达「变亮」；
 * 这与 rim（按主题反转对比度）的取色规则不同，高光不能跟着 `fg-strong` 走。
 */
export function resolveHighlightColor(palette: GraphPalette): string {
  const strongLuminance = relativeLuminance(palette.fgStrong) ?? 1;
  const baseLuminance = relativeLuminance(palette.bgBase) ?? 0;
  return strongLuminance >= baseLuminance ? palette.fgStrong : palette.bgBase;
}

/**
 * 生成 G6 节点样式。动态颜色通过 `node.style` 回调设置（主题样式是静态的）。
 * 深度只影响「亮度与标签字号」，选中/聚焦只影响「描边、halo、层级」，不引入新色相。
 * `depthOuter*` / `depthInner*` 由自定义节点类读作实心叠加盘，形成体积感。
 */
export function buildNodeStyle(
  node: GraphNodeModel,
  opts: {
    colorMode: GraphColorMode;
    palette: GraphPalette;
    focused: boolean;
    selected: boolean;
    dimmed: boolean;
    showLabel: boolean;
    /** 当前焦点锚点（hovered ?? selected 本身）：绘制单一路径的呼吸高光。 */
    breathing?: boolean;
    /** 布局层解算出的最终半径（含环拥挤收缩）；缺省时回退到计数半径。 */
    radius?: number;
  },
): Record<string, unknown> {
  const { colorMode, palette, focused, selected, dimmed, showLabel } = opts;
  const color = resolveNodeColor(colorMode, node, palette);
  const emphasized = focused || selected;
  const layoutRadius = nodeDrawRadiusForModel(node, opts.radius);
  const geometry = resolveNodeLabelGeometry({
    collapsed: node.collapsed === true,
    count: node.descendantCount ?? 0,
    depth: node.depth,
    label: node.label,
    radius: layoutRadius,
  });
  // 工作区枢纽：与折叠聚合一样在盘内显示计数，徽标字号由**最终布局半径**派生，因此数字随盘面
  // 一起长大，净空与其它计数聚合一致（几何仍与布局层共用 `countDiscRadius`）。
  const hubBadge =
    node.kind === 'workspace' && (node.descendantCount ?? 0) > 0
      ? aggregateBadgeLayout(formatAggregateCount(node.descendantCount ?? 0), layoutRadius)
      : null;
  const radius = hubBadge ? Math.max(geometry.discRadius, hubBadge.radius) : geometry.discRadius;
  const size = Math.round(2 * radius);
  const labelFontSize = geometry.fontSize;
  const labelMaxWidth = geometry.maxWidth;
  const labelText = geometry.text;

  const style: Record<string, unknown> = {
    size,
    fill: color,
    stroke: mixColorToward(color, palette.fgStrong, NODE_STROKE_MIX),
    lineWidth: emphasized ? NODE_LINE_WIDTH_EMPHASIS : NODE_LINE_WIDTH,
    opacity: dimmed ? DIM_OPACITY : 1,
    zIndex: emphasized ? Z_NODE_EMPHASIS : Z_NODE_BASE,
    cursor: 'pointer',
    halo: emphasized,
    haloStroke: color,
    haloLineWidth: emphasized ? NODE_HALO_WIDTH : 0,
    haloStrokeOpacity: emphasized ? NODE_HALO_OPACITY : 0,
    breathing: opts.breathing === true,
    depthOuterRatio: NODE_DEPTH_OUTER_RATIO,
    depthOuterFill: color,
    depthOuterOpacity: dimmed ? 0 : NODE_DEPTH_OUTER_OPACITY,
    depthInnerRatio: dimmed ? 0 : NODE_DEPTH_INNER_RATIO,
    depthInnerFill: mixColorToward(color, resolveHighlightColor(palette), NODE_DEPTH_INNER_MIX),
    depthInnerOffsetRatio: NODE_DEPTH_INNER_OFFSET_RATIO,
    label: showLabel,
    labelText: showLabel ? labelText : '',
    labelFill: emphasized ? palette.fgStrong : labelFillForDepth(node.depth, palette),
    labelFontSize,
    labelFontWeight: emphasized ? 600 : 400,
    labelPlacement: 'bottom',
    labelBackground: false,
    labelMaxWidth,
    labelMaxLines: LABEL_MAX_LINES,
    labelWordWrap: !geometry.aggregate,
    labelTextOverflow: 'ellipsis',
    labelOffsetY: labelOffsetYFor(geometry.discRadius, geometry.footprintRadius),
  };

  if (node.collapsed === true) {
    style.aggregateRing = true;
    style.aggregateRingRatio = AGGREGATE_RING_RATIO;
    style.aggregateRingLineWidth = AGGREGATE_RING_LINE_WIDTH;
    style.aggregateRingStroke = mixColorToward(
      color,
      resolveHighlightColor(palette),
      AGGREGATE_RING_MIX,
    );
  } else {
    style.aggregateRing = false;
  }

  const countBadgeText = hubBadge ? formatAggregateCount(node.descendantCount ?? 0) : null;
  const phaseGlyph = geometry.badgeText ?? countBadgeText ?? artifactPhaseGlyph(node);
  const badgeFontSize = geometry.badge?.fontSize ?? hubBadge?.fontSize ?? null;
  // G6 `updateNodeData` 对 style 做浅合并：展开后必须显式写回 undefined，
  // 否则折叠时写入的计数徽标（iconText）会残留在已展开节点上。
  style.iconText = phaseGlyph ?? undefined;
  style.iconFill = phaseGlyph ? resolveGlyphColor(color, palette) : undefined;
  style.iconFontSize = phaseGlyph
    ? (badgeFontSize ?? Math.max(ICON_FONT_MIN, Math.round(size * ICON_FONT_RATIO)))
    : undefined;
  style.iconFontWeight = phaseGlyph ? 600 : undefined;

  return style;
}

/**
 * 生成 G6 边样式。曲线参数（`curveOffset` / `curvePosition`）由具体的曲线边类型消费，
 * 让 `contains` 轻拱、`derives` 更明显地绕行。
 * - `contains`：细、低透明度、无箭头，忽略动画。
 * - `derives`：带箭头 + 虚线；只有 `animating` 时才写入 `lineDashOffset`，
 *   自定义边据此启动流动动画，否则保持静态。
 */
export function buildEdgeStyle(
  edge: GraphEdgeModel,
  opts: {
    palette: GraphPalette;
    focused: boolean;
    dimmed: boolean;
    animating: boolean;
    /** 该边两端较大的 contains 度数；用于展开层级收敛边扇。缺省视为不挤。 */
    fan?: number;
    /** 该边两端节点的实际弦长（px）；大扇弯曲量随之增长并封顶。 */
    chordLength?: number;
    /**
     * 高扇未聚焦子边：不绘制（`visibility: hidden`）。同心环已表达层级，只在焦点邻域显示连接。
     * 只有 `contains` 消费该开关；`derives` 永远可见。
     */
    suppressed?: boolean;
  },
): Record<string, unknown> {
  const { palette, focused, dimmed, animating } = opts;
  const opacity = dimmed ? DIM_OPACITY : 1;

  if (edge.kind === 'contains') {
    const quiet = focused ? 1 : containsEdgeQuietFactor(opts.fan ?? 0);
    return {
      stroke: resolveEdgeColor('contains', focused ? 'focus' : 'base', palette),
      lineWidth: CONTAINS_LINE_WIDTH * quiet,
      strokeOpacity: (focused ? CONTAINS_FOCUS_STROKE_OPACITY : CONTAINS_STROKE_OPACITY) * quiet,
      opacity,
      endArrow: false,
      curveOffset: containsEdgeCurveOffset(opts.fan ?? 0, opts.chordLength ?? 0),
      curvePosition: CONTAINS_CURVE_POSITION,
      zIndex: focused ? Z_EDGE_FOCUS : Z_EDGE_CONTAINS,
      visibility: opts.suppressed === true ? 'hidden' : 'visible',
      halo: focused,
      haloStroke: palette.fgMuted,
      haloLineWidth: focused ? EDGE_HALO_WIDTH : 0,
      haloStrokeOpacity: focused ? EDGE_HALO_OPACITY : 0,
    };
  }

  const style: Record<string, unknown> = {
    stroke: resolveEdgeColor('derives', focused ? 'focus' : 'base', palette),
    lineWidth: focused ? DERIVES_LINE_WIDTH_FOCUS : DERIVES_LINE_WIDTH,
    strokeOpacity: focused ? DERIVES_FOCUS_STROKE_OPACITY : DERIVES_STROKE_OPACITY,
    opacity,
    lineDash: [DERIVES_DASH_ON, DERIVES_DASH_OFF],
    endArrow: focused,
    endArrowType: 'vee',
    endArrowSize: DERIVES_ARROW_SIZE,
    curveOffset: DERIVES_CURVE_OFFSET,
    curvePosition: DERIVES_CURVE_POSITION,
    zIndex: focused ? Z_EDGE_FOCUS : Z_EDGE_DERIVES,
    visibility: 'visible',
    halo: focused,
    haloStroke: palette.accent,
    haloLineWidth: focused ? EDGE_HALO_WIDTH : 0,
    haloStrokeOpacity: focused ? EDGE_HALO_OPACITY : 0,
  };

  if (focused && animating) {
    style.lineDashOffset = 0;
  }

  return style;
}
