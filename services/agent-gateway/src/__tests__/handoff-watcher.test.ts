/**
 * 260515-team-phase-b · T-04 / T-06 单元测试
 *
 * 覆盖 Watcher tickOnce / recoveryTick + heartbeat 联动。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../db.js';
import type * as HandoffStoreModule from '../handoff/handoff-store.js';
import type * as HeartbeatModule from '../handoff/heartbeat.js';
import type * as WatcherModule from '../handoff/watcher.js';
import {
  InProcessScheduler,
  __resetBackgroundTaskSchedulerForTesting,
} from '../handoff/scheduler.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;
let heartbeat: typeof HeartbeatModule;
let watcherModule: typeof WatcherModule;

const USER_ID = 'u-watcher';
const FROM_SESSION_ID = 's-watcher-from';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json)
     VALUES (?, ?, 'demo', '{}')`,
    [sessionId, userId],
  );
}

beforeAll(async () => {
  dbModule = await import('../db.js');
  await dbModule.migrate();
  store = await import('../handoff/handoff-store.js');
  heartbeat = await import('../handoff/heartbeat.js');
  watcherModule = await import('../handoff/watcher.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'watcher@example.com');
  seedSession(FROM_SESSION_ID, USER_ID);
  __resetBackgroundTaskSchedulerForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('HandoffWatcher.tickOnce', () => {
  it('claim pending → 创建子 session → start handoff → 排队 task', async () => {
    const scheduler = new InProcessScheduler();
    let runnerCalled = 0;
    const watcher = new watcherModule.HandoffWatcher({
      taskRunner: async () => {
        runnerCalled += 1;
      },
      scheduler,
    });

    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { intent: '测试' },
    });

    const result = await watcher.tickOnce();
    expect(result.claimed).toBe(1);
    expect(result.skipped).toBe(0);

    const after = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(after?.state).toBe('running');
    expect(after?.toSessionId).not.toBeNull();

    // 等 scheduler 异步完成
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runnerCalled).toBe(1);

    const final = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(final?.state).toBe('completed');
  });

  it('多个 pending 同 tick 内全部处理', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
    });
    for (let i = 0; i < 3; i += 1) {
      store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
    }
    const result = await watcher.tickOnce();
    expect(result.claimed).toBe(3);
  });

  it('已被别处 claim 的会跳过（skipped 计数）', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
    });
    const a = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    // 抢先 claim
    store.claimHandoff({ handoffId: a.id, claimToken: 'external' });

    const result = await watcher.tickOnce();
    // pending 列表查询时已经不包含 a（因为 state='claimed'），所以 claimed=0/skipped=0
    expect(result.claimed).toBe(0);
  });

  it('runner 抛错时 handoff 进入 failed', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: async () => {
        throw new Error('runner-fail');
      },
    });
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    await watcher.tickOnce();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const final = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(final?.state).toBe('failed');
    expect(final?.failureReason).toBe('runner-fail');
  });
});

describe('HandoffWatcher.recoveryTick', () => {
  it('心跳超时的 running 退回 pending（retry+1）', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      // 用极短的 stale 阈值 + maxRetry 让测试可控
      heartbeatStaleAfterMs: 1,
      maxRetry: 5,
    });
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    // 手动创建 to session，模拟 watcher 之前的工作
    seedSession('to-session-recovery', USER_ID);
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: 'to-session-recovery',
    });
    // 不写 heartbeat → 视为超时

    // 等够 stale 阈值
    await new Promise((r) => setTimeout(r, 5));

    const result = await watcher.recoveryTick();
    expect(result.recovered).toBe(1);
    const re = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(re?.state).toBe('pending');
    expect(re?.retryCount).toBe(1);
  });
});

describe('heartbeat helpers', () => {
  it('touchSessionHeartbeat 写入 last_heartbeat', () => {
    seedSession('hb-session', USER_ID);
    heartbeat.touchSessionHeartbeat('hb-session');
    const row = dbModule.sqliteGet<{ last_heartbeat: string | null }>(
      `SELECT last_heartbeat FROM sessions WHERE id = ?`,
      ['hb-session'],
    );
    expect(row?.last_heartbeat).not.toBeNull();
  });

  it('clearSessionHeartbeat 清空', () => {
    seedSession('hb2', USER_ID);
    heartbeat.touchSessionHeartbeat('hb2');
    heartbeat.clearSessionHeartbeat('hb2');
    const row = dbModule.sqliteGet<{ last_heartbeat: string | null }>(
      `SELECT last_heartbeat FROM sessions WHERE id = ?`,
      ['hb2'],
    );
    expect(row?.last_heartbeat).toBeNull();
  });

  it('findStaleHeartbeatCutoffIso 返回 ISO-like 字符串', () => {
    const iso = heartbeat.findStaleHeartbeatCutoffIso(60_000);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('start/stop 生命周期', () => {
  it('start 后 stop 不挂起', async () => {
    vi.useFakeTimers();
    try {
      const watcher = new watcherModule.HandoffWatcher({
        scheduler: new InProcessScheduler(),
        watcherIntervalMs: 100,
        recoveryIntervalMs: 5_000,
      });
      watcher.start();
      await watcher.stop();
      // 没异常即通过
    } finally {
      vi.useRealTimers();
    }
  });
});
