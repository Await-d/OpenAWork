/**
 * 全局「保留最近 N 行」的 O(N) 删除原语。
 *
 * 旧写法 `DELETE FROM t WHERE id NOT IN (SELECT id FROM t ORDER BY id DESC LIMIT N)`
 * 的 `NOT IN` 子句会把整张表物化进临时 B-tree（全表扫描）：在数百 MB 的表上
 * 每次 prune 都会在写路径上同步阻塞事件循环数百 ms（prune 每 N 次写入触发一次，
 * 大表上等于周期性卡死整个网关/UI）。
 *
 * 本实现先取「最近 N 行」的最小 id 作为边界，再范围删除更小的行：子查询只读
 * N 个主键，删除走主键 B-tree 范围扫描，成本 O(N + 删除行数)，不再全表物化。
 *
 * 语义与旧写法完全一致（含 N ≤ 0 时禁用、表中不足 N 行时不删任何行）。
 */
import { sqliteRun } from './db.js';

export function deleteRowsBeyondMostRecent(input: {
  /**
   * 物理表名。只允许调用方传入字面量——不得拼接外部输入。
   */
  table: string;
  /**
   * 单调递增且唯一的排序列：`INTEGER PRIMARY KEY` 表用 `'id'`，
   * UUID 主键 / 无 INTEGER PK 的表用 `'rowid'`。
   */
  idColumn: 'id' | 'rowid';
  /** 保留的最近行数；非正数视为禁用（不做任何删除）。 */
  limit: number;
}): void {
  if (!Number.isFinite(input.limit) || input.limit <= 0) {
    return;
  }

  sqliteRun(
    `DELETE FROM ${input.table}
      WHERE ${input.idColumn} < (
        SELECT MIN(${input.idColumn}) FROM (
          SELECT ${input.idColumn} FROM ${input.table}
           ORDER BY ${input.idColumn} DESC
           LIMIT ?
        )
      )`,
    [Math.floor(input.limit)],
  );
}
