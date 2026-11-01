import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../handoff/store/handoff-store.js';
import type * as WatcherModule from '../../handoff/runner/watcher.js';
import { InProcessScheduler } from '../../handoff/runner/scheduler.js';
vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));
process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
let db: typeof DbModule;
let store: typeof StoreModule;
let watcherModule: typeof WatcherModule;
const USER = 'capacity-user';
const PARENT = 'capacity-parent';
beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.migrate();
  store = await import('../../handoff/store/handoff-store.js');
  watcherModule = await import('../../handoff/runner/watcher.js');
});
beforeEach(() => {
  db.sqliteRun('DELETE FROM users', []);
  db.sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES (?, 'capacity@test.local', 'x')",
    [USER],
  );
  db.sqliteRun(
    "INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, '容量测试', '{}')",
    [PARENT, USER],
  );
});
afterAll(async () => {
  await db.closeDb();
});
function createExecution() {
  return store.createHandoff({
    userId: USER,
    fromSessionId: PARENT,
    fromRoleLayer: 'pm2',
    toRoleLayer: 'executor',
  });
}
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}
describe('Team 执行成员并发领取', () => {
  it('九个任务最多八个被领取，跨 watcher 共享容量，释放后接手剩余任务', async () => {
    const records = Array.from({ length: 9 }, () => createExecution());
    let release: () => void = () => {
      throw new Error('尚未初始化');
    };
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = async () => {
      await held;
    };
    const first = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: runner,
    });
    const second = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: runner,
    });
    try {
      expect((await first.tickOnce()).claimed).toBe(8);
      expect(
        records.filter((record) => store.getHandoffById(record.id)?.state === 'pending'),
      ).toHaveLength(1);
      expect((await second.tickOnce()).claimed).toBe(0);
      release();
      await settle();
      expect((await second.tickOnce()).claimed).toBe(1);
    } finally {
      release();
      await settle();
      await first.stop();
      await second.stop();
    }
  });
});
