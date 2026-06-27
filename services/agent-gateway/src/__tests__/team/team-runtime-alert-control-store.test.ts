import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AlertControlStoreModule from '../../team/team-runtime-alert-control-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let alertControlStore: typeof AlertControlStoreModule;

const USER_ID = 'u-alert-control';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'alert-control@example.com',
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  alertControlStore = await import('../../team/team-runtime-alert-control-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM team_runtime_alert_controls', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team-runtime-alert-control-store', () => {
  it('过期的 suppressed 控制在读取时会自动清理', () => {
    alertControlStore.upsertTeamRuntimeAlertControl({
      alertCode: 'latency-violation',
      note: '短期静音',
      state: 'suppressed',
      suppressedUntilMs: Date.now() + 60_000,
      userId: USER_ID,
    });

    dbModule.sqliteRun(
      `UPDATE team_runtime_alert_controls
          SET suppressed_until_ms = ?
        WHERE user_id = ? AND alert_code = ?`,
      [Date.now() - 1_000, USER_ID, 'latency-violation'],
    );

    expect(
      alertControlStore.listTeamRuntimeAlertControls({
        userId: USER_ID,
      }),
    ).toHaveLength(0);

    const count = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM team_runtime_alert_controls WHERE user_id = ?`,
      [USER_ID],
    );
    expect(count?.c).toBe(0);
  });

  it('支持大批量 alertCodes 过滤查询', () => {
    const alertCodes = Array.from({ length: 905 }, (_, index) => `alert-${index}`);
    for (const alertCode of alertCodes) {
      alertControlStore.upsertTeamRuntimeAlertControl({
        alertCode,
        note: null,
        state: 'acknowledged',
        userId: USER_ID,
      });
    }

    const controls = alertControlStore.listTeamRuntimeAlertControls({
      alertCodes,
      userId: USER_ID,
    });

    expect(controls).toHaveLength(alertCodes.length);
    expect(controls[0]?.alertCode).toBe(alertCodes[0]);
    expect(controls.at(-1)?.alertCode).toBe(alertCodes.at(-1));
  });
});
