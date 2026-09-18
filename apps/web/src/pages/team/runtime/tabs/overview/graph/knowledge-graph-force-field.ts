/**
 * 知识图谱 · 力场解算核心（纯函数，无 DOM / G6 / React）。
 *
 * 从 `knowledge-graph-force.ts` 拆出：本模块只负责「把种子编译成力场状态」与「跑有界迭代」，
 * 公开入口（布局 / reheating / 缓存 / 重叠度量）在 `knowledge-graph-force.ts`。
 *
 * 四类力：空间哈希斥力（距离衰减 + 重叠硬化）、`contains` 连杆吸引、同组内聚、全局向心。
 * 稳定步长 + 速度阻尼 + 力平衡判据，保证必然收敛、终止、可幂等重放。
 */

import type { GraphNodeGroup, GraphNodeKind } from '../../../data/build-knowledge-graph.js';
import {
  COLLISION_DISTANCE_RATIO,
  GRAPH_VIEW_HEIGHT,
  GRAPH_VIEW_WIDTH,
  graphLayoutMargin,
  graphMaxRadiusForViewport,
  isShallowOverview,
  seededUnit,
  type GraphViewportSize,
  type PositionedNode,
} from './knowledge-graph-layout.js';
import type { GraphModel } from './knowledge-graph-model.js';
import type { GraphPinMap } from './knowledge-graph-pins.js';
import { buildSpatialHash, cellKey } from './knowledge-graph-spatial-hash.js';

export interface ForceLayoutOptions {
  /** 迭代上限（硬上限，保证终止）。缺省按可见节点数自适应。 */
  readonly iterations?: number;
  /** 初始步长（alpha）。 */
  readonly initialAlpha?: number;
  /** 每轮 alpha 衰减系数。 */
  readonly decay?: number;
  /** alpha 衰减下限；越低越贴近力平衡、但需要更多轮。 */
  readonly alphaFloor?: number;
  /** 单轮最大位移（px）。 */
  readonly maxStep?: number;
  /** 单轮最大**剩余合力**低于该值即视为到达力平衡并提前退出。 */
  readonly epsilon?: number;
}

export type ResolvedForceOptions = Required<
  Pick<ForceLayoutOptions, 'initialAlpha' | 'decay' | 'maxStep' | 'epsilon'>
> & { readonly alphaFloor: number };

/** 斥力影响半径系数：`factor × (rA + rB)` 之外不再施加斥力。 */
export const REPULSION_INFLUENCE_FACTOR = 2.4;
const REPULSION_STRENGTH = 100;
const OVERLAP_STRENGTH = 30;
const LINK_STRENGTH = 0.13;
/** 非直接父子连边的静息长度在半径和之外额外留出的净空。 */
const LINK_GAP = 30;
/** 直接父子连边的额外净空（更短 ⇒ 子树紧贴父节点）。 */
const SHORT_LINK_GAP = 2;
const LINK_MAX_DELTA = 180;
const GROUP_STRENGTH = 0.05;
/** 同组内聚合力上限（px/轮）：必须低于接触处软斥力，否则父节点会被拖进子簇。 */
const GROUP_MAX_FORCE = 6;
const GLOBAL_CENTER_STRENGTH = 0.03;
/** 全局向心合力上限（px/轮）。 */
const GLOBAL_MAX_FORCE = 4;
const WORKSPACE_CENTER_STRENGTH = 0.4;
/** 工作区枢纽向心合力上限（px/轮）：枢纽要稳居中，允许比普通节点强。 */
const WORKSPACE_MAX_FORCE = 24;
/**
 * 初始 alpha 取「稳定步长」而非 1：位移整合的稳定性要求 `alpha × 刚度 < 2`，
 * 而局部重叠项刚度可达 ~1/px、节点邻域又有多对，α=1 会把能量灌进来形成极限环。
 * 0.35 在实测里单调收敛。
 */
const DEFAULT_INITIAL_ALPHA = 0.35;
const DEFAULT_DECAY = 0.97;
/** alpha 下限：保持稳定步长逼近力平衡，而不是靠 alpha→0 假性冻结。 */
const ALPHA_FLOOR = 0.2;
/**
 * 速度阻尼：位移由「速度」驱动而非直接由合力驱动（速度每轮先乘该系数）。
 * 低通滤波消除大步长下的来回振荡，令系统真正收敛到力平衡；这是「settle」幂等的前提。
 */
const VELOCITY_DECAY = 0.55;
const DEFAULT_MAX_STEP = 10;
/** 力平衡判据：最大剩余合力低于该值即收敛（力单位，非位移）。 */
const DEFAULT_EPSILON = 0.6;
const SMALL_ITERATIONS = 900;
const MID_ITERATIONS = 650;
const LARGE_ITERATIONS = 420;
const MIN_DISTANCE = 1e-3;

interface ForceLink {
  readonly a: number;
  readonly b: number;
  readonly restLength: number;
}

export interface ForceState {
  readonly ids: readonly string[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly radii: Float64Array;
  /** 斥力有效半径系数：枢纽（workspace / category）要更大，否则会被自己的子簇挤进盘内。 */
  readonly repulsionBoost: Float64Array;
  readonly fixed: Uint8Array;
  readonly groupIndex: Int32Array;
  readonly groupCount: number;
  readonly links: readonly ForceLink[];
}

export interface Bounds {
  readonly centerX: number;
  readonly centerY: number;
  readonly maxRadius: number;
  readonly maxRadiusX: number;
}

function resolveDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function repulsionBoostForKind(kind: GraphNodeKind): number {
  if (kind === 'workspace') {
    return 2.4;
  }
  if (kind === 'category') {
    return 1.8;
  }
  return 1;
}

/** 影响半径：两盘（已乘斥力系数）半径和 × 系数。 */
function influenceRadius(radiusA: number, radiusB: number): number {
  return REPULSION_INFLUENCE_FACTOR * (radiusA + radiusB);
}

/** 确定性分离方向：坐标重合时用 id 对哈希派生角度，绝不用随机源。 */
function fallbackDirection(idA: string, idB: string): { readonly x: number; readonly y: number } {
  const angle = seededUnit(`${idA}|${idB}`) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function clampToBounds(state: ForceState, index: number, bounds: Bounds): void {
  let dx = state.xs[index]! - bounds.centerX;
  let dy = state.ys[index]! - bounds.centerY;
  if (Number.isFinite(bounds.maxRadiusX)) {
    dx = Math.min(bounds.maxRadiusX, Math.max(-bounds.maxRadiusX, dx));
  }
  const rho = Math.hypot(dx, dy);
  if (rho > bounds.maxRadius && rho > 0 && Number.isFinite(bounds.maxRadius)) {
    const scale = bounds.maxRadius / rho;
    dx *= scale;
    dy *= scale;
  }
  state.xs[index] = bounds.centerX + dx;
  state.ys[index] = bounds.centerY + dy;
}

export function resolveBounds(
  viewport: GraphViewportSize,
  maxDepth: number,
  hasRoot: boolean,
): Bounds {
  const width = resolveDimension(viewport.width, GRAPH_VIEW_WIDTH);
  const height = resolveDimension(viewport.height, GRAPH_VIEW_HEIGHT);
  const shallow = isShallowOverview(hasRoot, maxDepth);
  const margin = graphLayoutMargin(shallow);
  return {
    centerX: width / 2,
    centerY: height / 2,
    maxRadius: graphMaxRadiusForViewport({ width, height }, { shallowOverview: shallow }),
    maxRadiusX: Math.max(0, width / 2 - margin),
  };
}

export function resolveOptions(options: ForceLayoutOptions): ResolvedForceOptions {
  return {
    initialAlpha: options.initialAlpha ?? DEFAULT_INITIAL_ALPHA,
    decay: options.decay ?? DEFAULT_DECAY,
    alphaFloor: options.alphaFloor ?? ALPHA_FLOOR,
    maxStep: options.maxStep ?? DEFAULT_MAX_STEP,
    epsilon: options.epsilon ?? DEFAULT_EPSILON,
  };
}

function resolveIterations(n: number, requested?: number): number {
  if (requested !== undefined) {
    return Math.max(1, Math.floor(requested));
  }
  if (n <= 200) {
    return SMALL_ITERATIONS;
  }
  return n <= 600 ? MID_ITERATIONS : LARGE_ITERATIONS;
}

export function resolveIterationCount(n: number, requested?: number): number {
  return resolveIterations(n, requested);
}

/** 把种子节点 + 模型边编译成力场状态。pins 中的节点记为固定。 */
export function buildForceState(
  seed: readonly PositionedNode[],
  model: GraphModel,
  pins: GraphPinMap,
): ForceState {
  const ids: string[] = [];
  const indexById = new Map<string, number>();
  for (let index = 0; index < seed.length; index += 1) {
    const entry = seed[index];
    if (!entry) {
      continue;
    }
    ids.push(entry.model.id);
    indexById.set(entry.model.id, ids.length - 1);
  }
  const count = ids.length;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const radii = new Float64Array(count);
  const repulsionBoost = new Float64Array(count);
  const fixed = new Uint8Array(count);
  const groupOrder: GraphNodeGroup[] = [];
  const groupIndexByGroup = new Map<GraphNodeGroup, number>();
  const groupIndex = new Int32Array(count);

  for (let index = 0; index < count; index += 1) {
    const entry = seed[index];
    if (!entry) {
      continue;
    }
    const pin = pins.get(entry.model.id);
    if (pin && Number.isFinite(pin.x) && Number.isFinite(pin.y)) {
      xs[index] = pin.x;
      ys[index] = pin.y;
      fixed[index] = 1;
    } else {
      xs[index] = Number.isFinite(entry.x) ? entry.x : 0;
      ys[index] = Number.isFinite(entry.y) ? entry.y : 0;
    }
    radii[index] = Math.max(1, entry.radius);
    repulsionBoost[index] = repulsionBoostForKind(entry.model.kind);
    const group = entry.model.group;
    let groupIndexValue = groupIndexByGroup.get(group);
    if (groupIndexValue === undefined) {
      groupIndexValue = groupOrder.length;
      groupOrder.push(group);
      groupIndexByGroup.set(group, groupIndexValue);
    }
    groupIndex[index] = groupIndexValue;
  }

  const parentChild = new Set<string>();
  for (const [parentId, children] of model.childrenOf) {
    for (const childId of children) {
      parentChild.add(`${parentId}|${childId}`);
    }
  }

  // 只有 `contains` 参与连杆吸引力；`derives` 是跨层旁支，不能把两个远房聚类拉在一起。
  const links: ForceLink[] = [];
  for (const edge of model.edges) {
    if (edge.kind !== 'contains') {
      continue;
    }
    const a = indexById.get(edge.from);
    const b = indexById.get(edge.to);
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    const short = parentChild.has(`${edge.from}|${edge.to}`);
    links.push({
      a,
      b,
      restLength: radii[a]! + radii[b]! + (short ? SHORT_LINK_GAP : LINK_GAP),
    });
  }

  return {
    ids,
    indexById,
    xs,
    ys,
    radii,
    repulsionBoost,
    fixed,
    groupIndex,
    groupCount: groupOrder.length,
    links,
  };
}

/**
 * 力模拟核心。返回终止时的**最大剩余合力**（收敛度量）。
 * `active` 为 null 时全体非固定节点参与；否则仅 `active[index] === 1` 的节点可动，
 * 其余视为静止锚点（拖拽 reheating 的有界邻域）。
 */
export function runForceIterations(
  state: ForceState,
  bounds: Bounds,
  options: ResolvedForceOptions,
  iterations: number,
  active: Uint8Array | null,
): number {
  const { xs, ys, radii, repulsionBoost, fixed, groupIndex, groupCount, links, ids } = state;
  const n = xs.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const groupCx = new Float64Array(groupCount);
  const groupCy = new Float64Array(groupCount);
  const groupCounts = new Float64Array(groupCount);
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < n; index += 1) {
    points.push({ x: xs[index]!, y: ys[index]! });
  }
  let maxEffectiveRadius = 0;
  for (let index = 0; index < n; index += 1) {
    maxEffectiveRadius = Math.max(maxEffectiveRadius, radii[index]! * repulsionBoost[index]!);
  }
  // 单元边长需覆盖「任意可能相撞对」的 required 距离（`(effA+effB)×1.12`），
  // 3×3 邻域即可命中全部相交对；更远的软斥力尾随手长顺带，缺失不影响零重叠。
  const cellSize = Math.max(16, 2.24 * maxEffectiveRadius);

  const isFixed = (index: number): boolean =>
    fixed[index] === 1 || (active !== null && active[index] !== 1);

  let lastMaxForce = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const alpha = Math.max(
      options.alphaFloor,
      options.initialAlpha * Math.pow(options.decay, iteration),
    );
    for (let index = 0; index < n; index += 1) {
      points[index]!.x = xs[index]!;
      points[index]!.y = ys[index]!;
    }
    fx.fill(0);
    fy.fill(0);

    // 组质心（实时）。
    groupCx.fill(0);
    groupCy.fill(0);
    groupCounts.fill(0);
    for (let index = 0; index < n; index += 1) {
      const group = groupIndex[index]!;
      groupCx[group] = groupCx[group]! + xs[index]!;
      groupCy[group] = groupCy[group]! + ys[index]!;
      groupCounts[group] = groupCounts[group]! + 1;
    }
    for (let group = 0; group < groupCount; group += 1) {
      const size = groupCounts[group]!;
      if (size > 0) {
        groupCx[group] = groupCx[group]! / size;
        groupCy[group] = groupCy[group]! / size;
      }
    }

    // 1. 空间哈希斥力。
    const hash = buildSpatialHash(points, cellSize);
    for (let index = 0; index < n; index += 1) {
      const origin = points[index]!;
      const cellX = Math.floor(origin.x / cellSize);
      const cellY = Math.floor(origin.y / cellSize);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const bucket = hash.buckets.get(cellKey(cellX + offsetX, cellY + offsetY));
          if (!bucket) {
            continue;
          }
          for (const other of bucket) {
            if (other <= index) {
              continue;
            }
            if (isFixed(index) && isFixed(other)) {
              continue;
            }
            const dx = origin.x - points[other]!.x;
            const dy = origin.y - points[other]!.y;
            const distance = Math.max(MIN_DISTANCE, Math.hypot(dx, dy));
            const effectiveIndex = radii[index]! * repulsionBoost[index]!;
            const effectiveOther = radii[other]! * repulsionBoost[other]!;
            const influence = influenceRadius(effectiveIndex, effectiveOther);
            if (distance >= influence) {
              continue;
            }
            const falloff = 1 - distance / influence;
            let magnitude = REPULSION_STRENGTH * falloff * falloff;
            const required = COLLISION_DISTANCE_RATIO * (radii[index]! + radii[other]!);
            if (distance < required) {
              magnitude += (OVERLAP_STRENGTH * (required - distance)) / Math.max(1, required);
            }
            const direction =
              distance > MIN_DISTANCE
                ? { x: dx / distance, y: dy / distance }
                : fallbackDirection(ids[index]!, ids[other]!);
            if (!isFixed(index)) {
              fx[index] = fx[index]! + direction.x * magnitude;
              fy[index] = fy[index]! + direction.y * magnitude;
            }
            if (!isFixed(other)) {
              fx[other] = fx[other]! - direction.x * magnitude;
              fy[other] = fy[other]! - direction.y * magnitude;
            }
          }
        }
      }
    }

    // 2. contains 连杆吸引力。
    for (const link of links) {
      if (isFixed(link.a) && isFixed(link.b)) {
        continue;
      }
      const dx = xs[link.b]! - xs[link.a]!;
      const dy = ys[link.b]! - ys[link.a]!;
      const distance = Math.max(MIN_DISTANCE, Math.hypot(dx, dy));
      const delta = Math.max(-LINK_MAX_DELTA, Math.min(LINK_MAX_DELTA, distance - link.restLength));
      const pull = LINK_STRENGTH * delta;
      const direction = {
        x: distance > MIN_DISTANCE ? dx / distance : 0,
        y: distance > MIN_DISTANCE ? dy / distance : 0,
      };
      if (!isFixed(link.a)) {
        fx[link.a] = fx[link.a]! + direction.x * pull;
        fy[link.a] = fy[link.a]! + direction.y * pull;
      }
      if (!isFixed(link.b)) {
        fx[link.b] = fx[link.b]! - direction.x * pull;
        fy[link.b] = fy[link.b]! - direction.y * pull;
      }
    }

    // 3. 同组内聚 + 4. 向心。两者的**合力都设上限**，保证任何时刻都压不过接触处的
    // 软斥力（否则父节点会被自己的子簇拖进盘内，形成稳定重叠——实测 4–18px）。
    for (let index = 0; index < n; index += 1) {
      if (isFixed(index)) {
        continue;
      }
      const group = groupIndex[index]!;
      const groupDx = groupCx[group]! - xs[index]!;
      const groupDy = groupCy[group]! - ys[index]!;
      const groupDistance = Math.hypot(groupDx, groupDy);
      if (groupDistance > 0) {
        const pull = Math.min(GROUP_STRENGTH * groupDistance, GROUP_MAX_FORCE) / groupDistance;
        fx[index] = fx[index]! + groupDx * pull;
        fy[index] = fy[index]! + groupDy * pull;
      }

      const centerDx = bounds.centerX - xs[index]!;
      const centerDy = bounds.centerY - ys[index]!;
      const centerDistance = Math.hypot(centerDx, centerDy);
      if (centerDistance > 0) {
        const isWorkspace = ids[index]!.startsWith('workspace:');
        const pull =
          Math.min(
            (isWorkspace ? WORKSPACE_CENTER_STRENGTH : GLOBAL_CENTER_STRENGTH) * centerDistance,
            isWorkspace ? WORKSPACE_MAX_FORCE : GLOBAL_MAX_FORCE,
          ) / centerDistance;
        fx[index] = fx[index]! + centerDx * pull;
        fy[index] = fy[index]! + centerDy * pull;
      }
    }

    // 收敛判据用**剩余合力**而非位移：位移会被速度阻尼掩盖，合力才代表真的到达平衡。
    let maxForce = 0;
    for (let index = 0; index < n; index += 1) {
      if (isFixed(index)) {
        continue;
      }
      maxForce = Math.max(maxForce, Math.hypot(fx[index]!, fy[index]!));
    }

    // 位移：速度先积分再阻尼，最后按 alpha 衰减与单轮上限输出（视口钳制兜底）。
    for (let index = 0; index < n; index += 1) {
      if (isFixed(index)) {
        vx[index] = 0;
        vy[index] = 0;
        continue;
      }
      vx[index] = (vx[index]! + fx[index]! * alpha) * VELOCITY_DECAY;
      vy[index] = (vy[index]! + fy[index]! * alpha) * VELOCITY_DECAY;
      let stepX = vx[index]!;
      let stepY = vy[index]!;
      const magnitude = Math.hypot(stepX, stepY);
      if (magnitude > options.maxStep) {
        const scale = options.maxStep / magnitude;
        stepX *= scale;
        stepY *= scale;
      }
      xs[index] = xs[index]! + stepX;
      ys[index] = ys[index]! + stepY;
      clampToBounds(state, index, bounds);
    }

    lastMaxForce = maxForce;
    if (maxForce < options.epsilon) {
      break;
    }
  }
  return lastMaxForce;
}
