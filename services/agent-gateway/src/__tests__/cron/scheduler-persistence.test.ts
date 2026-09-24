/**
 * `CronScheduler` 持久化钩子回归（不触达 DB；persistence 用 spy 注入）。
 */
import { describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronExecutionRecord, CronJobRecord } from '../../cron/types.js';

function makeJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  const now = Date.now();
  return {
    id: 'job-1',
    user_id: 'u-1',
    name: 'demo',
    schedule_kind: 'every',
    schedule_at: null,
    schedule_every: 60_000,
    schedule_expr: null,
    schedule_tz: 'UTC',
    prompt: 'demo',
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

function makePersistence() {
  const executionSnapshots: CronExecutionRecord[] = [];
  return {
    upsertJob: vi.fn<(job: CronJobRecord) => void>(),
    deleteJob: vi.fn<(id: string) => void>(),
    recordExecution: vi.fn<(job: CronJobRecord, exec: CronExecutionRecord) => void>(
      (_job, exec) => {
        executionSnapshots.push({ ...exec });
      },
    ),
    /** recordExecution 的调用快照（exec 对象会被 fireJob 原地 mutate）。 */
    executionSnapshots,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CronScheduler · persistence 钩子', () => {
  it('add / update / remove 分别调用 upsert、upsert、delete', () => {
    const persistence = makePersistence();
    const scheduler = new CronScheduler(vi.fn(), 3, 1000, 10, persistence);

    scheduler.addJob(makeJob());
    expect(persistence.upsertJob).toHaveBeenCalledTimes(1);

    scheduler.updateJob('job-1', { enabled: false });
    expect(persistence.upsertJob).toHaveBeenCalledTimes(2);
    expect(persistence.upsertJob.mock.calls[1]?.[0]).toMatchObject({ enabled: false });

    scheduler.removeJob('job-1');
    expect(persistence.deleteJob).toHaveBeenCalledWith('job-1');
    scheduler.stopAll();
  });

  it('fire 记录 running → completed 两次执行，并回写 fire_count', async () => {
    const persistence = makePersistence();
    const handler = vi.fn(async (_job: CronJobRecord) => undefined);
    const scheduler = new CronScheduler(handler, 3, 1000, 10, persistence);

    scheduler.addJob(makeJob({ schedule_kind: 'at', schedule_at: Date.now() + 5 }));
    await sleep(40);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(persistence.recordExecution).toHaveBeenCalledTimes(2);
    const firstJob = persistence.recordExecution.mock.calls[0]?.[0] as CronJobRecord;
    const firstExec = persistence.executionSnapshots[0];
    const secondExec = persistence.executionSnapshots[1];
    expect(firstJob.id).toBe('job-1');
    expect(firstExec?.status).toBe('running');
    expect(secondExec?.id).toBe(firstExec?.id);
    expect(secondExec?.status).toBe('completed');

    const lastUpsert = persistence.upsertJob.mock.calls.at(-1)?.[0] as CronJobRecord;
    expect(lastUpsert.fire_count).toBe(1);
    expect(lastUpsert.last_fired_at).not.toBeNull();
    scheduler.stopAll();
  });

  it('失败执行记录 failed 与错误信息', async () => {
    const persistence = makePersistence();
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const scheduler = new CronScheduler(handler, 3, 1000, 10, persistence);

    scheduler.addJob(makeJob({ schedule_kind: 'at', schedule_at: Date.now() + 5 }));
    await sleep(40);

    const finalExec = persistence.recordExecution.mock.calls.at(-1)?.[1] as CronExecutionRecord;
    expect(finalExec.status).toBe('failed');
    expect(finalExec.error).toContain('boom');
    scheduler.stopAll();
  });

  it('delete_after_run 的一次性任务触发后删除持久化记录', async () => {
    const persistence = makePersistence();
    const scheduler = new CronScheduler(
      vi.fn(async (_job: CronJobRecord) => undefined),
      3,
      1000,
      10,
      persistence,
    );

    scheduler.addJob(
      makeJob({ schedule_kind: 'at', schedule_at: Date.now() + 5, delete_after_run: true }),
    );
    await sleep(40);

    expect(persistence.deleteJob).toHaveBeenCalledWith('job-1');
    expect(scheduler.getJob('job-1')).toBeUndefined();
    scheduler.stopAll();
  });

  it('restoreJobs 不回写持久化；enabled 任务继续调度、disabled 不调度', async () => {
    const persistence = makePersistence();
    const handler = vi.fn(async (_job: CronJobRecord) => undefined);
    const scheduler = new CronScheduler(handler, 3, 1000, 10, persistence);

    scheduler.restoreJobs([
      makeJob({ id: 'job-enabled', schedule_kind: 'at', schedule_at: Date.now() + 5 }),
      makeJob({
        id: 'job-disabled',
        enabled: false,
        schedule_kind: 'at',
        schedule_at: Date.now() + 5,
      }),
    ]);
    // 装载本身不回写持久化（此刻尚未触发任何 fire）。
    expect(persistence.upsertJob).not.toHaveBeenCalled();

    await sleep(40);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ id: 'job-enabled' });
    scheduler.stopAll();
  });
});
