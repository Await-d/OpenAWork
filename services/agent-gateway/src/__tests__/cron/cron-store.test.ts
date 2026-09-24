/**
 * `cron_jobs` / `cron_job_executions` 持久化回归（真实内存 SQLite）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../cron/cron-store.js';
import type { CronJobRecord } from '../../cron/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof StoreModule;

const USER_ID = 'u-cron-store';

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

describe('cron-store · 任务定义', () => {
  it('upsert 后可 round-trip 全部字段（含可空字段）', () => {
    const job = makeJob({
      id: 'job-full',
      schedule_kind: 'cron',
      schedule_every: null,
      schedule_expr: '0 9 * * *',
      schedule_tz: 'Asia/Shanghai',
      agent_id: 'agent-1',
      model: 'gpt-4o',
      working_folder: '/tmp/ws',
      session_id: 'session-1',
      delivery_mode: 'session',
      delivery_target: 'tg:1',
      plugin_id: 'telegram',
      plugin_chat_id: 'c-1',
      delete_after_run: true,
      max_iterations: 3,
      last_fired_at: 1234,
      fire_count: 5,
    });
    store.upsertCronJob(job);

    const restored = store.getCronJobById('job-full');
    expect(restored).toEqual(job);
    expect(store.listCronJobsForRestore()).toEqual([job]);
  });

  it('同 id upsert 覆盖字段（启停 / fire_count / updated_at）', () => {
    store.upsertCronJob(makeJob());
    store.upsertCronJob(makeJob({ enabled: false, fire_count: 7, updated_at: 999 }));

    const restored = store.getCronJobById('job-1');
    expect(restored).toMatchObject({ enabled: false, fire_count: 7, updated_at: 999 });
  });

  it('deleteCronJob 删除任务定义并级联清理执行历史（避免孤儿行）', () => {
    store.upsertCronJob(makeJob());
    store.recordCronExecution(USER_ID, {
      id: 'exec-orphan',
      job_id: 'job-1',
      started_at: 1,
      finished_at: 2,
      status: 'completed',
    });
    expect(countExecutions()).toBe(1);

    store.deleteCronJob('job-1');
    expect(store.getCronJobById('job-1')).toBeUndefined();
    expect(store.listCronJobsForRestore()).toEqual([]);
    expect(countExecutions()).toBe(0);
  });
});

describe('cron-store · 执行历史', () => {
  it('running → completed upsert 与倒序读取', async () => {
    store.upsertCronJob(makeJob());
    const exec = {
      id: 'exec-1',
      job_id: 'job-1',
      started_at: 1000,
      finished_at: null,
      status: 'running' as const,
    };
    store.recordCronExecution(USER_ID, exec);
    store.recordCronExecution(USER_ID, { ...exec, finished_at: 2000, status: 'completed' });

    const history = store.listCronExecutionsForJob('job-1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: 'exec-1', status: 'completed', finished_at: 2000 });
    expect(countExecutions()).toBe(1);
  });

  it('失败执行的 error 与 session_id 可 round-trip', () => {
    store.recordCronExecution(USER_ID, {
      id: 'exec-2',
      job_id: 'job-1',
      started_at: 1000,
      finished_at: 1500,
      status: 'failed',
      error: 'boom',
      session_id: 's-1',
    });
    expect(store.listCronExecutionsForJob('job-1')[0]).toMatchObject({
      status: 'failed',
      error: 'boom',
      session_id: 's-1',
    });
  });

  it('按任务保留上限裁剪（超过 200 条丢弃最旧）', () => {
    store.upsertCronJob(makeJob());
    for (let index = 0; index < 205; index += 1) {
      store.recordCronExecution(USER_ID, {
        id: `exec-${index}`,
        job_id: 'job-1',
        started_at: index,
        finished_at: index,
        status: 'completed',
      });
    }
    expect(countExecutions()).toBe(store.CRON_EXECUTION_RETENTION_PER_JOB);
    const history = store.listCronExecutionsForJob('job-1', 1000);
    expect(history[0]?.id).toBe('exec-204');
    expect(history.some((exec) => exec.id === 'exec-0')).toBe(false);
  });

  it('markInterruptedCronExecutions 把残留 running 标记为中断失败', () => {
    store.recordCronExecution(USER_ID, {
      id: 'exec-running',
      job_id: 'job-1',
      started_at: 1000,
      finished_at: null,
      status: 'running',
    });
    store.recordCronExecution(USER_ID, {
      id: 'exec-done',
      job_id: 'job-1',
      started_at: 900,
      finished_at: 950,
      status: 'completed',
    });

    expect(store.markInterruptedCronExecutions()).toBe(1);
    const history = store.listCronExecutionsForJob('job-1');
    const interrupted = history.find((exec) => exec.id === 'exec-running');
    expect(interrupted).toMatchObject({ status: 'failed' });
    expect(interrupted?.error).toContain('网关重启中断');
    expect(history.find((exec) => exec.id === 'exec-done')?.status).toBe('completed');
    // 幂等：第二次没有可标记的行。
    expect(store.markInterruptedCronExecutions()).toBe(0);
  });
});

describe('cron-store · 启动恢复', () => {
  it('restoreCronJobsFromStore 装载任务并标记中断执行', () => {
    store.upsertCronJob(makeJob({ id: 'job-a' }));
    store.upsertCronJob(makeJob({ id: 'job-b', enabled: false }));
    store.recordCronExecution(USER_ID, {
      id: 'exec-running',
      job_id: 'job-a',
      started_at: 1,
      finished_at: null,
      status: 'running',
    });

    const restoreJobs = vi.fn();
    const result = store.restoreCronJobsFromStore({ restoreJobs });

    expect(result).toEqual({ restored: 2, interrupted: 1 });
    expect(restoreJobs).toHaveBeenCalledTimes(1);
    const jobs = restoreJobs.mock.calls[0]?.[0] as CronJobRecord[];
    expect(jobs.map((job) => job.id).sort()).toEqual(['job-a', 'job-b']);
  });
});
