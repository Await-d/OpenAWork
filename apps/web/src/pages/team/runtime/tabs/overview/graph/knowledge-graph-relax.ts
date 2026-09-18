/**
 * 知识图谱 · 有界弛豫层（弹性跟随）。
 *
 * 目标：拖拽节点时让邻域**柔和让位**，松手后稳定在松弛位置，而不是每帧跑无界物理模拟
 * （旧渲染器的缺陷）。因此本模块是一个**按需计算**的纯函数：
 *   - 固定迭代次数 + 逐步衰减的步长（alpha）⇒ 必然收敛、必然终止；
 *   - 迭代顺序固定、无随机源 ⇒ 相同输入得到逐位相同输出；
 *   - 未固定节点有一条指向基准位置的弱弹簧 ⇒ 没有 pin 时回到设计好的径向形态；
 *   - 以「重叠软排斥」处理邻域避让，并在收敛判据下提前退出。
 *
 * 计算范围被限制在 pin 的影响半径内（bounded neighbourhood），因此重绘成本与图规模无关。
 */

import type { PositionedNode } from './knowledge-graph-layout.js';
import type { GraphPinMap } from './knowledge-graph-pins.js';

/** 弛豫后的坐标（图坐标系）。 */
export interface RelaxPosition {
  readonly x: number;
  readonly y: number;
}

export interface RelaxOptions {
  /** 最大迭代次数（硬上限，保证终止）。 */
  readonly iterations?: number;
  /** 初始步长。 */
  readonly initialStep?: number;
  /** 步长衰减系数（每轮的 alpha 乘数）。 */
  readonly decay?: number;
  /** 指向基准位置的弱弹簧强度。 */
  readonly springStrength?: number;
  /** 重叠软排斥强度。 */
  readonly repulsionStrength?: number;
  /** 影响半径系数：`factor × (半径和)` 之外不再施加排斥。 */
  readonly influenceFactor?: number;
  /** 单轮最大位移低于该值即认为收敛并提前退出。 */
  readonly epsilon?: number;
}

const DEFAULT_ITERATIONS = 48;
const DEFAULT_INITIAL_STEP = 0.55;
const DEFAULT_DECAY = 0.9;
const DEFAULT_SPRING_STRENGTH = 0.16;
const DEFAULT_REPULSION_STRENGTH = 0.9;
const DEFAULT_INFLUENCE_FACTOR = 2.1;
const DEFAULT_EPSILON = 0.05;
const MIN_DISTANCE = 1e-3;

interface RelaxPoint {
  readonly id: string;
  readonly baseX: number;
  readonly baseY: number;
  readonly radius: number;
  x: number;
  y: number;
}

function resolveOptions(options: RelaxOptions): Required<RelaxOptions> {
  return {
    iterations: options.iterations ?? DEFAULT_ITERATIONS,
    initialStep: options.initialStep ?? DEFAULT_INITIAL_STEP,
    decay: options.decay ?? DEFAULT_DECAY,
    springStrength: options.springStrength ?? DEFAULT_SPRING_STRENGTH,
    repulsionStrength: options.repulsionStrength ?? DEFAULT_REPULSION_STRENGTH,
    influenceFactor: options.influenceFactor ?? DEFAULT_INFLUENCE_FACTOR,
    epsilon: options.epsilon ?? DEFAULT_EPSILON,
  };
}

function pairInfluence(left: RelaxPoint, right: RelaxPoint, factor: number): number {
  return factor * (left.radius + right.radius);
}

/**
 * 参与弛豫的节点集合：所有被 pin 的节点，加上落在任一 pin 影响半径内的未固定节点。
 * 其余节点不移动，直接沿用基准坐标——这是「有界邻域」的实现方式。
 */
function collectActiveIds(
  points: readonly RelaxPoint[],
  pinnedIds: ReadonlySet<string>,
  factor: number,
): Set<string> {
  const active = new Set<string>();
  for (const point of points) {
    if (pinnedIds.has(point.id)) {
      active.add(point.id);
      continue;
    }
    for (const other of points) {
      if (!pinnedIds.has(other.id)) {
        continue;
      }
      const distance = Math.hypot(point.x - other.x, point.y - other.y);
      if (distance < pairInfluence(point, other, factor)) {
        active.add(point.id);
        break;
      }
    }
  }
  return active;
}

/**
 * 弛豫计算：`base` 来自 `layoutRadialTree`，`pins` 为硬约束（永不移动）。
 * 返回**所有**节点的坐标映射；未固定且不受影响者即基准坐标。
 */
export function relaxGraphPositions(
  base: readonly PositionedNode[],
  pins: GraphPinMap,
  options: RelaxOptions = {},
): Map<string, RelaxPosition> {
  const resolved = resolveOptions(options);
  const points: RelaxPoint[] = base.map((node) => ({
    id: node.model.id,
    baseX: node.x,
    baseY: node.y,
    radius: node.radius,
    x: node.x,
    y: node.y,
  }));

  const result = new Map<string, RelaxPosition>();
  const pinnedIds = new Set<string>();
  for (const point of points) {
    const pin = pins.get(point.id);
    if (pin && Number.isFinite(pin.x) && Number.isFinite(pin.y)) {
      pinnedIds.add(point.id);
      point.x = pin.x;
      point.y = pin.y;
    }
  }

  // 无固定点：设计布局本身即松弛形态，直接返回，避免无谓运算与任何漂移。
  if (pinnedIds.size > 0) {
    const activeIds = collectActiveIds(points, pinnedIds, resolved.influenceFactor);
    const active = points.filter((point) => activeIds.has(point.id) && !pinnedIds.has(point.id));
    const anchors = points.filter((point) => pinnedIds.has(point.id) || activeIds.has(point.id));

    for (let iteration = 0; iteration < resolved.iterations; iteration += 1) {
      const alpha = resolved.initialStep * Math.pow(resolved.decay, iteration);
      if (alpha <= 0) {
        break;
      }
      let maxMove = 0;
      for (const point of active) {
        let forceX = resolved.springStrength * (point.baseX - point.x);
        let forceY = resolved.springStrength * (point.baseY - point.y);

        for (const other of anchors) {
          if (other.id === point.id) {
            continue;
          }
          const dx = point.x - other.x;
          const dy = point.y - other.y;
          const distance = Math.max(MIN_DISTANCE, Math.hypot(dx, dy));
          const influence = pairInfluence(point, other, resolved.influenceFactor);
          if (distance >= influence) {
            continue;
          }
          const falloff = 1 - distance / influence;
          const push = resolved.repulsionStrength * falloff * falloff;
          forceX += (dx / distance) * push;
          forceY += (dy / distance) * push;
        }

        const stepX = alpha * forceX;
        const stepY = alpha * forceY;
        point.x += stepX;
        point.y += stepY;
        maxMove = Math.max(maxMove, Math.hypot(stepX, stepY));
      }
      if (maxMove < resolved.epsilon) {
        break;
      }
    }
  }

  for (const point of points) {
    result.set(point.id, { x: point.x, y: point.y });
  }
  return result;
}
