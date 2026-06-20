/**
 * Watcher reception awaiting_downstream 死锁兜底测试
 *
 * 验证 recoveryTick 会复位「停在 awaiting_downstream 且下游链已全部终止」的
 * reception session，并在含失败/取消时写用户反馈；同时不误伤下游仍在跑的 reception。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as WatcherModule from '../../handoff/runner/watcher.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let watcherModule: typeof WatcherModule;
let teamEventsBus: typeof TeamEventsBusModule;

const USER_ID = 'u-recv-deadlock';
const RECEPTION_ID = 's-recv';
const PM1_ID = 's-recv-pm1';

// 远早于 heartbeatStaleAfterMs 截止时刻的时间戳，保证通过「年龄护栏」。
const OLD_TS = '2000-01-01 00:00:00';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'recv-deadlock@example.com',
  ]);
}

function seedReception(substateUpdatedAt: string | null): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions
       (id, user_id, title, metadata_json, role_layer, substate, substate_updated_at)
     VALUES (?, ?, 'recv', '{}', 'reception', 'awaiting_downstream', ?)`,
    [RECEPTION_ID, USER_ID, substateUpdatedAt],
  );
}

function seedChild(sessionId: string, roleLayer: string, parent: string): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer, team_parent_session_id)
     VALUES (?, ?, 'demo', '{}', ?, ?)`,
    [sessionId, USER_ID, roleLayer, parent],
  );
}

function seedHandoff(id: string, fromS: string, toS: string, toLayer: string, state: string): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, retry_count)
     VALUES (?, ?, ?, 'reception', ?, ?, '{}', ?, 0)`,
    [id, USER_ID, fromS, toLayer, toS, state],
  );
}

function getSubstate(sessionId: string): string | null {
  return (
    dbModule.sqliteGet<{ substate: string | null }>(`SELECT substate FROM sessions WHERE id = ?`, [
      sessionId,
    ])?.substate ?? null
  );
}

function getStateStatus(sessionId: string): string | null {
  return (
    dbModule.sqliteGet<{ state_status: string | null }>(
      `SELECT state_status FROM sessions WHERE id = ?`,
      [sessionId],
    )?.state_status ?? null
  );
}

function messageCount(sessionId: string): number {
  return (
    dbModule.sqliteGet<{ c: number }>(`SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`, [
      sessionId,
    ])?.c ?? 0
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  watcherModule = await import('../../handoff/runner/watcher.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('reconcileStuckReceptionSessions（经 recoveryTick）', () => {
  it('下游链全部终止（含失败）→ 复位 idle + 写用户反馈', async () => {
    seedReception(OLD_TS);
    seedChild(PM1_ID, 'pm1', RECEPTION_ID);
    // 下游唯一 handoff 已 failed
    seedHandoff('h-1', RECEPTION_ID, PM1_ID, 'pm1', 'failed');

    const watcher = new watcherModule.HandoffWatcher();
    await watcher.recoveryTick();

    expect(getSubstate(RECEPTION_ID)).toBe('idle');
    expect(getStateStatus(RECEPTION_ID)).toBe('idle');
    expect(messageCount(RECEPTION_ID)).toBeGreaterThanOrEqual(1);
  });

  it('下游仍有存活 handoff → 不复位', async () => {
    seedReception(OLD_TS);
    seedChild(PM1_ID, 'pm1', RECEPTION_ID);
    seedHandoff('h-live', RECEPTION_ID, PM1_ID, 'pm1', 'running');

    const watcher = new watcherModule.HandoffWatcher();
    await watcher.recoveryTick();

    expect(getSubstate(RECEPTION_ID)).toBe('awaiting_downstream');
  });

  it('年龄护栏：substate 刚更新（瞬态窗口）→ 不复位', async () => {
    // substate_updated_at = now → 早于 cutoff 的条件不满足，跳过。
    const nowIso =
      dbModule.sqliteGet<{ v: string }>(`SELECT datetime('now') AS v`)?.v ?? OLD_TS;
    seedReception(nowIso);
    seedChild(PM1_ID, 'pm1', RECEPTION_ID);
    seedHandoff('h-done', RECEPTION_ID, PM1_ID, 'pm1', 'completed');

    const watcher = new watcherModule.HandoffWatcher();
    await watcher.recoveryTick();

    expect(getSubstate(RECEPTION_ID)).toBe('awaiting_downstream');
  });

  it('全部正常完成（无失败/取消）→ 复位 idle 但不写重试提示', async () => {
    seedReception(OLD_TS);
    seedChild(PM1_ID, 'pm1', RECEPTION_ID);
    seedHandoff('h-ok', RECEPTION_ID, PM1_ID, 'pm1', 'completed');

    const watcher = new watcherModule.HandoffWatcher();
    await watcher.recoveryTick();

    expect(getSubstate(RECEPTION_ID)).toBe('idle');
    expect(getStateStatus(RECEPTION_ID)).toBe('idle');
    expect(messageCount(RECEPTION_ID)).toBe(0);
  });
});
