import { clearSubstateTrackingForSession } from '../handoff/store/substate-store.js';
import { sqliteRun, sqliteTransaction } from '../infra/db.js';
import { invalidateSessionOwnerCache } from '../infra/session-owner-cache.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import { clearExternalAccessTracking } from '../workspace/external-directory-guard.js';
import { resetDoomLoopHistory } from './doom-loop-detector.js';
import { forgetScopeRecency } from './scope-recency-index.js';
import {
  deleteSessionsWithMalformedRecovery,
  purgeOrphanedChannelChatScopeRows,
} from './session-delete-recovery.js';
import { enqueueSessionDeletionCleanup } from './session-deletion-cleanup.js';
import { collectSessionBackupStoragePaths } from './session-file-backup-store.js';
import { deleteSessionMessageSearchDocumentsForSession } from './session-search-store.js';

export function deleteSessionTree(input: {
  sessions: Array<{ id: string; taskGraphProjectRoot: string | null }>;
  userId: string;
}): void {
  const { sessions, userId } = input;
  const backupPaths = new Set<string>();
  for (const { id } of sessions) {
    for (const path of collectSessionBackupStoragePaths({ sessionId: id, userId })) {
      backupPaths.add(path);
    }
  }
  const enqueue = () => enqueueSessionDeletionCleanup({ sessions, backupPaths: [...backupPaths] });

  try {
    sqliteTransaction(() => {
      for (const { id } of sessions) {
        // 事件与搜索索引没有会话外键。渠道作用域依赖来源行，必须在级联删除前处理。
        sqliteRun('DELETE FROM event_log WHERE aggregate_id = ?', [id]);
        sqliteRun('DELETE FROM event_sequences WHERE aggregate_id = ?', [id]);
        purgeOrphanedChannelChatScopeRows({ sessionId: id, userId });
        sqliteRun('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, userId]);
        deleteSessionMessageSearchDocumentsForSession(id);
      }
      enqueue();
    });
  } catch (error) {
    if (!isSqliteMalformedError(error)) throw error;
    deleteSessionsWithMalformedRecovery(
      sessions.map(({ id }) => ({ sessionId: id, userId })),
      enqueue,
    );
  }

  for (const { id } of sessions) {
    invalidateSessionOwnerCache(id);
    forgetScopeRecency(id);
    clearSubstateTrackingForSession(id);
    clearExternalAccessTracking(id);
    resetDoomLoopHistory(id);
  }
}
