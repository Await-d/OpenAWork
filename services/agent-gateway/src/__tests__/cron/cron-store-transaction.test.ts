/**
 * `recordCronExecution` 原子性回归（真实内存 SQLite）。
 *
 * 背景：该函数先 upsert 一条执行记录、再单独 `DELETE` 裁剪保留窗口，两步之间没有
 * 事务。作为「同一次逻辑写入」，一旦第二步失败（磁盘满、锁超时、SQL 漂移……），
 * 第一步的 upsert 会**留在库里**，而裁剪未发生——库里出现超额行，且不再有任何补偿
 * 路径。`deleteCronJob` 已经用 `sqliteTransaction` 包住两步，本用例把同一标准钉在
 * `recordCronExecution` 上。
 *
 * 用例让第二步（DELETE 裁剪）真实抛错（真实 SQLite，不是 mock 行为），断言：
 *   - 当前实现下 upsert 已落库（超限行残留）→ 证明非原子；
 *   - 修复后整段回滚 → 库内无任何该任务的执行行。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../cron/cron-store.js';
import type { CronJobRecord } from '../../cron/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof StoreModule;

const USER_ID = 'u-cron-tx';

function makeJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  const now = Date.now();
  return {
    id: 'job-1',
    user_id: USER_ID,
    name: '每日巡检',
    schedule_kind: 'every',
    schedule_at: null,
    schedule_every: 60_000,
    schedule_expr: null,
    schedule_tz: 'UTC',
    prompt: '检查服务状态',
    agent_id: null,
    model: null,
    working_folder: null,
    session_id: null,
    delivery_mode: 'none',
    delivery_target: null,
    plugin_id: null,
    plugin_chat_id: null,
    enabled: true,
    delete_after_run: false,
    max_iterations: 10,
    last_fired_at: null,
    fire_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  store = await import('../../cron/cron-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM cron_job_executions', []);
  dbModule.sqliteRun('DELETE FROM cron_jobs', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countExecutions(): number {
  return (
    dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM cron_job_executions', [])?.n ?? 0
  );
}

const EXEC = {
  id: 'exec-tx',
  job_id: 'job-1',
  started_at: 1000,
  finished_at: 2000,
  status: 'completed' as const,
};

describe('cron-store · recordCronExecution 原子性', () => {
  it('裁剪失败时 upsert 必须一并回滚（两步同一事务）', () => {
    store.upsertCronJob(makeJob());

    // 真实 SQLite：只把裁剪用的 DELETE 语句拦下抛错，其余（含 BEGIN/COMMIT/ROLLBACK
    // 与 upsert）都走真实实现——这样才能验证「第二步失败时第一步是否落库」。
    const realRun = dbModule.sqliteRun;
    const spy = vi
      .spyOn(dbModule, 'sqliteRun')
      .mockImplementation((query: string, params?: Parameters<typeof realRun>[1]) => {
        if (query.includes('DELETE FROM cron_job_executions') && query.includes('NOT IN')) {
          throw new Error('裁剪失败：模拟 SQL/锁故障');
        }
        realRun(query, params ?? []);
      });

    let thrown: unknown;
    try {
      store.recordCronExecution(USER_ID, EXEC);
    } catch (error) {
      thrown = error;
    } finally {
      spy.mockRestore();
    }

    // 失败必须冒泡（静默吞掉会让调用方以为写成功）。
    expect(thrown).toBeInstanceOf(Error);
    // 原子性核心断言：第一步 upsert 不得留下半成品行。
    expect(countExecutions()).toBe(0);
  });

  it('裁剪失败时不得覆盖已有执行记录的历史状态', () => {
    store.upsertCronJob(makeJob());
    store.recordCronExecution(USER_ID, { ...EXEC, id: 'exec-keep', status: 'running' });

    const realRun = dbModule.sqliteRun;
    const spy = vi
      .spyOn(dbModule, 'sqliteRun')
      .mockImplementation((query: string, params?: Parameters<typeof realRun>[1]) => {
        if (query.includes('DELETE FROM cron_job_executions') && query.includes('NOT IN')) {
          throw new Error('裁剪失败：模拟 SQL/锁故障');
        }
        realRun(query, params ?? []);
      });

    try {
      expect(() =>
        store.recordCronExecution(USER_ID, {
          ...EXEC,
          id: 'exec-keep',
          status: 'completed',
          finished_at: 9999,
        }),
      ).toThrow();
    } finally {
      spy.mockRestore();
    }

    const history = store.listCronExecutionsForJob('job-1');
    expect(history).toHaveLength(1);
    // 失败的那次 upsert 必须被回滚，不能把 running 悄悄改成 completed。
    expect(history[0]).toMatchObject({ id: 'exec-keep', status: 'running' });
  });
});
