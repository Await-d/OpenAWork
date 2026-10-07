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
import type { SqliteBindableValue } from './sqlite-bind-params.js';

export interface RetentionScope {
  /**
   * 过滤列名。只允许调用方传入字面量——不得拼接外部输入。
   */
  column: string;
  value: string;
}

export function deleteRowsBeyondMostRecent(input: {
  table: string;
  idColumn: 'id' | 'rowid';
  limit: number;
  /**
   * 可选的等值过滤（如按 `user_id` 分区裁剪）。过滤条件同时作用于边界子查询与
   * 外层删除，避免「边界取自 A 用户、删除落到 B 用户」的跨分区误删。
   */
  scope?: RetentionScope;
}): void {
  if (!Number.isFinite(input.limit) || input.limit <= 0) {
    return;
  }

  const scope = input.scope;
  const scopeWhere = scope ? `AND ${scope.column} = ?` : '';
  const scopeParams: SqliteBindableValue[] = scope ? [scope.value] : [];

  sqliteRun(
    `DELETE FROM ${input.table}
      WHERE ${input.idColumn} < (
        SELECT MIN(${input.idColumn}) FROM (
          SELECT ${input.idColumn} FROM ${input.table}
           WHERE 1 = 1 ${scopeWhere}
           ORDER BY ${input.idColumn} DESC
           LIMIT ?
        )
      )${scopeWhere}`,
    [...scopeParams, Math.floor(input.limit), ...scopeParams],
  );
}
