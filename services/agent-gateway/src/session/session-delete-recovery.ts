/**
 * Recovery path for malformed sessions: with `PRAGMA foreign_keys=OFF`
 * we manually purge every table that references the session, then
 * delete the `sessions` row itself. The statement list lives in
 * `./session-delete-recovery-statements.ts` so it can be unit-tested
 * in isolation (no SQLite driver dependency).
 */

import { db, sqliteRun } from '../infra/db.js';
import { invalidateSessionOwnerCache } from '../infra/session-owner-cache.js';
import {
  buildDeleteOrphanedChannelChatMemoriesSql,
  buildDeleteOrphanedChannelChatRulesSql,
} from '../memory/channel-chat-scope-cleanup.js';
import { SESSION_DELETE_RECOVERY_STATEMENTS } from './session-delete-recovery-statements.js';
import { forgetScopeRecency } from './scope-recency-index.js';

export {
  SESSION_DELETE_RECOVERY_STATEMENTS,
  type SessionDeleteRecoveryStatement,
} from './session-delete-recovery-statements.js';

/**
 * 清理某个会话派生、且已无其它会话引用的 `channel_chat` 作用域记忆与规则。
 *
 * 正常删除路径（`routes/sessions.ts` 的 `deleteSessionTree`）在删除 `sessions` 行**之前**
 * 于同一事务内调用本函数：`memories` / `memory_rule_entries` 没有指向 `sessions` 的外键，
 * FK 级联不会带走它们，而注入侧按 scope id 字符串匹配、不校验会话是否仍存在，故不显式
 * 清理会留下「删了会话仍被命中」的孤儿。清除依据见 `channel-chat-scope-cleanup.ts`。
 *
 * 幂等：本会话来源行被删除后，`IN` 子查询为空集 → 再次执行不误删、不报错。
 * 只碰 `channel_chat` 作用域，user / workspace / team 一律不动。
 */
export function purgeOrphanedChannelChatScopeRows(input: {
  sessionId: string;
  userId: string;
}): void {
  sqliteRun(buildDeleteOrphanedChannelChatMemoriesSql(), [
    input.userId,
    input.sessionId,
    input.sessionId,
  ]);
  sqliteRun(buildDeleteOrphanedChannelChatRulesSql(), [
    input.userId,
    input.sessionId,
    input.sessionId,
  ]);
}

export function deleteSessionWithMalformedRecovery(input: {
  sessionId: string;
  userId: string;
}): void {
  deleteSessionsWithMalformedRecovery([input]);
}

export function deleteSessionsWithMalformedRecovery(
  sessions: readonly { sessionId: string; userId: string }[],
  beforeDelete?: () => void,
): void {
  let transactionStarted = false;

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN');
    transactionStarted = true;

    beforeDelete?.();
    for (const session of sessions) {
      for (const statement of SESSION_DELETE_RECOVERY_STATEMENTS) {
        sqliteRun(statement.sql, statement.params(session));
      }
    }

    db.exec('COMMIT');
    transactionStarted = false;
    // The session row is gone — its cached owner would feed FK-checked
    // inserts for the next 30s otherwise.
    for (const { sessionId } of sessions) {
      invalidateSessionOwnerCache(sessionId);
      forgetScopeRecency(sessionId);
    }
  } catch (error) {
    if (transactionStarted) {
      db.exec('ROLLBACK');
    }

    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
