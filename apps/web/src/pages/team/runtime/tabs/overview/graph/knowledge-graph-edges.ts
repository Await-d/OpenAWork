/**
 * 知识图谱边扩展。
 *
 * - `contains`：结构包含关系，使用内置曲线边 `quadratic`（`buildEdgeStyle` 给出温和的
 *   `curveOffset` / `curvePosition`），细、低透明度、无箭头，不再读作直线电线图。
 * - `derives`：知识派生流，注册自定义 `openawork-derives-edge`，继承内置 `Quadratic`，
 *   用更明显的拱形让跨链绕开图心；仅在元素带 `lineDashOffset`（聚焦 + 动画开启）时用
 *   `lineDashOffset` 做流动虚线动画。
 *
 * 动画规则：只有 `derives` 边、且处于聚焦态时才流动；`prefers-reduced-motion: reduce`
 * 时完全静止。同一时刻只有一种动画，避免旧渲染器多动画叠加的问题。
 */

import { ExtensionCategory, Quadratic, register } from '@antv/g6';
import type { GraphEdgeKind } from '../../../data/build-knowledge-graph.js';

export const CONTAINS_EDGE_TYPE = 'quadratic';
export const DERIVES_EDGE_TYPE = 'openawork-derives-edge';

/**
 * 「高扇 contains 子边」抑制阈值（DEFECT A 的形态修复）。
 *
 * 展开一个大分类后，其父节点会一次性挂出几十条 `contains` 子边，在同心环内读作径向星芒
 * （starburst），把层级结构本身淹没——单纯调低透明度 / 加一点曲率只是「化妆」，没有改变
 * 形态。同心环已经完整表达了层级，因此**非聚焦**时不再绘制「可见子边数 > 该阈值」的父节点的
 * 子边；小扇（例如 3 个子节点）不是问题，保留绘制。
 *
 * 阈值取 `fan > 12`：12 条以内的扇仍能顺边读出「谁属于谁」，超过后径向线条开始互相重叠成
 * 噪声。注意这里用的是该边两端**较大的 `contains` 度数**（与样式层的 `fan` 同源），
 * 因此高扇父节点连出的每一条子边都会被抑制，而低扇父节点的子边不受影响。
 */
export const HIGH_DEGREE_CONTAINS_THRESHOLD = 12;

/** 该 `contains` 边是否属于「高扇子边」（仅用于非聚焦态抑制，不改变聚焦语义）。 */
export function isHighDegreeContainsFan(fanCount: number): boolean {
  return Number.isFinite(fanCount) && fanCount > HIGH_DEGREE_CONTAINS_THRESHOLD;
}

/**
 * 是否抑制该边：只有**未处于焦点邻域的高扇 `contains` 子边**才抑制。
 * `derives` 跨层知识流永远不抑制；聚焦（hover / 选中）时高扇子边按现有强调规则重新显示，
 * 用户看哪里就显示哪里的连接。`lineDashOffset` 流动开关语义完全不变。
 */
export function shouldSuppressContainsEdge(input: {
  readonly kind: GraphEdgeKind;
  readonly fan: number;
  readonly focused: boolean;
}): boolean {
  return input.kind === 'contains' && !input.focused && isHighDegreeContainsFan(input.fan);
}

const FLOW_DASH_ON = 10;
const FLOW_DASH_OFF = 6;
const FLOW_DASH_PERIOD = FLOW_DASH_ON + FLOW_DASH_OFF;
const FLOW_DURATION_MS = 1200;
const FLOW_EASING = 'linear';

const CONTAINS_FAN_CALM_THRESHOLD = 4;
const CONTAINS_FAN_MAX_THRESHOLD = 28;
const CONTAINS_FAN_MIN_FACTOR = 0.34;
const CONTAINS_CURVE_OFFSET = 8;
const CONTAINS_FAN_BOW_RATIO = 0.42;
const CONTAINS_FAN_BOW_MAX = 64;
const CONTAINS_FAN_CHORD_MIN = 24;
const CONTAINS_FAN_CHORD_MAX = 320;

/**
 * 扇越大越安静：≤4 条保持全量，≥28 条压到 `CONTAINS_FAN_MIN_FACTOR`，中间线性过渡。
 * 只影响非聚焦 contains 边的线宽与不透明度，是「60 条边读成噪声」的第一道收敛。
 */
export function containsEdgeQuietFactor(fanCount: number): number {
  if (!Number.isFinite(fanCount) || fanCount <= CONTAINS_FAN_CALM_THRESHOLD) {
    return 1;
  }
  const span = CONTAINS_FAN_MAX_THRESHOLD - CONTAINS_FAN_CALM_THRESHOLD;
  const ratio = Math.min(1, (fanCount - CONTAINS_FAN_CALM_THRESHOLD) / span);
  return 1 - ratio * (1 - CONTAINS_FAN_MIN_FACTOR);
}

/**
 * contains 边的 signed 曲率（G6 内置 `quadratic` 的 `curveOffset`，单位 px）。
 *
 * 目的：让同一父节点的兄弟边沿同一旋转方向成束离开，父节点邻域读作「一束连接」而不是
 * 星芒。小扇（折叠概览）保持原有 8px 温和拱形，视觉不回归；扇越大、弦越长弯曲越明显；
 * 弦长短于 `CONTAINS_FAN_CHORD_MIN` 的边保持温和，否则相邻环带间的短线会被弯成弹簧圈。
 * 方向恒为正（`curveOffset` 沿弦法线取值），因此全图弯曲方向一致、有序。
 */
export function containsEdgeCurveOffset(fanCount: number, chordLength: number): number {
  const quiet = containsEdgeQuietFactor(fanCount);
  const fanScale = (1 - quiet) / (1 - CONTAINS_FAN_MIN_FACTOR);
  if (fanScale <= 0) {
    return CONTAINS_CURVE_OFFSET;
  }
  const safeChord = Number.isFinite(chordLength) ? chordLength : 0;
  const bowChord = Math.max(
    0,
    Math.min(CONTAINS_FAN_CHORD_MAX, safeChord) - CONTAINS_FAN_CHORD_MIN,
  );
  const bow = Math.min(CONTAINS_FAN_BOW_MAX, bowChord * CONTAINS_FAN_BOW_RATIO);
  return CONTAINS_CURVE_OFFSET + fanScale * bow;
}

/** 仅依赖 `cancel`，避免引入 @antv/g 的直接类型依赖（非 web 直接依赖）。 */
interface FlowAnimationLike {
  cancel: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

class OpenAWorkDerivesEdge extends Quadratic {
  private flowAnimation: FlowAnimationLike | null = null;

  onCreate(): void {
    this.syncFlowAnimation();
  }

  onUpdate(): void {
    this.syncFlowAnimation();
  }

  onDestroy(): void {
    this.stopFlowAnimation();
  }

  /** `buildEdgeStyle` 只在「聚焦 + animating」时写入 `lineDashOffset`，以此作为流动开关。 */
  private shouldFlow(): boolean {
    return typeof this.attributes.lineDashOffset === 'number';
  }

  private syncFlowAnimation(): void {
    if (!this.shouldFlow() || prefersReducedMotion()) {
      this.stopFlowAnimation();
      return;
    }
    if (this.flowAnimation) {
      return;
    }
    const keyShape = this.shapeMap.key;
    if (!keyShape) {
      return;
    }
    keyShape.attr({ lineDashOffset: 0 });
    this.flowAnimation = keyShape.animate(
      [{ lineDashOffset: 0 }, { lineDashOffset: -FLOW_DASH_PERIOD }],
      { duration: FLOW_DURATION_MS, iterations: Infinity, easing: FLOW_EASING },
    );
  }

  private stopFlowAnimation(): void {
    if (!this.flowAnimation) {
      return;
    }
    this.flowAnimation.cancel();
    this.flowAnimation = null;
    this.shapeMap.key?.attr({ lineDashOffset: 0 });
  }
}

let graphEdgeExtensionsRegistered = false;

/** 幂等注册边扩展。`contains` 使用内置 `quadratic`，无需注册。 */
export function registerGraphEdgeExtensions(): void {
  if (graphEdgeExtensionsRegistered) {
    return;
  }
  graphEdgeExtensionsRegistered = true;
  register(ExtensionCategory.EDGE, DERIVES_EDGE_TYPE, OpenAWorkDerivesEdge);
}
