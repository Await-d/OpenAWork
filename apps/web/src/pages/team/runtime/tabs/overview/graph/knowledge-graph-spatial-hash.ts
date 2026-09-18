/**
 * 知识图谱 · 均匀空间哈希（纯函数，无 DOM / G6 / React）。
 *
 * 力导向布局的斥力若走 all-pairs，在数百可见节点就是 O(n²) 的热点。这里把坐标离散进
 * 均匀网格，邻居查询只扫 3×3 单元，因此复杂度约 O(n·邻域)。整数单元键用哈希而非字符串，
 * 避免每轮拼接字符串成为新热点；键冲突只会让桶变大（多算几对，距离判定兜底），不会漏对。
 */

/** 空间哈希：cellSize 与 cellKey→节点下标桶。 */
export interface SpatialHash {
  readonly cellSize: number;
  readonly buckets: ReadonlyMap<number, readonly number[]>;
}

/** 整数哈希单元键。 */
export function cellKey(cellX: number, cellY: number): number {
  return (cellX * 73856093) ^ (cellY * 19349663);
}

/** 构建均匀空间哈希；`cellSize` 必须 ≥ 需要命中的最大半径，3×3 邻域才完整。 */
export function buildSpatialHash(
  points: readonly { readonly x: number; readonly y: number }[],
  cellSize: number,
): SpatialHash {
  const safeCell = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;
  const buckets = new Map<number, number[]>();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }
    const key = cellKey(Math.floor(point.x / safeCell), Math.floor(point.y / safeCell));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      buckets.set(key, [index]);
    }
  }
  return { cellSize: safeCell, buckets };
}

/**
 * 返回索引 `index` 的节点在 `radius` 内（不含自身）的全部邻居下标。
 * 只扫 3×3 邻域单元，因此复杂度约 O(邻域)，与全图规模无关。
 */
export function queryNeighbours(
  hash: SpatialHash,
  points: readonly { readonly x: number; readonly y: number }[],
  index: number,
  radius: number,
): number[] {
  const origin = points[index];
  if (!origin) {
    return [];
  }
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const cellX = Math.floor(origin.x / hash.cellSize);
  const cellY = Math.floor(origin.y / hash.cellSize);
  const found: number[] = [];
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const bucket = hash.buckets.get(cellKey(cellX + offsetX, cellY + offsetY));
      if (!bucket) {
        continue;
      }
      for (const other of bucket) {
        if (other === index) {
          continue;
        }
        const candidate = points[other];
        if (!candidate) {
          continue;
        }
        if (Math.hypot(candidate.x - origin.x, candidate.y - origin.y) <= safeRadius) {
          found.push(other);
        }
      }
    }
  }
  return found;
}
