/**
 * Robustness: `permission_decision_logs` is a WRITE-ONLY table — every
 * approve/reject/permanent decision appends a row, nothing in production reads
 * it, and the only removal is the session-delete CASCADE. So on a long-lived
 * install it grew without bound. The store now bounds it with amortized
 * most-recent-N retention (the §0.40 audit_logs family).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../session/permission-decision-log-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof StoreModule;

const USER_ID = 'u-perm-log';
const SESSION_ID = 'sess-perm-log';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  store = await import('../../session/permission-decision-log-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_decision_logs', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'perm log session', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  store.__setPermissionDecisionLogRetentionForTesting(null);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countRows(): number {
  const row = dbModule.sqliteGet<{ n: number }>(
    'SELECT COUNT(*) AS n FROM permission_decision_logs',
    [],
  );
  return row?.n ?? 0;
}

function append(i: number): void {
  store.appendPermissionDecisionLog({
    requestId: `req-${i}`,
    sessionId: SESSION_ID,
    toolName: 'edit',
    scope: '*',
    decision: 'approved',
  });
}

describe('permission_decision_logs retention', () => {
  it('累计插入超过上限后裁剪到最近 N 条', () => {
    // cap=10, prune every 5 inserts.
    store.__setPermissionDecisionLogRetentionForTesting(10, 5);

    for (let i = 0; i < 40; i += 1) {
      append(i);
    }

    // Bounded near the cap; amortized prune overshoots by at most one interval.
    const count = countRows();
    expect(count).toBeLessThanOrEqual(15);
    expect(count).toBeGreaterThanOrEqual(10);

    // The retained rows are the most recent ones (highest request ids).
    const oldest = dbModule.sqliteGet<{ request_id: string }>(
      'SELECT request_id FROM permission_decision_logs ORDER BY id ASC LIMIT 1',
      [],
    );
    // Earliest surviving row must be well past req-0 (old rows were pruned).
    expect(oldest?.request_id).not.toBe('req-0');
  });

  it('retention<=0 时禁用裁剪（保留全部）', () => {
    store.__setPermissionDecisionLogRetentionForTesting(0, 5);

    for (let i = 0; i < 25; i += 1) {
      append(i);
    }

    expect(countRows()).toBe(25);
  });
});
