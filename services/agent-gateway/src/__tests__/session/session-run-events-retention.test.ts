import type { RunEvent } from '@openAwork/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ScopeRecencyModule from '../../session/scope-recency-index.js';
import type * as SessionRunEventsModule from '../../session/session-run-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let scopeRecency: typeof ScopeRecencyModule;
let sessionRunEvents: typeof SessionRunEventsModule;

const SESSION_ID = 'sess-retention';
const USER_ID = 'u-retention';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  sessionRunEvents = await import('../../session/session-run-events.js');
  scopeRecency = await import('../../session/scope-recency-index.js');
});

beforeEach(() => {
  // The recency index is process-global: start every case from a clean slate so
  // scope ordering cannot leak in from the previous test.
  scopeRecency.__resetScopeRecencyIndexForTesting();
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

function scopeRowCount(clientRequestId: string): number {
  return sessionRunEvents.listSessionRunEventsByRequest({
    sessionId: SESSION_ID,
    clientRequestId,
  }).length;
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

  it('进程重启（内存次序索引为空）后按 DB 播种，仍收敛到上限', () => {
    // 关掉裁剪，让 6 个 scope 完整落库。
    sessionRunEvents.__setSessionRunEventRetentionForTesting(0, 1);
    for (let r = 0; r < 6; r++) {
      writeScope(`boot-${r}`, 3);
    }
    expect(distinctScopeCount()).toBe(6);

    // 模拟进程重启：内存次序索引清空，DB 仍是唯一真相。
    scopeRecency.__resetScopeRecencyIndexForTesting();

    sessionRunEvents.__setSessionRunEventRetentionForTesting(3, 1);
    writeScope('boot-6', 1);

    // 播种后按 DB 的 MAX(id) 次序收敛：最旧的 4 个被整段淘汰。
    expect(distinctScopeCount()).toBe(3);
    for (const stale of ['boot-0', 'boot-1', 'boot-2', 'boot-3']) {
      expect(scopeRowCount(stale)).toBe(0);
    }
    for (const recent of ['boot-4', 'boot-5']) {
      expect(scopeRowCount(recent)).toBe(3);
    }
    expect(scopeRowCount('boot-6')).toBe(1);
  });

  it('续写（复用同一 client_request_id）的 scope 视为最新，不会被优先淘汰', () => {
    sessionRunEvents.__setSessionRunEventRetentionForTesting(3, 1);

    for (const scope of ['r-0', 'r-1', 'r-2']) {
      writeScope(scope, 2);
    }
    expect(distinctScopeCount()).toBe(3);

    // 第 4 个 scope 挤掉最旧的 r-0。
    writeScope('r-3', 2);
    expect(distinctScopeCount()).toBe(3);
    expect(scopeRowCount('r-0')).toBe(0);

    // 失败重试会复用同一个 request id：续写 r-0 后它变成最新，淘汰的应是 r-1。
    writeScope('r-0', 2);
    expect(distinctScopeCount()).toBe(3);
    expect(scopeRowCount('r-0')).toBe(2);
    expect(scopeRowCount('r-1')).toBe(0);
    expect(scopeRowCount('r-2')).toBe(2);
    expect(scopeRowCount('r-3')).toBe(2);
  });
});
