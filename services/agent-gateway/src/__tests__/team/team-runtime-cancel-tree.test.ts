/**
 * cancelTeamRuntimeTree 单元测试（跨层级联取消）
 *
 * 覆盖：
 *   - 取消 reception 子树 → 子树内所有未终止 handoff 全部置 cancelled
 *   - 已终止（completed/failed/cancelled）的 handoff 不被重复处理
 *   - 不属于该子树的 handoff 不受影响
 *   - 根 session 不存在 → 返回 null
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ControlStoreModule from '../../team/team-runtime-control-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let control: typeof ControlStoreModule;

const USER_ID = 'u-cancel-tree';
const RECEPTION_ID = 's-reception';
const PM1_ID = 's-pm1';
const PM2_ID = 's-pm2';
const EXECUTOR_ID = 's-executor';
const OTHER_ID = 's-other-root';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'cancel-tree@example.com',
  ]);
}

function seedSession(sessionId: string, roleLayer: string, parent: string | null): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer, team_parent_session_id)
     VALUES (?, ?, 'demo', '{}', ?, ?)`,
    [sessionId, USER_ID, roleLayer, parent],
  );
}

/** 直接插一条 handoff（绕过 capability guard，便于构造任意子树形状）。 */
function seedHandoff(input: {
  id: string;
  fromSessionId: string;
  toSessionId: string | null;
  fromLayer: string;
  toLayer: string;
  state: string;
}): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, 0)`,
    [input.id, USER_ID, input.fromSessionId, input.fromLayer, input.toLayer, input.toSessionId, input.state],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  control = await import('../../team/team-runtime-control-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  // 子树：reception → pm1 → pm2 → executor
  seedSession(RECEPTION_ID, 'reception', null);
  seedSession(PM1_ID, 'pm1', RECEPTION_ID);
  seedSession(PM2_ID, 'pm2', PM1_ID);
  seedSession(EXECUTOR_ID, 'executor', PM2_ID);
  // 不相关的另一棵树
  seedSession(OTHER_ID, 'reception', null);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('cancelTeamRuntimeTree', () => {
  it('取消整棵子树内所有未终止 handoff', () => {
    seedHandoff({
      id: 'h-pm1',
      fromSessionId: RECEPTION_ID,
      toSessionId: PM1_ID,
      fromLayer: 'reception',
      toLayer: 'pm1',
      state: 'running',
    });
    seedHandoff({
      id: 'h-pm2',
      fromSessionId: PM1_ID,
      toSessionId: PM2_ID,
      fromLayer: 'pm1',
      toLayer: 'pm2',
      state: 'running',
    });
    seedHandoff({
      id: 'h-exec',
      fromSessionId: PM2_ID,
      toSessionId: EXECUTOR_ID,
      fromLayer: 'pm2',
      toLayer: 'executor',
      state: 'pending',
    });

    const result = control.cancelTeamRuntimeTree({
      rootSessionId: RECEPTION_ID,
      userId: USER_ID,
    });

    expect(result).not.toBeNull();
    expect(result?.cancelledHandoffIds.sort()).toEqual(['h-exec', 'h-pm1', 'h-pm2']);
    for (const id of ['h-pm1', 'h-pm2', 'h-exec']) {
      const row = dbModule.sqliteGet<{ state: string }>(
        `SELECT state FROM handoff_records WHERE id = ?`,
        [id],
      );
      expect(row?.state).toBe('cancelled');
    }
  });

  it('已终止的 handoff 不被处理', () => {
    seedHandoff({
      id: 'h-done',
      fromSessionId: RECEPTION_ID,
      toSessionId: PM1_ID,
      fromLayer: 'reception',
      toLayer: 'pm1',
      state: 'completed',
    });
    seedHandoff({
      id: 'h-live',
      fromSessionId: PM1_ID,
      toSessionId: PM2_ID,
      fromLayer: 'pm1',
      toLayer: 'pm2',
      state: 'running',
    });

    const result = control.cancelTeamRuntimeTree({
      rootSessionId: RECEPTION_ID,
      userId: USER_ID,
    });

    expect(result?.cancelledHandoffIds).toEqual(['h-live']);
    expect(
      dbModule.sqliteGet<{ state: string }>(`SELECT state FROM handoff_records WHERE id = ?`, [
        'h-done',
      ])?.state,
    ).toBe('completed');
  });

  it('不影响其它子树的 handoff', () => {
    seedHandoff({
      id: 'h-mine',
      fromSessionId: RECEPTION_ID,
      toSessionId: PM1_ID,
      fromLayer: 'reception',
      toLayer: 'pm1',
      state: 'running',
    });
    seedHandoff({
      id: 'h-other',
      fromSessionId: OTHER_ID,
      toSessionId: null,
      fromLayer: 'reception',
      toLayer: 'pm1',
      state: 'running',
    });

    control.cancelTeamRuntimeTree({ rootSessionId: RECEPTION_ID, userId: USER_ID });

    expect(
      dbModule.sqliteGet<{ state: string }>(`SELECT state FROM handoff_records WHERE id = ?`, [
        'h-other',
      ])?.state,
    ).toBe('running');
  });

  it('根 session 不存在 → 返回 null', () => {
    const result = control.cancelTeamRuntimeTree({
      rootSessionId: 'does-not-exist',
      userId: USER_ID,
    });
    expect(result).toBeNull();
  });
});
