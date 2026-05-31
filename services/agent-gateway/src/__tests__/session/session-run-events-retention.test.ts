import type { RunEvent } from '@openAwork/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SessionRunEventsModule from '../../session/session-run-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let sessionRunEvents: typeof SessionRunEventsModule;

const SESSION_ID = 'sess-retention';
const USER_ID = 'u-retention';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  sessionRunEvents = await import('../../session/session-run-events.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_entry', []);
  dbModule.sqliteRun('DELETE FROM session_run_events', []);
  dbModule.sqliteRun('DELETE FROM notifications', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'retention', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  // Clear the test override so other suites see production defaults.
  sessionRunEvents.__setSessionRunEventRetentionForTesting(null);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function writeScope(clientRequestId: string, deltaCount: number): void {
  for (let i = 0; i < deltaCount; i++) {
    const event: RunEvent = {
      type: 'text_delta',
      delta: `chunk-${i}`,
      eventId: `${clientRequestId}:${i}`,
      occurredAt: Date.now(),
    };
    sessionRunEvents.persistSessionRunEventForRequest(SESSION_ID, event, { clientRequestId });
  }
}

function distinctScopeCount(): number {
  const rows = dbModule.sqliteAll<{ client_request_id: string }>(
    `SELECT DISTINCT client_request_id FROM session_run_events
      WHERE session_id = ? AND client_request_id IS NOT NULL`,
    [SESSION_ID],
  );
  return rows.length;
}

describe('session_run_events 每会话 scope 保留裁剪', () => {
  it('完成的旧 scope 被整段裁剪，仅保留最近 N 个 scope（含活跃 run）', () => {
    // Cap at 3 scopes, prune check every insert so each scope-end triggers it.
    sessionRunEvents.__setSessionRunEventRetentionForTesting(3, 1);

    // Write 10 distinct request scopes (each a completed "run").
    for (let r = 0; r < 10; r++) {
      writeScope(`req-${r}`, 4);
    }

    // Only the 3 most recent scopes survive; older ones pruned wholesale.
    expect(distinctScopeCount()).toBe(3);

    // The survivors are the newest scopes, fully intact (all 4 rows each).
    for (const recent of ['req-7', 'req-8', 'req-9']) {
      const events = sessionRunEvents.listSessionRunEventsByRequest({
        sessionId: SESSION_ID,
        clientRequestId: recent,
      });
      expect(events).toHaveLength(4);
    }

    // An evicted scope is gone entirely (all-or-nothing, never truncated head).
    expect(
      sessionRunEvents.listSessionRunEventsByRequest({
        sessionId: SESSION_ID,
        clientRequestId: 'req-0',
      }),
    ).toHaveLength(0);
  });

  it('retention=0 时关闭裁剪，所有 scope 全部保留', () => {
    sessionRunEvents.__setSessionRunEventRetentionForTesting(0, 1);

    for (let r = 0; r < 8; r++) {
      writeScope(`keep-${r}`, 2);
    }

    expect(distinctScopeCount()).toBe(8);
  });
});
