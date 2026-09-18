/**
 * 知识图谱节点扩展。
 *
 * 节点视觉 = 「体积感叠加」+「G6 主题 state」+「数据驱动样式」：
 * - 深度：`buildNodeStyle` 按组语义色向背景混合（明度变化）。
 * - 体积：自定义 `openawork-node` 在 key 圆之外**叠加实心圆盘**（外层低透明度柔光 + 偏心高光），
 *   WebGL 主层不保证渐变 / shadow，因此用 token 派生的实心形状合成，而非滤镜。
 * - artifact 阶段：`iconText` 单字缩写，而不是 7 个阶段节点类。
 * - 已入库：主题 `persisted` state 提供可见标识，而不是新节点类。
 *
 * 形状通过 G6 已注册的 `SHAPE` 扩展名（`'circle'`）引用，避免引入 `@antv/g` 直接依赖。
 */

import { Circle, ExtensionCategory, register } from '@antv/g6';
import { prefersReducedMotion } from './knowledge-graph-theme.js';

export const GRAPH_NODE_TYPE = 'openawork-node';

const SHAPE_CIRCLE = 'circle';

type NodeRenderAttributes = Parameters<Circle['render']>[0];
type NodeRenderContainer = NonNullable<Parameters<Circle['render']>[1]>;

interface DepthStyle {
  readonly outerRatio: number;
  readonly outerFill: string;
  readonly outerOpacity: number;
  readonly innerRatio: number;
  readonly innerFill: string;
  readonly innerOffsetRatio: number;
}

function readNumber(source: Readonly<Record<string, unknown>>, key: string, fallback = 0): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readColor(source: Readonly<Record<string, unknown>>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : 'transparent';
}

function readDepthStyle(source: Readonly<Record<string, unknown>>): DepthStyle | null {
  if (source.depthOuterFill === undefined && source.depthInnerFill === undefined) {
    return null;
  }
  return {
    outerRatio: readNumber(source, 'depthOuterRatio'),
    outerFill: readColor(source, 'depthOuterFill'),
    outerOpacity: readNumber(source, 'depthOuterOpacity'),
    innerRatio: readNumber(source, 'depthInnerRatio'),
    innerFill: readColor(source, 'depthInnerFill'),
    innerOffsetRatio: readNumber(source, 'depthInnerOffsetRatio'),
  };
}

/** 折叠聚合「有隐藏子节点」环的样式（仅 `aggregateRing === true` 时生效）。 */
interface AggregateRingStyle {
  readonly ratio: number;
  readonly stroke: string;
  readonly lineWidth: number;
}

function readAggregateRingStyle(
  source: Readonly<Record<string, unknown>>,
): AggregateRingStyle | null {
  if (source.aggregateRing !== true) {
    return null;
  }
  const stroke = readColor(source, 'aggregateRingStroke');
  const ratio = readNumber(source, 'aggregateRingRatio', 1.24);
  if (stroke === 'transparent' || ratio <= 1) {
    return null;
  }
  return { ratio, stroke, lineWidth: readNumber(source, 'aggregateRingLineWidth', 2) };
}

/**
 * 自定义节点：在 key 圆前后各插一层实心盘。
 * - `depth-outer`：key 之前追加 → 位于主体之下，低透明度柔光盘，读作向外的径向衰减。
 * - `depth-sheen`：key / halo 之后、icon / 徽标 / 标签之前追加、偏心左上 → **不透明**的浅色盘，
 *   读作受光高光。插入点必须在文字之前，否则后置的高光盘会盖住盘内计数（`iconText`）的首位数字。
 *
 * ⚠️ 不透明是刻意的：WebGL 主层下**半透明填充会与背景合成、忽略更早绘制的兄弟图形**，
 * 因此叠加高光必须用「预先向主体色混合好的实心色」表达，而不是靠 `opacity`。
 *
 * 两层都 `pointerEvents: 'none'`，命中判定仍由 key 圆承担。
 */
interface BreathingAnimation {
  cancel: () => void;
}

const BREATH_DURATION_MS = 1500;
const BREATH_MIN_OPACITY = 0.16;
const BREATH_MAX_OPACITY = 0.56;

class OpenAWorkNode extends Circle {
  private breathingAnimation: BreathingAnimation | null = null;

  onCreate(): void {
    this.syncBreathing();
  }

  onUpdate(): void {
    this.syncBreathing();
  }

  onDestroy(): void {
    this.stopBreathing();
  }

  /**
   * 焦点锚点（hovered ?? selected 本身）的单一路径呼吸高光：整图同一时刻至多一个实例，
   * `prefers-reduced-motion: reduce` 时完全不启动。这是「活的」反馈，不是环境装饰动画。
   */
  private syncBreathing(): void {
    const attributes = this.parsedAttributes as unknown as Readonly<Record<string, unknown>>;
    if (attributes.breathing !== true || prefersReducedMotion()) {
      this.stopBreathing();
      return;
    }
    if (this.breathingAnimation) {
      return;
    }
    const halo = this.getShape('halo') ?? this.getShape('key');
    if (!halo) {
      return;
    }
    this.breathingAnimation = halo.animate(
      [
        { haloStrokeOpacity: BREATH_MIN_OPACITY },
        { haloStrokeOpacity: BREATH_MAX_OPACITY },
        { haloStrokeOpacity: BREATH_MIN_OPACITY },
      ],
      { duration: BREATH_DURATION_MS, iterations: Infinity, easing: 'ease-in-out' },
    );
  }

  private stopBreathing(): void {
    if (!this.breathingAnimation) {
      return;
    }
    this.breathingAnimation.cancel();
    this.breathingAnimation = null;
  }

  private depthStyle(): DepthStyle | null {
    const attributes = this.parsedAttributes as unknown as Readonly<Record<string, unknown>>;
    return readDepthStyle(attributes);
  }

  private radiusOf(attributes: NodeRenderAttributes): number {
    const key = this.getShape('key');
    if (key && typeof key.attributes === 'object' && key.attributes !== null) {
      const value = (key.attributes as unknown as Readonly<Record<string, unknown>>).r;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return Math.min(...this.getSize(attributes)) / 2;
  }

  private drawOuter(depth: DepthStyle, radius: number, container: NodeRenderContainer): void {
    const style =
      depth.outerOpacity > 0 && depth.outerRatio > 0
        ? {
            r: radius * depth.outerRatio,
            fill: depth.outerFill,
            opacity: depth.outerOpacity,
            pointerEvents: 'none' as const,
          }
        : false;
    this.upsert('depth-outer', SHAPE_CIRCLE, style, container);
  }

  private drawSheen(depth: DepthStyle, radius: number, container: NodeRenderContainer): void {
    const innerRadius = radius * depth.innerRatio;
    const style =
      innerRadius > 0
        ? {
            r: innerRadius,
            cx: radius * depth.innerOffsetRatio,
            cy: radius * depth.innerOffsetRatio,
            fill: depth.innerFill,
            pointerEvents: 'none' as const,
          }
        : false;
    this.upsert('depth-sheen', SHAPE_CIRCLE, style, container);
  }

  /** 描边环：落在节点本体之外，读作「仍可继续展开」。仅折叠聚合节点绘制。 */
  private drawAggregateRing(
    ring: AggregateRingStyle,
    radius: number,
    container: NodeRenderContainer,
  ): void {
    this.upsert(
      'aggregate-ring',
      SHAPE_CIRCLE,
      {
        r: radius * ring.ratio,
        fill: 'none',
        stroke: ring.stroke,
        lineWidth: ring.lineWidth,
        pointerEvents: 'none' as const,
      },
      container,
    );
  }

  /**
   * 高光插入点。G6 基类 `render` 的绘制顺序是 key → halo → icon → badge → label → port，
   * `upsert` 以调用顺序 `appendChild`，因此在这里「先画 sheen 再委托 super」即可得到
   * key → halo → sheen → icon → …：高光盘位于节点填充之上、盘内计数文字之下，
   * 计数（`iconText`）不再被高光遮挡。
   */
  protected override drawIconShape(
    attributes: NodeRenderAttributes,
    container: NodeRenderContainer,
  ): void {
    const depth = this.depthStyle();
    if (depth) {
      this.drawSheen(depth, this.radiusOf(attributes), container);
    }
    if (attributes) {
      super.drawIconShape(attributes, container);
    }
  }

  override render(
    attributes: NodeRenderAttributes,
    container: Parameters<Circle['render']>[1],
  ): void {
    const target: NodeRenderContainer = container ?? this;
    const depth = this.depthStyle();
    const aggregateRing = readAggregateRingStyle(
      this.parsedAttributes as unknown as Readonly<Record<string, unknown>>,
    );
    if (depth) {
      this.drawOuter(depth, this.radiusOf(attributes), target);
    }
    super.render(attributes, target);
    if (aggregateRing) {
      this.drawAggregateRing(aggregateRing, this.radiusOf(attributes), target);
    } else {
      this.upsert('aggregate-ring', SHAPE_CIRCLE, false, target);
    }
  }
}

let graphNodeExtensionsRegistered = false;

/** 幂等注册自定义节点类。 */
export function registerGraphNodeExtensions(): void {
  if (graphNodeExtensionsRegistered) {
    return;
  }
  graphNodeExtensionsRegistered = true;
  register(ExtensionCategory.NODE, GRAPH_NODE_TYPE, OpenAWorkNode);
}
