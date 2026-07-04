/**
 * 遥测 GitHub Issue 同步去重表 — SQLite 持久化。
 *
 * 表结构：telemetry_github_dedup
 * - signature: 堆栈签名的 SHA-256（前 5 帧），主键
 * - issue_number: 已创建的 GitHub Issue 编号（首次创建后回填）
 * - first_seen / last_seen: ISO-8601 时间戳
 * - occurrence_count: 相同签名的累计出现次数
 *
 * 清理策略：30 天未被触发的记录自动清理。
 */

import { sqliteRun, sqliteGet, sqliteAll } from '../infra/db.js';

export interface TelemetryDedupRow {
  signature: string;
  issue_number: number | null;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
}

const DEDUP_STALE_DAYS = 30;

/**
 * 创建 telemetry_github_dedup 表（幂等）。
 * 在网关 migrate() 流程中调用。
 */
export function migrateTelemetryDb(): void {
  sqliteRun(`
    CREATE TABLE IF NOT EXISTS telemetry_github_dedup (
      signature TEXT PRIMARY KEY,
      issue_number INTEGER,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      occurrence_count INTEGER NOT NULL DEFAULT 1
    )
  `);
}

/**
 * 查询去重记录。
 */
export function getDedupEntry(signature: string): TelemetryDedupRow | undefined {
  return sqliteGet<TelemetryDedupRow>(
    `SELECT signature, issue_number, first_seen, last_seen, occurrence_count
     FROM telemetry_github_dedup
     WHERE signature = ?`,
    [signature],
  );
}

/**
 * 插入或更新去重记录。
 * - 首次出现：插入新行，occurrence_count = 1
 * - 重复出现：更新 last_seen + occurrence_count + 1，可选回填 issue_number
 */
export function upsertDedupEntry(signature: string, issueNumber?: number): void {
  const existing = getDedupEntry(signature);
  const now = new Date().toISOString();

  if (existing) {
    sqliteRun(
      `UPDATE telemetry_github_dedup
       SET last_seen = ?,
           occurrence_count = occurrence_count + 1
           ${issueNumber !== undefined ? ', issue_number = ?' : ''}
       WHERE signature = ?`,
      issueNumber !== undefined ? [now, issueNumber, signature] : [now, signature],
    );
  } else {
    sqliteRun(
      `INSERT INTO telemetry_github_dedup (signature, issue_number, first_seen, last_seen, occurrence_count)
       VALUES (?, ?, ?, ?, 1)`,
      [signature, issueNumber ?? null, now, now],
    );
  }
}

/**
 * 清理过期去重记录（超过 DEDUP_STALE_DAYS 天未被触发）。
 * 建议在网关启动时或定期调用。
 */
export function cleanupStaleDedupEntries(olderThanDays: number = DEDUP_STALE_DAYS): number {
  sqliteRun(
    `DELETE FROM telemetry_github_dedup
     WHERE last_seen < datetime('now', ?)`,
    [`-${olderThanDays} days`],
  );

  // 返回清理后剩余记录数（可选，用于日志）
  const row = sqliteGet<{ count: number }>(
    `SELECT COUNT(*) as count FROM telemetry_github_dedup`,
    [],
  );
  return row?.count ?? 0;
}

/**
 * 获取所有去重记录（仅用于测试/调试）。
 */
export function getAllDedupEntries(): TelemetryDedupRow[] {
  return sqliteAll<TelemetryDedupRow>(
    `SELECT signature, issue_number, first_seen, last_seen, occurrence_count
     FROM telemetry_github_dedup
     ORDER BY last_seen DESC`,
    [],
  );
}
