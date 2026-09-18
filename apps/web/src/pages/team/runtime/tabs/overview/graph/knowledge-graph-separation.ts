/**
 * 知识图谱 · 盘间最小中心距分离（纯函数，无 DOM / G6 / React）。
 *
 * 环带规划只按「角度 + 半径」摆放节点，并用**该深度最大半径**估算弧间距；一旦径向预算被挤爆
 * （例如 1200 节点全展开、或子环被父扇区限制），规划会退回到「把节点塞进子环」的兜底路径，
 * 于是同一子环上相邻两盘的中心距可能小于两半径之和——D2 的两块大圆盘相交即由此而来。
 *
 * 这里做最后一道防线：**有界 + 确定性**的分离。规则直白——
 *   1. 任意两盘的期望中心距 = `(drawnA + drawnB) × (1 + SEPARATION_GAP_RATIO)`；
 *   2. 不足时沿两盘连线各让一半（用户固定点不让位，由对方承担全部位移）；
 *   3. 位移后钳制回**同一份视口预算**（椭圆的水平半宽 `maxRadiusX` 与径向 `maxRadius`），
 *      因此分离不会把节点推出画布；
 *   4. 固定轮数内仍未收敛时，按比例**整体收缩盘半径**再重试（最多 `SEPARATION_SHRINK_STEPS` 档，
 *      且保留 `SEPARATION_MIN_RADIUS_SCALE` 地板），因此函数必然在有限步内返回（必然 settle）。
 *
 * 分离只在**确实存在重叠**时移动节点：常规布局（折叠概览、小图、60 节点子环等）逐位不变，
 * 既有坐标断言不受影响。全程无随机源、无 `Date.now()`，同一输入永远得到同一输出。
 */

import { nodeDrawnRadius } from './knowledge-graph-label-text.js';

/** 相邻两盘之间额外保留的可读净空（占两盘绘制半径之和的比例）。 */
export const SEPARATION_GAP_RATIO = 0.12;
/** 单档半径下的最大松弛轮数（有界）。 */
export const SEPARATION_MAX_ITERATIONS = 32;
/** 每轮把差额的一半施加给双方（欠松弛，避免来回振荡）。 */
export const SEPARATION_RELAXATION = 0.5;
/** 判定「已分离」的最大残余重叠（px）。 */
export const SEPARATION_TOLERANCE = 0.25;
/** 盘半径收缩档数上限；配合地板保证有限步收敛。 */
export const SEPARATION_SHRINK_STEPS = 16;
/** 连续多少档收缩都没有改善就停止——收缩已经帮不上忙，继续只是白烧时间。 */
const SEPARATION_STAGNANT_STEPS = 3;
/** 同一档内连续多少轮残余重叠不再下降就停止松弛（已到局部最优）。 */
const SEPARATION_STALLED_ITERATIONS = 3;
/** 每档收缩比例。 */
export const SEPARATION_SHRINK_STEP_RATIO = 0.94;
/** 盘半径收缩地板（相对原始布局半径），再小就不可读。 */
export const SEPARATION_MIN_RADIUS_SCALE = 0.3;
/**
 * 整次分离允许的松弛轮数总预算。逐档收缩在画布物理饱和时仍会缓慢「改善」而迟迟不收敛，
 * 没有预算时单次布局会烧掉数秒；预算给出硬上界，同时不影响常规规模能收敛的情形。
 */
export const SEPARATION_PASS_BUDGET = 320;

/** 参与分离的盘：布局坐标 + 布局半径（折叠聚合的徽标撑大半径在内部推导）。 */
export interface SeparableDisc {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** 布局解算半径；分离可能按档整体收缩它。 */
  readonly radius: number;
  /** 折叠聚合的后代数量；用于把盘内徽标撑大的绘制半径计入中心距。 */
  readonly collapsed?: boolean;
  readonly descendantCount?: number;
  /** 用户拖拽固定点：位置与半径都不因分离而改变。 */
  readonly pinned?: boolean;
}

export interface SeparateDiscsOptions {
  /** 视口中心。 */
  readonly centerX: number;
  readonly centerY: number;
  /** 径向预算（短边推导的最大环半径）。 */
  readonly maxRadius: number;
  /** 水平半宽预算（横向填充后的长边预算）。 */
  readonly maxRadiusX: number;
}

export interface SeparatedDisc {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** 分离后的布局半径（可能已被整体收缩）。 */
  readonly radius: number;
  /** 分离后按同一契约推导的绘制半径（含折叠聚合徽标撑大）。 */
  readonly drawnRadius: number;
}

interface WorkingDisc {
  id: string;
  x: number;
  y: number;
  radius: number;
  drawn: number;
  pinned: boolean;
}

/** 绘制半径：折叠聚合由徽标排版撑大时按撑大值计入中心距。 */
function drawnRadiusOf(disc: SeparableDisc, radius: number): number {
  return nodeDrawnRadius(disc.collapsed === true, disc.descendantCount ?? 0, radius);
}

/** 期望中心距：两盘半径之和 + 可读净空。 */
export function requiredDiscDistance(drawnA: number, drawnB: number): number {
  return (drawnA + drawnB) * (1 + SEPARATION_GAP_RATIO);
}

/** 确定性方向：坐标完全重合时用 id 派生的固定角度分开（FNV-1a，无随机源）。 */
function fallbackDirection(idA: string, idB: string): { x: number; y: number } {
  let hash = 0x811c9dc5;
  const seed = `${idA}|${idB}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const angle = (hash / 0x100000000) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** 把节点钳制回同一份视口预算内，分离不会造成裁切。 */
function clampToBudget(disc: WorkingDisc, options: SeparateDiscsOptions): void {
  let dx = disc.x - options.centerX;
  let dy = disc.y - options.centerY;
  if (Number.isFinite(options.maxRadiusX)) {
    dx = Math.min(options.maxRadiusX, Math.max(-options.maxRadiusX, dx));
  }
  const rho = Math.hypot(dx, dy);
  if (rho > options.maxRadius && rho > 0 && Number.isFinite(options.maxRadius)) {
    const scale = options.maxRadius / rho;
    dx *= scale;
    dy *= scale;
  }
  disc.x = options.centerX + dx;
  disc.y = options.centerY + dy;
}

/**
 * 均匀网格：把「与哪些盘可能相撞」从 O(n²) 降到常数邻域。
 * 键用整数哈希而非字符串，避免 1200 节点 × 数百轮时字符串拼接成为热点。
 */
function cellKey(cellX: number, cellY: number): number {
  return (cellX * 73856093) ^ (cellY * 19349663);
}

function buildGrid(discs: readonly WorkingDisc[], cellSize: number): Map<number, number[]> {
  const grid = new Map<number, number[]>();
  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index];
    if (!disc) {
      continue;
    }
    const key = cellKey(Math.floor(disc.x / cellSize), Math.floor(disc.y / cellSize));
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      grid.set(key, [index]);
    }
  }
  return grid;
}

/**
 * 单档半径下的一轮松弛。**原地（Gauss-Seidel）**更新，且按**绕圆心的角度顺序**遍历：
 * 同一子环上的相邻盘因此被连续处理，间距不足会像波一样沿环传播，几十轮内即可铺开；
 * 若改成「先累加再统一施加」的 Jacobi，位移每轮只能传播一格，60 个挤在一起的盘需要上千轮。
 * 遍历顺序只由坐标与 id 决定（无随机源），因此同一输入永远得到同一结果。
 *
 * 返回值是本轮中**触发过位移**的最大重叠量：一轮里没有任何一对超过容差时不会有任何节点移动，
 * 返回的坐标因此可被调用方当作「已复核无重叠」的状态；反之说明需要继续松弛或收缩半径。
 */
function relaxPass(discs: WorkingDisc[], options: SeparateDiscsOptions): number {
  const maxDrawn = discs.reduce((max, disc) => Math.max(max, disc.drawn), 1);
  const cellSize = Math.max(1, 2 * maxDrawn * (1 + SEPARATION_GAP_RATIO));
  const grid = buildGrid(discs, cellSize);
  const offsets = [-1, 0, 1];
  const order = angularOrder(discs, options);
  let maxDeficit = 0;

  for (const index of order) {
    const a = discs[index];
    if (!a) {
      continue;
    }
    const cellX = Math.floor(a.x / cellSize);
    const cellY = Math.floor(a.y / cellSize);
    for (const offsetX of offsets) {
      for (const offsetY of offsets) {
        const bucket = grid.get(cellKey(cellX + offsetX, cellY + offsetY));
        if (!bucket) {
          continue;
        }
        for (const other of bucket) {
          if (other <= index) {
            continue;
          }
          const b = discs[other];
          if (!b) {
            continue;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const required = requiredDiscDistance(a.drawn, b.drawn);
          // 先做一次轴对齐包围盒剔除，避免在密集图里对每一对都调用 hypot（热点，约 5× 提速）。
          if (
            Math.abs(dx) > required - SEPARATION_TOLERANCE ||
            Math.abs(dy) > required - SEPARATION_TOLERANCE
          ) {
            continue;
          }
          const distance = Math.hypot(dx, dy);
          const deficit = required - distance;
          if (deficit <= SEPARATION_TOLERANCE) {
            continue;
          }
          maxDeficit = Math.max(maxDeficit, deficit);
          const direction =
            distance > 1e-6
              ? { x: dx / distance, y: dy / distance }
              : fallbackDirection(a.id, b.id);
          const reach = deficit * SEPARATION_RELAXATION;
          const shareA = a.pinned ? 0 : b.pinned ? 1 : 0.5;
          if (!a.pinned && shareA > 0) {
            a.x -= direction.x * reach * shareA;
            a.y -= direction.y * reach * shareA;
            clampToBudget(a, options);
          }
          if (!b.pinned && shareA < 1) {
            b.x += direction.x * reach * (1 - shareA);
            b.y += direction.y * reach * (1 - shareA);
            clampToBudget(b, options);
          }
        }
      }
    }
  }

  return maxDeficit;
}

/** 绕圆心的角度顺序（固定点也在其中，只是不会被移动）；角度相同则按输入序号稳定排序。 */
function angularOrder(discs: readonly WorkingDisc[], options: SeparateDiscsOptions): number[] {
  const angles = discs.map((disc) =>
    Math.atan2(disc.y - options.centerY, disc.x - options.centerX),
  );
  const order = discs.map((_, index) => index);
  order.sort((left, right) => (angles[left] ?? 0) - (angles[right] ?? 0) || left - right);
  return order;
}

/**
 * 同一档半径内反复松弛，直到无重叠、轮数用尽，或**残余重叠不再下降**（说明这一档已经收敛到
 * 局部最优、继续只是白烧时间）为止。返回最终最大残余重叠。
 */
function settleRadius(
  discs: WorkingDisc[],
  options: SeparateDiscsOptions,
  budget: { remaining: number },
): number {
  let deficit = Number.POSITIVE_INFINITY;
  let stalled = 0;
  for (let iteration = 0; iteration < SEPARATION_MAX_ITERATIONS; iteration += 1) {
    if (budget.remaining <= 0) {
      return deficit;
    }
    budget.remaining -= 1;
    const previous = deficit;
    deficit = relaxPass(discs, options);
    if (deficit <= SEPARATION_TOLERANCE) {
      return deficit;
    }
    if (deficit >= previous) {
      stalled += 1;
      if (stalled >= SEPARATION_STALLED_ITERATIONS) {
        return deficit;
      }
    } else {
      stalled = 0;
    }
  }
  return deficit;
}

/**
 * 盘间分离主入口。返回与输入**同序**的结果；常规布局（无重叠）逐位不变。
 */
export function separateDiscs(
  discs: readonly SeparableDisc[],
  options: SeparateDiscsOptions,
): readonly SeparatedDisc[] {
  let best = discs.map((disc) => ({
    id: disc.id,
    x: disc.x,
    y: disc.y,
    radius: disc.radius,
    drawnRadius: drawnRadiusOf(disc, disc.radius),
  }));
  let bestDeficit = Number.POSITIVE_INFINITY;
  let stagnantSteps = 0;
  const budget = { remaining: SEPARATION_PASS_BUDGET };
  let scale = 1;
  for (let step = 0; step <= SEPARATION_SHRINK_STEPS; step += 1) {
    const working: WorkingDisc[] = discs.map((disc) => {
      const radius = disc.radius * scale;
      return {
        id: disc.id,
        x: disc.x,
        y: disc.y,
        radius,
        drawn: drawnRadiusOf(disc, radius),
        pinned: disc.pinned === true,
      };
    });
    const deficit = settleRadius(working, options, budget);
    if (deficit < bestDeficit) {
      bestDeficit = deficit;
      best = working.map((disc) => ({
        id: disc.id,
        x: disc.x,
        y: disc.y,
        radius: disc.radius,
        drawnRadius: disc.drawn,
      }));
      stagnantSteps = 0;
    } else {
      stagnantSteps += 1;
    }
    if (deficit <= SEPARATION_TOLERANCE || scale <= SEPARATION_MIN_RADIUS_SCALE) {
      return best;
    }
    if (stagnantSteps >= SEPARATION_STAGNANT_STEPS || budget.remaining <= 0) {
      return best;
    }
    scale = Math.max(SEPARATION_MIN_RADIUS_SCALE, scale * SEPARATION_SHRINK_STEP_RATIO);
  }
  return best;
}
