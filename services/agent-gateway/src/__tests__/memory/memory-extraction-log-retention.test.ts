/**
 * Robustness: `memory_extraction_logs` is a dedup/idempotency log — one row is
 * appended per extraction turn, read ONLY by the point-query `hasExtractionLog`,
 * and removed only by the session-delete CASCADE. A `clientRequestId` is a
 * one-time id for a single streaming run, so an old row can never be re-queried.
 * Without retention the table grows without bound on a long-lived account. The
 * store now prunes rows older than a window on an amortized schedule.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../memory/memory-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof StoreModule;

const USER_ID = 'u-extract-log';
const SESSION_ID = 's-extract-log';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  store = await import('../../memory/memory-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_extraction_logs', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  store.__setMemoryExtractionLogRetentionForTesting(null);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countRows(): number {
  const row = dbModule.sqliteGet<{ n: number }>(
    'SELECT COUNT(*) AS n FROM memory_extraction_logs',
    [],
  );
  return row?.n ?? 0;
}

/** Insert an extraction-log row with an explicit (possibly backdated) created_at. */
function insertAged(clientRequestId: string, ageHours: number): void {
  dbModule.sqliteRun(
    `INSERT INTO memory_extraction_logs
       (user_id, session_id, client_request_id, extracted_count, created_at)
     VALUES (?, ?, ?, 0, datetime('now', ?))`,
    [USER_ID, SESSION_ID, clientRequestId, `-${ageHours} hours`],
  );
}

describe('memory_extraction_logs retention', () => {
  it('插入达到间隔时清除超过保留窗口的旧行，保留窗口内的行', () => {
    // Window 48h, prune every 3 inserts.
    store.__setMemoryExtractionLogRetentionForTesting(48, 3);

    insertAged('old-1', 100);
    insertAged('old-2', 200);
    insertAged('recent-1', 1);
    expect(countRows()).toBe(3);

    // Three real inserts trip the prune interval.
    for (let i = 0; i < 3; i += 1) {
      store.insertExtractionLog(USER_ID, SESSION_ID, `new-${i}`, 0);
    }

    // old-1 / old-2 pruned; recent-1 + 3 new (created now) survive = 4.
    expect(
      dbModule.sqliteGet('SELECT id FROM memory_extraction_logs WHERE client_request_id = ?', [
        'old-1',
      ]),
    ).toBeUndefined();
    expect(
      dbModule.sqliteGet('SELECT id FROM memory_extraction_logs WHERE client_request_id = ?', [
        'recent-1',
      ]),
    ).not.toBeUndefined();
    expect(countRows()).toBe(4);
  });

  it('retention<=0 时禁用裁剪（保留全部）', () => {
    store.__setMemoryExtractionLogRetentionForTesting(0, 3);

    insertAged('old-a', 1000);
    insertAged('old-b', 2000);

    for (let i = 0; i < 5; i += 1) {
      store.insertExtractionLog(USER_ID, SESSION_ID, `m-${i}`, 0);
    }

    expect(countRows()).toBe(7);
  });

  it('hasExtractionLog 对窗口内的现有行仍返回 true（dedup 语义不破坏）', () => {
    store.__setMemoryExtractionLogRetentionForTesting(48, 100);
    store.insertExtractionLog(USER_ID, SESSION_ID, 'req-keep', 0);
    expect(store.hasExtractionLog(USER_ID, SESSION_ID, 'req-keep')).toBe(true);
    expect(store.hasExtractionLog(USER_ID, SESSION_ID, 'req-missing')).toBe(false);
  });
});
