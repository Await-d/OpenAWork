/**
 * Robustness: `team_messages` is appended per `POST /team/messages` with no
 * throttle and read with `LIMIT 100`, but had no production DELETE (only the
 * user-delete CASCADE). So rows beyond the newest window were never shown yet
 * never removed — unbounded growth per user. The store now bounds it with
 * amortized per-user most-recent-N retention (the notifications §0.40 family).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../team/team-message-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof StoreModule;

const USER_ID = 'u-team-msg';
const OTHER_USER_ID = 'u-team-msg-other';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  store = await import('../../team/team-message-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM team_messages', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  for (const id of [USER_ID, OTHER_USER_ID]) {
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
      [id, `${id}@example.com`],
    );
  }
});

afterEach(() => {
  store.__setTeamMessageRetentionForTesting(null);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countRows(userId: string): number {
  const row = dbModule.sqliteGet<{ n: number }>(
    'SELECT COUNT(*) AS n FROM team_messages WHERE user_id = ?',
    [userId],
  );
  return row?.n ?? 0;
}

function append(userId: string, i: number): void {
  store.appendTeamMessage({
    id: `${userId}-msg-${i}`,
    userId,
    senderId: null,
    content: `m${i}`,
    type: 'update',
  });
}

describe('team_messages retention', () => {
  it('累计插入超过上限后裁剪到最近 N 条（每用户）', () => {
    // cap=10, prune every 5 inserts.
    store.__setTeamMessageRetentionForTesting(10, 5);

    for (let i = 0; i < 40; i += 1) {
      append(USER_ID, i);
    }

    const count = countRows(USER_ID);
    // Amortized prune overshoots the cap by at most one interval.
    expect(count).toBeLessThanOrEqual(15);
    expect(count).toBeGreaterThanOrEqual(10);

    // The earliest message was pruned; the most recent survives.
    expect(
      dbModule.sqliteGet('SELECT id FROM team_messages WHERE id = ?', [`${USER_ID}-msg-0`]),
    ).toBeUndefined();
    expect(
      dbModule.sqliteGet('SELECT id FROM team_messages WHERE id = ?', [`${USER_ID}-msg-39`]),
    ).not.toBeUndefined();
  });

  it('裁剪只影响目标用户，其它用户的消息不受影响', () => {
    store.__setTeamMessageRetentionForTesting(5, 5);

    for (let i = 0; i < 20; i += 1) {
      append(USER_ID, i);
    }
    // other user stays well under the cap and is never pruned.
    for (let i = 0; i < 3; i += 1) {
      append(OTHER_USER_ID, i);
    }

    expect(countRows(USER_ID)).toBeLessThanOrEqual(10);
    expect(countRows(OTHER_USER_ID)).toBe(3);
  });

  it('retention<=0 时禁用裁剪（保留全部）', () => {
    store.__setTeamMessageRetentionForTesting(0, 5);

    for (let i = 0; i < 25; i += 1) {
      append(USER_ID, i);
    }

    expect(countRows(USER_ID)).toBe(25);
  });
});
