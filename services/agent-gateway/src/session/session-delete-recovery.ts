/**
 * Recovery path for malformed sessions: with `PRAGMA foreign_keys=OFF`
 * we manually purge every table that references the session, then
 * delete the `sessions` row itself. The statement list lives in
 * `./session-delete-recovery-statements.ts` so it can be unit-tested
 * in isolation (no SQLite driver dependency).
 */

import { db, sqliteRun } from '../infra/db.js';
import { SESSION_DELETE_RECOVERY_STATEMENTS } from './session-delete-recovery-statements.js';

export {
  SESSION_DELETE_RECOVERY_STATEMENTS,
  type SessionDeleteRecoveryStatement,
} from './session-delete-recovery-statements.js';

export function deleteSessionWithMalformedRecovery(input: {
  sessionId: string;
  userId: string;
}): void {
  let transactionStarted = false;

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN');
    transactionStarted = true;

    for (const statement of SESSION_DELETE_RECOVERY_STATEMENTS) {
      sqliteRun(statement.sql, statement.params(input));
    }

    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      db.exec('ROLLBACK');
    }

    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
