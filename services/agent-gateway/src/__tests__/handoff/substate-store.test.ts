import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as LatencyMonitorModule from '../../handoff/bus/latency-monitor.js';
import type * as SubstateStoreModule from '../../handoff/store/substate-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let latencyMonitor: typeof LatencyMonitorModule;
let substateStore: typeof SubstateStoreModule;

const USER_ID = 'u-substate-store';
const SESSION_ID = 's-substate-store';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'substate-store@example.com',
  ]);
}

function seedSession(): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', 'pm1')`,
    [SESSION_ID, USER_ID],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  latencyMonitor = await import('../../handoff/bus/latency-monitor.js');
  substateStore = await import('../../handoff/store/substate-store.js');
});

beforeEach(() => {
  latencyMonitor.__resetLatencyMonitorForTesting();
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedSession();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('setSubstate progress_interval', () => {
  it('等待态会清空进度基线，恢复执行时不计入等待时长', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500)
      .mockReturnValueOnce(1_700)
      .mockReturnValueOnce(120_000);

    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_C.DRAFTING_SPEC,
      roleLayer: 'pm1',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_C.SPEC_READY,
      roleLayer: 'pm1',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_C.CLARIFYING,
      roleLayer: 'pm1',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_C.SPEC_READY,
      roleLayer: 'pm1',
    });

    const stats = latencyMonitor.getLatencyStats('progress_interval');
    expect(stats.count).toBe(2);
    expect(stats.maxMs).toBe(500);
    expect(stats.violationCount).toBe(0);
  });

  it('回到 idle 后会清空进度基线，下一轮启动不计入空闲时长', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(5_000)
      .mockReturnValueOnce(5_250)
      .mockReturnValueOnce(5_400)
      .mockReturnValueOnce(88_000);

    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_RECEPTION.CHATTING,
      roleLayer: 'reception',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_RECEPTION.ROUTING,
      roleLayer: 'reception',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_RECEPTION.IDLE,
      roleLayer: 'reception',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_RECEPTION.DISPATCHING,
      roleLayer: 'reception',
    });

    const stats = latencyMonitor.getLatencyStats('progress_interval');
    expect(stats.count).toBe(2);
    expect(stats.maxMs).toBe(250);
    expect(stats.violationCount).toBe(0);
  });

  it('清空 substate 后会重置进度基线', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(20_180)
      .mockReturnValueOnce(20_260)
      .mockReturnValueOnce(77_000);

    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_C.DRAFTING_PLAN,
      roleLayer: 'pm1',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_C.PLAN_READY,
      roleLayer: 'pm1',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: null,
      roleLayer: 'pm1',
    });
    substateStore.setSubstate({
      sessionId: SESSION_ID,
      substate: substateStore.SUBSTATES_C.DRAFTING_TASKS,
      roleLayer: 'pm1',
    });

    const stats = latencyMonitor.getLatencyStats('progress_interval');
    expect(stats.count).toBe(2);
    expect(stats.maxMs).toBe(180);
    expect(stats.violationCount).toBe(0);
  });
});
