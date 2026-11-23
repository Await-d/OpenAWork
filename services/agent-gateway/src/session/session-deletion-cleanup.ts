import { AgentTaskStoreImpl } from '@openAwork/agent-core';
import { z } from 'zod';
import { getGatewayArtifactManager } from '../infra/artifact-manager.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { removeSessionSpillDirectory } from '../tools/tool-output-spill.js';
import { removeUnreferencedBackupFile } from './session-file-backup-store.js';

const cleanupPayloadSchema = z.object({
  sessions: z.array(z.object({ id: z.string(), taskGraphProjectRoot: z.string().nullable() })),
  backupPaths: z.array(z.string()),
});

type CleanupPayload = z.infer<typeof cleanupPayloadSchema>;
type CleanupRow = { id: number; payload_json: string; attempts: number; next_attempt_at: number };

const taskStore = new AgentTaskStoreImpl();

/** 必须与会话的数据库删除在同一事务内执行。 */
export function enqueueSessionDeletionCleanup(payload: CleanupPayload): void {
  sqliteRun('INSERT INTO session_deletion_cleanup (payload_json) VALUES (?)', [
    JSON.stringify(payload),
  ]);
}

async function removeSessionDeletionFiles(payload: CleanupPayload): Promise<void> {
  const removedSessions = payload.sessions.filter(
    ({ id }) => !sqliteGet('SELECT id FROM sessions WHERE id = ?', [id]),
  );
  const errors: unknown[] = [];
  async function attempt(cleanup: () => Promise<void>): Promise<void> {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  await attempt(() =>
    getGatewayArtifactManager().removeForDeletedSessions(
      new Set(removedSessions.map(({ id }) => id)),
    ),
  );
  for (const { id, taskGraphProjectRoot } of removedSessions) {
    await attempt(() => removeSessionSpillDirectory(id));
    if (taskGraphProjectRoot !== null) {
      await attempt(() => taskStore.deleteGraph(taskGraphProjectRoot, id));
    }
  }
  for (const path of payload.backupPaths) {
    await attempt(() => removeUnreferencedBackupFile(path));
  }
  if (errors.length > 0) throw new AggregateError(errors, '会话磁盘产物清理失败');
}

/** 单消费者，每轮处理一棵树，可从数据库恢复未完成的清理。 */
export function createSessionDeletionCleanupWorker() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let closed = false;

  function schedule(delayMs = 0): void {
    if (closed || running) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      running = runNext();
    }, delayMs);
    timer.unref();
  }

  async function runNext(): Promise<void> {
    // 首次查询也放到异步边界后，确保 running 已登记。
    await Promise.resolve();
    let delay: number | undefined;
    try {
      const row = sqliteGet<CleanupRow>(
        `SELECT id, payload_json, attempts, next_attempt_at FROM session_deletion_cleanup
         ORDER BY next_attempt_at, id LIMIT 1`,
      );
      if (!row) return;
      delay = Math.max(0, row.next_attempt_at - Date.now());
      if (delay > 0) return;
      try {
        await removeSessionDeletionFiles(cleanupPayloadSchema.parse(JSON.parse(row.payload_json)));
        sqliteRun('DELETE FROM session_deletion_cleanup WHERE id = ?', [row.id]);
      } catch (error) {
        logGatewayWarn('会话磁盘清理失败，稍后重试', { jobId: row.id, error });
        sqliteRun(
          'UPDATE session_deletion_cleanup SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?',
          [Date.now() + Math.min(300_000, 1_000 * 2 ** Math.min(row.attempts, 9)), row.id],
        );
      }
    } catch (error) {
      logGatewayWarn('读取或更新会话清理队列失败，稍后重试', error);
      delay = 5_000;
    } finally {
      running = undefined;
      if (delay !== undefined) schedule(delay);
    }
  }

  return {
    schedule,
    async close(): Promise<void> {
      closed = true;
      clearTimeout(timer);
      await running;
    },
  };
}
