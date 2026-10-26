/**
 * 调度器错误韧性回归。
 *
 * 核心不变量：**持久化失败不得破坏调度状态机**。
 *
 * `fireJob` 在进入 `try` 之前就会递增 `runningCount`、登记 `inFlightJobs`。若那两行
 * 之后的持久化调用（`recordExecution` / `upsertJob`）抛错且未被接住，`finally` 永远
 * 不会执行 → 该 job 此后每次触发都被 `inFlightJobs.has(jobId)` 拦掉（永久静默停摆），
 * 且每泄漏一次就永久占掉一个并发位，累计到 `maxConcurrent` 后**整个调度器停摆**。
 *
 * 同理，外部注入的监听器（`scheduleErrorListener` / `persistenceErrorListener`）
 * 自身抛错也不能扩散——路由层的 listener 会写 DB，DB 故障时它就会抛。
 */
import { describe, expect, it, vi } from 'vitest';
import { CronScheduler, type CronSchedulerPersistence } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function job(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    user_id: 'u1',
    name: 'job',
    schedule_kind: 'every',
    schedule_at: null,
    schedule_every: 60_000,
    schedule_expr: null,
    schedule_tz: 'UTC',
    prompt: 'p',
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
    max_iterations: 1,
    last_fired_at: null,
    fire_count: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

/**
 * 持久化桩：**首次** `upsertJob` 成功（对应 `addJob`，那是用户操作路径，失败应当
 * 冒泡让用户知道没存上），之后的调用全部抛错（对应调度自动触发路径）。
 */
function failAfterFirstUpsert(): CronSchedulerPersistence {
  const boom = (): never => {
    throw new Error('SQLITE_BUSY: database is locked');
  };
  let upsertCalls = 0;
  return {
    upsertJob: () => {
      upsertCalls += 1;
      if (upsertCalls > 1) boom();
    },
    deleteJob: boom,
    recordExecution: boom,
  };
}

describe('cron scheduler · 持久化故障韧性', () => {
  it('触发期的 recordExecution / upsertJob 全抛错时，任务仍能执行且不泄漏并发位', async () => {
    const handler = vi.fn(async () => undefined);
    const scheduler = new CronScheduler(handler, 1, 0, undefined, failAfterFirstUpsert());
    scheduler.addJob(job());

    // maxConcurrent=1：若第一次 fire 泄漏了 runningCount，第二次会被直接丢弃。
    await expect(scheduler.runJobNow('job-1')).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    // 再次触发必须仍能执行（证明 inFlightJobs / runningCount 都已释放）。
    await expect(scheduler.runJobNow('job-1')).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);

    // 执行历史仍在内存里（只是没落库），且状态正确。
    const history = scheduler.getExecutionHistory('job-1');
    expect(history).toHaveLength(2);
    expect(history.every((entry) => entry.status === 'completed')).toBe(true);
    scheduler.stopAll();
  });

  it('持久化失败会通知监听器，且监听器自身抛错不外泄', async () => {
    const labels: string[] = [];
    const handler = vi.fn(async () => undefined);
    const scheduler = new CronScheduler(handler, 1, 0, undefined, failAfterFirstUpsert());
    scheduler.setPersistenceErrorListener((label) => {
      labels.push(label);
      // 模拟「监听器自己也炸」（例如它内部写 DB 失败）。
      throw new Error('listener exploded');
    });
    scheduler.addJob(job());

    await expect(scheduler.runJobNow('job-1')).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(labels.length).toBeGreaterThan(0);
    scheduler.stopAll();
  });

  it('用户操作路径（addJob）的持久化失败仍然冒泡，不静默吞掉', () => {
    // 这是刻意的**不对称**：调度自动触发丢一条历史可接受，但用户点「新建任务」
    // 时若没存上必须立刻知道，否则界面上有、重启后消失。
    const boom = (): never => {
      throw new Error('SQLITE_BUSY: database is locked');
    };
    const scheduler = new CronScheduler(async () => undefined, 3, 0, undefined, {
      upsertJob: boom,
      deleteJob: boom,
      recordExecution: boom,
    });
    expect(() => scheduler.addJob(job())).toThrow(/SQLITE_BUSY/);
  });

  it('removeJob 落库失败时任务仍在内存与调度中（不会「假删除后重启复活」）', () => {
    let deleteShouldFail = false;
    const scheduler = new CronScheduler(async () => undefined, 3, 0, undefined, {
      upsertJob: () => undefined,
      deleteJob: () => {
        if (deleteShouldFail) throw new Error('SQLITE_BUSY: database is locked');
      },
      recordExecution: () => undefined,
    });
    scheduler.addJob(job());

    deleteShouldFail = true;
    expect(() => scheduler.removeJob('job-1')).toThrow(/SQLITE_BUSY/);
    // 内存与调度器必须保持一致：任务还在，用户重试删除即可；
    // 若这里已被删掉，DB 里却还在，重启后任务就「复活」了。
    expect(scheduler.getJob('job-1')).toBeDefined();

    deleteShouldFail = false;
    expect(() => scheduler.removeJob('job-1')).not.toThrow();
    expect(scheduler.getJob('job-1')).toBeUndefined();
    scheduler.stopAll();
  });

  it('建臂失败的监听器抛错不会从 addJob 逃出（否则启动装载会被一条坏任务拖垮）', () => {
    const scheduler = new CronScheduler(async () => undefined, 3, 0);
    scheduler.setScheduleErrorListener(() => {
      throw new Error('audit write failed');
    });

    // 表达式非法 → 建臂失败 → 调 listener；listener 抛错必须被吞掉。
    expect(() =>
      scheduler.addJob(job({ schedule_kind: 'cron', schedule_expr: 'bad expr' })),
    ).not.toThrow();
    scheduler.stopAll();
  });
});
