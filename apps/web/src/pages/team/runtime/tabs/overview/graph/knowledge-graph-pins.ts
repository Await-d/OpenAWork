/**
 * 知识图谱 · 用户拖拽固定点（pin）存储。
 *
 * 节点被拖拽后，其位置由用户接管：径向布局重算时必须保留这些位置，
 * 直到「复位」显式清空。这里只做不可变的增删，不触碰 G6 实例或 React。
 */

/** 单个固定点：图坐标系（未经视口变换）中的位置。 */
export interface GraphPin {
  readonly x: number;
  readonly y: number;
}

/** 节点 id → 固定点。 */
export type GraphPinMap = ReadonlyMap<string, GraphPin>;

export interface GraphPinUpdate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export const EMPTY_GRAPH_PINS: GraphPinMap = new Map();

/**
 * 记录一批拖拽结果，返回新的固定点表（不改动入参）。
 * 坐标为 `NaN` / `Infinity` 的更新会被忽略，避免污染布局。
 */
export function recordGraphPins(
  current: GraphPinMap,
  updates: readonly GraphPinUpdate[],
): GraphPinMap {
  if (updates.length === 0) {
    return current;
  }
  let next: Map<string, GraphPin> | null = null;
  for (const update of updates) {
    if (!Number.isFinite(update.x) || !Number.isFinite(update.y)) {
      continue;
    }
    next ??= new Map(current);
    next.set(update.id, { x: update.x, y: update.y });
  }
  return next ?? current;
}

/** 清空所有固定点（「复位」使用）。 */
export function clearGraphPins(): GraphPinMap {
  return new Map();
}
