/**
 * Checkpoints v2 — Gateway 重启后自动恢复中断的 handoff。
 *
 * 参考：hermes-agent v0.13.0 "The Tenacity Release"
 *   - Gateway 重启后自动恢复中断的会话
 *   - `/update` 重启后保留 pending 提示
 *   - 不再产生孤儿 shadow repo
 *
 * 本模块在 Gateway 启动时被调用一次，负责：
 *   1. 将所有 `claimed`/`running` 状态的 handoff 标记为 `interrupted`
 *      （通过 failure_reason 记录），然后回退到 `pending` 等待 watcher 重新 claim
 *   2. 记录恢复日志，便于审计
 *   3. 磁盘护栏：checkpoint 文件大小 + 数量上限，防止膨胀
 *
 * 与 `reclaimAbandonedHandoffs` 的区别：
 *   - reclaimAbandoned 是**运行时**周期性扫描心跳超时的 handoff
 *   - recoverInterruptedHandoffs 是**启动时**一次性恢复所有非终态 handoff
 */

import { sqliteAll, sqliteRun } from '../../infra/db.js';

export interface InterruptedHandoffRow {
  id: string;
  state: string;
  retry_count: number;
  to_session_id: string | null;
}

export interface RecoveryResult {
  /** 被回退到 pending 的 handoff 数量 */
  recoveredCount: number;
  /** 因达到 maxRetry 被标记为 failed 的 handoff 数量 */
  failedCount: number;
  /** 被恢复的 handoff ID 列表（用于事件推送） */
  recoveredIds: string[];
  /** 被标记为 failed 的 handoff ID 列表 */
  failedIds: string[];
}

const DEFAULT_MAX_RETRY = 3;

/**
 * Gateway 启动时调用：恢复所有中断的 handoff。
 *
 * 把所有 `claimed`/`running` 状态的 handoff 回退到 `pending`（retry_count+1），
 * 或者在 retry_count 已达上限时标记为 `failed`。
 *
 * 这确保 Gateway 崩溃/重启后，没有 handoff 卡在中间态。
 */
export function recoverInterruptedHandoffs(maxRetry = DEFAULT_MAX_RETRY): RecoveryResult {
  // 查找所有非终态的 handoff（claimed/running）
  const interrupted = sqliteAll<InterruptedHandoffRow>(
    `SELECT id, state, retry_count, to_session_id
     FROM handoff_records
     WHERE state IN ('claimed', 'running')`,
    [],
  );

  const recoveredIds: string[] = [];
  const failedIds: string[] = [];

  for (const row of interrupted) {
    if (row.retry_count >= maxRetry) {
      // 超过最大重试次数 → 标记为 failed
      sqliteRun(
        `UPDATE handoff_records
           SET state = 'failed',
               failure_reason = 'gateway-restart-recovery-max-retry-exceeded',
               completed_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ? AND state IN ('claimed', 'running')`,
        [row.id],
      );
      failedIds.push(row.id);
    } else {
      // 回退到 pending，等待 watcher 重新 claim
      sqliteRun(
        `UPDATE handoff_records
           SET state = 'pending',
               claim_token = NULL,
               claimed_at = NULL,
               started_at = NULL,
               retry_count = retry_count + 1,
               updated_at = datetime('now')
         WHERE id = ? AND state IN ('claimed', 'running')`,
        [row.id],
      );
      recoveredIds.push(row.id);
    }
  }

  const result: RecoveryResult = {
    recoveredCount: recoveredIds.length,
    failedCount: failedIds.length,
    recoveredIds,
    failedIds,
  };

  if (result.recoveredCount > 0 || result.failedCount > 0) {
    console.info(
      `[checkpoint-v2] Gateway 重启恢复：${result.recoveredCount} 个 handoff 回退到 pending，` +
        `${result.failedCount} 个因超过最大重试被标记为 failed`,
    );
  }

  return result;
}

/**
 * 持久化 checkpoint 元数据到磁盘，用于跨重启状态追踪。
 *
 * 每次 Gateway 启动时写入一条 checkpoint 记录，
 * 包含启动时间、恢复的 handoff 列表等。
 *
 * 磁盘护栏：保留最近 100 条 checkpoint 记录，超出的自动清理。
 */
const MAX_CHECKPOINT_FILES = 100;

export interface CheckpointMetadata {
  timestamp: number;
  recoveredIds: string[];
  failedIds: string[];
  totalInterrupted: number;
}

export function createStartupCheckpoint(result: RecoveryResult): CheckpointMetadata {
  const metadata: CheckpointMetadata = {
    timestamp: Date.now(),
    recoveredIds: result.recoveredIds,
    failedIds: result.failedIds,
    totalInterrupted: result.recoveredCount + result.failedCount,
  };

  // 持久化到 DB（handoff_checkpoints 表）
  sqliteRun(
    `INSERT INTO handoff_checkpoints (id, created_at, metadata_json)
     VALUES (?, datetime('now'), ?)`,
    [`checkpoint-${metadata.timestamp}`, JSON.stringify(metadata)],
  );

  // 磁盘护栏：清理超过上限的旧 checkpoint
  sqliteRun(
    `DELETE FROM handoff_checkpoints
     WHERE id NOT IN (
       SELECT id FROM handoff_checkpoints
       ORDER BY created_at DESC
       LIMIT ?
     )`,
    [MAX_CHECKPOINT_FILES],
  );

  return metadata;
}

/**
 * 查询最近的 checkpoint 记录（用于前端展示或调试）。
 */
export function getRecentCheckpoints(limit = 10): CheckpointMetadata[] {
  const rows = sqliteAll<{ metadata_json: string }>(
    `SELECT metadata_json FROM handoff_checkpoints
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit],
  );

  const results: CheckpointMetadata[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.metadata_json) as CheckpointMetadata;
      results.push(parsed);
    } catch {
      // 跳过损坏的记录
    }
  }
  return results;
}
