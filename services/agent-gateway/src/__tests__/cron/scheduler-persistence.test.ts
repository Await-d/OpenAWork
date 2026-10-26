/**
 * `CronScheduler` 持久化钩子回归（不触达 DB；persistence 用 spy 注入）。
 */
import { describe, expect, it, vi } from 'vitest';
import { CronScheduler, MAX_TIMER_DELAY_MS } from '../../cron/scheduler.js';
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

  it('restoreJobs：停机期间错过的一次性任务被停用并落 failed 记录', () => {
    const persistence = makePersistence();
    const scheduler = new CronScheduler(vi.fn(), 3, 1000, 10, persistence);

    scheduler.restoreJobs([
      makeJob({ id: 'missed', schedule_kind: 'at', schedule_at: Date.now() - 60_000 }),
    ]);

    // 不再保持「已启用但永不触发」的假状态。
    expect(scheduler.getJob('missed')?.enabled).toBe(false);
    expect(persistence.upsertJob).toHaveBeenCalledTimes(1);
    const exec = persistence.executionSnapshots.at(-1);
    expect(exec?.status).toBe('failed');
    expect(exec?.error).toContain('过期');
    scheduler.stopAll();
  });

  it('restoreJobs：已发射过的一次性任务只停用，不补一条 failed', () => {
    const persistence = makePersistence();
    const scheduler = new CronScheduler(vi.fn(), 3, 1000, 10, persistence);
    const firedAt = Date.now() - 59_000;

    scheduler.restoreJobs([
      makeJob({
        id: 'done',
        schedule_kind: 'at',
        schedule_at: Date.now() - 60_000,
        last_fired_at: firedAt,
        fire_count: 1,
      }),
    ]);

    expect(scheduler.getJob('done')?.enabled).toBe(false);
    expect(persistence.recordExecution).not.toHaveBeenCalled();
    scheduler.stopAll();
  });

  it('重新启用已过期的一次性任务会记录建臂失败，而不是静默无臂', () => {
    const persistence = makePersistence();
    const scheduler = new CronScheduler(vi.fn(), 3, 1000, 10, persistence);
    const errors: string[] = [];
    scheduler.setScheduleErrorListener((_jobId, message) => errors.push(message));

    scheduler.addJob(makeJob({ schedule_kind: 'at', schedule_at: Date.now() + 60_000 }));
    scheduler.updateJob('job-1', { schedule_at: Date.now() - 1_000, enabled: true });

    expect(errors.some((message) => message.includes('已过'))).toBe(true);
    scheduler.stopAll();
  });

  it('超过 32 位上限的 at 延时分段等待，不会立刻触发', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      const handler = vi.fn(async (_job: CronJobRecord) => undefined);
      const scheduler = new CronScheduler(handler, 3, 1000, 10);
      scheduler.addJob(makeJob({ schedule_kind: 'at', schedule_at: Date.now() + 30 * 86_400_000 }));

      await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS + 1_000);
      expect(handler).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(6 * 86_400_000);
      expect(handler).toHaveBeenCalledTimes(1);
      scheduler.stopAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('下一个触发时刻超过 32 位上限的 cron 分段等待，不会立刻触发', async () => {
    // 2026-10-26 → 2027-01-01 约 67 天，直接交给 setTimeout 会被钳成 1ms。
    vi.useFakeTimers({ now: new Date('2026-10-26T00:00:00Z') });
    try {
      const handler = vi.fn(async (_job: CronJobRecord) => undefined);
      const scheduler = new CronScheduler(handler, 3, 1000, 10);
      scheduler.addJob(
        makeJob({ schedule_kind: 'cron', schedule_expr: '0 0 1 1 *', schedule_tz: 'UTC' }),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      expect(handler).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS);
      expect(handler).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(45 * 86_400_000);
      expect(handler).toHaveBeenCalledTimes(1);
      scheduler.stopAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('every 间隔超过 32 位上限时不建臂（否则会被钳成 1ms 空转）', () => {
    const scheduler = new CronScheduler(vi.fn(), 3, 1000, 10);
    const errors: string[] = [];
    scheduler.setScheduleErrorListener((_jobId, message) => errors.push(message));

    scheduler.addJob(makeJob({ schedule_kind: 'every', schedule_every: MAX_TIMER_DELAY_MS + 1 }));

    expect(errors.some((message) => message.includes('24.8'))).toBe(true);
    scheduler.stopAll();
  });

  it('定时触发被并发挡住时留一条 skipped 记录（每分钟最多一条）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      let release: (() => void) | undefined;
      const handler = vi.fn((job: CronJobRecord) =>
        job.id === 'slow'
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(),
      );
      // maxConcurrent=1：slow 占住唯一并发位，fast 的到点触发只能被跳过。
      const scheduler = new CronScheduler(handler, 1, 0, 10);
      scheduler.addJob(makeJob({ id: 'slow', schedule_kind: 'every', schedule_every: 1_000 }));
      scheduler.addJob(makeJob({ id: 'fast', schedule_kind: 'every', schedule_every: 1_000 }));

      await vi.advanceTimersByTimeAsync(1_100);
      const skipped = scheduler
        .getExecutionHistory('fast')
        .filter((entry) => entry.status === 'skipped');
      expect(skipped.length).toBeGreaterThan(0);
      expect(skipped[0]?.error).toContain('并发');

      // 一分钟内重复跳过不再落记录，避免把执行历史冲成清一色 skipped。
      await vi.advanceTimersByTimeAsync(5_000);
      expect(
        scheduler.getExecutionHistory('fast').filter((entry) => entry.status === 'skipped'),
      ).toHaveLength(skipped.length);

      release?.();
      await vi.advanceTimersByTimeAsync(0);
      scheduler.stopAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('every 间隔非法时不建臂（负数会被 setInterval 钳成 1ms 空转）', () => {
    const scheduler = new CronScheduler(vi.fn(), 3, 1000, 10);
    const errors: string[] = [];
    scheduler.setScheduleErrorListener((_jobId, message) => errors.push(message));

    scheduler.addJob(makeJob({ schedule_kind: 'every', schedule_every: -1 }));

    expect(errors.some((message) => message.includes('schedule_every'))).toBe(true);
    scheduler.stopAll();
  });

  it('updateJob 只改元数据时不重装定时器（every 的间隔起点不被重置）', async () => {
    vi.useFakeTimers();
    try {
      const handler = vi.fn(async (_job: CronJobRecord) => undefined);
      const scheduler = new CronScheduler(handler, 3, 1000, 10);
      scheduler.addJob(makeJob({ schedule_every: 1_000 }));

      await vi.advanceTimersByTimeAsync(500);
      scheduler.updateJob('job-1', { name: 'renamed' });
      await vi.advanceTimersByTimeAsync(500);

      // 若重装定时器，第二次间隔会从改名时刻重新计时，这里就一次都不会触发。
      expect(handler).toHaveBeenCalledTimes(1);
      scheduler.stopAll();
    } finally {
      vi.useRealTimers();
    }
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
