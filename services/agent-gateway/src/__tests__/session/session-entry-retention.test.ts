import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ScopeRecencyModule from '../../session/scope-recency-index.js';
import type * as SessionEntryStoreModule from '../../session/session-entry-store.js';
import type { SessionEvent, SessionEventID } from '../../session/session-event.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let scopeRecency: typeof ScopeRecencyModule;
let store: typeof SessionEntryStoreModule;

const SESSION_ID = 'sess-entry-retention';
const USER_ID = 'u-entry-retention';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  scopeRecency = await import('../../session/scope-recency-index.js');
  store = await import('../../session/session-entry-store.js');
});

afterAll(async () => {
  store.__setSessionEntryRetentionForTesting(null);
  await dbModule.closeDb();
});

beforeEach(() => {
  // The recency index is process-global: start every case from a clean slate.
  scopeRecency.__resetScopeRecencyIndexForTesting();
  dbModule.sqliteRun('DELETE FROM session_entry', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'session entry retention', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

function textDelta(text: string, ts: number): SessionEvent {
  return {
    id: `evt-${text}-${ts}-${Math.random().toString(36).slice(2)}` as SessionEventID,
    type: 'text.delta',
    timestamp: ts,
    delta: text,
  } as SessionEvent;
}

function writeScope(clientRequestId: string, eventCount: number, baseTs: number): void {
  for (let i = 0; i < eventCount; i++) {
    store.appendSessionEvent({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId,
      event: textDelta(`${clientRequestId}-${i}`, baseTs + i),
    });
  }
}

describe('session_entry scope retention', () => {
  it('超过上限时整组删最旧 scope、保留最近 N 组且事件序列完整', () => {
    // Cap at 3 scopes, prune on every insert so the trigger is deterministic.
    store.__setSessionEntryRetentionForTesting(3, 1);

    // Five request scopes, each with several delta events, in chronological order.
    for (let s = 0; s < 5; s++) {
      writeScope(`req-${s}`, 4, 1_000 + s * 100);
    }

    // Oldest two scopes were pruned wholesale.
    expect(store.listSessionEvents({ sessionId: SESSION_ID, clientRequestId: 'req-0' })).toEqual(
      [],
    );
    expect(store.listSessionEvents({ sessionId: SESSION_ID, clientRequestId: 'req-1' })).toEqual(
      [],
    );

    // Most recent three scopes are fully retained — sequences not truncated.
    for (const scope of ['req-2', 'req-3', 'req-4']) {
      const events = store.listSessionEvents({ sessionId: SESSION_ID, clientRequestId: scope });
      expect(events).toHaveLength(4);
      expect(events.map((e) => (e as { delta: string }).delta)).toEqual([
        `${scope}-0`,
        `${scope}-1`,
        `${scope}-2`,
        `${scope}-3`,
      ]);
    }
  });

  it('retention=0 关闭裁剪时所有 scope 保留', () => {
    store.__setSessionEntryRetentionForTesting(0, 1);

    for (let s = 0; s < 6; s++) {
      writeScope(`keep-${s}`, 2, 5_000 + s * 100);
    }

    for (let s = 0; s < 6; s++) {
      expect(
        store.listSessionEvents({ sessionId: SESSION_ID, clientRequestId: `keep-${s}` }),
      ).toHaveLength(2);
    }
  });

  it('进程重启（内存次序索引为空）后按 DB 播种，仍收敛到上限', () => {
    store.__setSessionEntryRetentionForTesting(0, 1);
    for (let s = 0; s < 5; s++) {
      writeScope(`boot-${s}`, 2, 9_000 + s * 100);
    }

    // 模拟进程重启：内存次序索引清空，DB 仍是唯一真相。
    scopeRecency.__resetScopeRecencyIndexForTesting();

    store.__setSessionEntryRetentionForTesting(2, 1);
    writeScope('boot-5', 1, 9_900);

    for (const stale of ['boot-0', 'boot-1', 'boot-2', 'boot-3']) {
      expect(store.listSessionEvents({ sessionId: SESSION_ID, clientRequestId: stale })).toEqual(
        [],
      );
    }
    expect(
      store.listSessionEvents({ sessionId: SESSION_ID, clientRequestId: 'boot-4' }),
    ).toHaveLength(2);
    expect(
      store.listSessionEvents({ sessionId: SESSION_ID, clientRequestId: 'boot-5' }),
    ).toHaveLength(1);
  });
});
