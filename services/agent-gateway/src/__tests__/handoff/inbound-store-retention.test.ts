/**
 * Robustness: `session_inbound_messages` rows transition pending →
 * consumed/expired via the state machine but were never DELETEd in production
 * (only the session-delete CASCADE). A long-lived team session with frequent
 * inbound traffic accumulated terminal-state rows without bound. The store now
 * prunes old terminal rows (created_at past a retention window) on an amortized
 * schedule; pending rows are never pruned.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as InboundStoreModule from '../../handoff/store/inbound-store.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof InboundStoreModule;
let teamEventsBus: typeof TeamEventsBusModule;

const USER_ID = 'u-inbound-retention';
const SESSION_ID = 's-inbound-retention';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/inbound-store.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
  dbModule.sqliteRun('DELETE FROM session_inbound_messages', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', 'pm1')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countRows(): number {
  const row = dbModule.sqliteGet<{ n: number }>(
    'SELECT COUNT(*) AS n FROM session_inbound_messages',
    [],
  );
  return row?.n ?? 0;
}

/** Insert a terminal-state row with an explicit (possibly backdated) created_at. */
function insertTerminalRow(id: string, state: 'consumed' | 'expired', ageHours: number): void {
  dbModule.sqliteRun(
    `INSERT INTO session_inbound_messages
       (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state, created_at)
     VALUES (?, ?, ?, 'reception', 'user_input', '{}', ?, datetime('now', ?))`,
    [id, USER_ID, SESSION_ID, state, `-${ageHours} hours`],
  );
}

describe('session_inbound_messages terminal-row retention', () => {
  it('插入达到间隔时清除超过保留窗口的终态行，但保留窗口内的与 pending 行', () => {
    // Retention window 48h, prune every 3 inserts.
    store.__setSessionInboundRetentionForTesting(48, 3);

    // Old terminal rows (well past the window) — should be pruned.
    insertTerminalRow('old-1', 'consumed', 100);
    insertTerminalRow('old-2', 'expired', 200);
    // Recent terminal row (inside the window) — should survive.
    insertTerminalRow('recent-1', 'consumed', 1);
    // A pending row, regardless of age, must never be pruned here.
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
         (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state, created_at)
       VALUES ('pending-old', ?, ?, 'reception', 'cancel_signal', '{}', 'pending', datetime('now', '-500 hours'))`,
      [USER_ID, SESSION_ID],
    );
    expect(countRows()).toBe(4);

    // Three submits trip the prune interval.
    for (let i = 0; i < 3; i += 1) {
      store.submitInboundMessage({
        userId: USER_ID,
        toSessionId: SESSION_ID,
        fromRoleLayer: 'reception',
        messageType: 'user_input',
        payload: { text: `m${i}` },
      });
    }

    // old-1 / old-2 pruned; recent-1 + pending-old + 3 new pending survive = 5.
    expect(
      dbModule.sqliteGet('SELECT id FROM session_inbound_messages WHERE id = ?', ['old-1']),
    ).toBeUndefined();
    expect(
      dbModule.sqliteGet('SELECT id FROM session_inbound_messages WHERE id = ?', ['old-2']),
    ).toBeUndefined();
    expect(
      dbModule.sqliteGet('SELECT id FROM session_inbound_messages WHERE id = ?', ['recent-1']),
    ).not.toBeNull();
    expect(
      dbModule.sqliteGet('SELECT id FROM session_inbound_messages WHERE id = ?', ['pending-old']),
    ).not.toBeNull();
    expect(countRows()).toBe(5);
  });

  it('过期但仍 pending 的孤儿行在裁剪时被全局转 expired 并按保留窗口回收，永不过期的 pending 不受影响', () => {
    // Retention window 48h, prune every 3 inserts.
    store.__setSessionInboundRetentionForTesting(48, 3);

    // 过期 pending 孤儿行：expires_at 已过、created_at 远超保留窗口。
    // 旧实现里它永远停在 pending（无人轮询该 session），既不被读到也不被回收。
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
         (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state, expires_at, created_at)
       VALUES ('expired-pending-old', ?, ?, 'reception', 'user_input', '{}', 'pending',
               datetime('now', '-300 hours'), datetime('now', '-300 hours'))`,
      [USER_ID, SESSION_ID],
    );
    // 永不过期的 pending（cancel_signal，expires_at IS NULL）即使很旧也必须保留。
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
         (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state, expires_at, created_at)
       VALUES ('never-expire-pending', ?, ?, 'reception', 'cancel_signal', '{}', 'pending',
               NULL, datetime('now', '-500 hours'))`,
      [USER_ID, SESSION_ID],
    );
    // 尚未过期的 pending（expires_at 在未来）必须保留为 pending。
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
         (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state, expires_at, created_at)
       VALUES ('future-pending', ?, ?, 'reception', 'user_input', '{}', 'pending',
               datetime('now', '+24 hours'), datetime('now', '-300 hours'))`,
      [USER_ID, SESSION_ID],
    );
    expect(countRows()).toBe(3);

    // 三次提交触发裁剪。
    for (let i = 0; i < 3; i += 1) {
      store.submitInboundMessage({
        userId: USER_ID,
        toSessionId: SESSION_ID,
        fromRoleLayer: 'reception',
        messageType: 'user_input',
        payload: { text: `m${i}` },
      });
    }

    // 过期 pending 孤儿行：先被全局转 expired，再因 created_at 超窗被 DELETE。
    expect(
      dbModule.sqliteGet('SELECT id FROM session_inbound_messages WHERE id = ?', [
        'expired-pending-old',
      ]),
    ).toBeUndefined();
    // 永不过期的 pending 保留。
    expect(
      dbModule.sqliteGet('SELECT id FROM session_inbound_messages WHERE id = ?', [
        'never-expire-pending',
      ]),
    ).not.toBeNull();
    // 未过期的 pending 仍是 pending（未被误转 expired）。
    const future = dbModule.sqliteGet<{ state: string }>(
      'SELECT state FROM session_inbound_messages WHERE id = ?',
      ['future-pending'],
    );
    expect(future?.state).toBe('pending');
    // never-expire-pending + future-pending + 3 条新 pending = 5。
    expect(countRows()).toBe(5);
  });

  it('retention<=0 时禁用裁剪（保留全部终态行）', () => {
    store.__setSessionInboundRetentionForTesting(0, 3);

    insertTerminalRow('old-a', 'consumed', 1000);
    insertTerminalRow('old-b', 'expired', 2000);

    for (let i = 0; i < 5; i += 1) {
      store.submitInboundMessage({
        userId: USER_ID,
        toSessionId: SESSION_ID,
        fromRoleLayer: 'reception',
        messageType: 'user_input',
        payload: { text: `m${i}` },
      });
    }

    // Nothing pruned: 2 old terminal + 5 new pending.
    expect(countRows()).toBe(7);
  });
});
