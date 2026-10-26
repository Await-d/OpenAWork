/**
 * 调度器回归：`fire_count` 单调递增 / 重排令牌 / 立即运行 / 下次触发派生。
 *
 * `setInterval` 的闭包持有建臂时的任务快照，旧实现用该快照算
 * `fire_count: job.fire_count + 1`，于是 `every` 任务的计数永远停在 1
 * （界面「运行次数」与 API 都不对）。同理，`cron` 分支的重排是从上一次 fire
 * 的 `.then` 里发起的，只 `clearTimeout` 挡不住它，改 / 删 / 停用后定时器会重新
 * 装上（任务「改不掉」）。这两条都在这里锁定。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function job(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    user_id: 'u1',
    name: 'job',
    schedule_kind: 'every',
    schedule_at: null,
    schedule_every: 1_000,
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CronScheduler · fire_count', () => {
  it('every 任务每次触发都递增（不再卡在 1）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const scheduler = new CronScheduler(
      vi.fn(async () => undefined),
      3,
      0,
    );
    scheduler.addJob(job());

    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.getJob('job-1')?.fire_count).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.getJob('job-1')?.fire_count).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.getJob('job-1')?.fire_count).toBe(3);

    scheduler.removeJob('job-1');
  });

  it('已删除 / 已停用的任务到点不再执行', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const handler = vi.fn(async () => undefined);
    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.addJob(job());

    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(1);

    scheduler.updateJob('job-1', { enabled: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(handler).toHaveBeenCalledTimes(1);

    scheduler.removeJob('job-1');
  });
});

describe('CronScheduler · cron 重排令牌', () => {
  it('cron 任务被删除后，在途的重排不再把定时器装回来', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const handler = vi.fn(async () => undefined);
    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.addJob(
      job({
        id: 'cron-1',
        schedule_kind: 'cron',
        schedule_every: null,
        schedule_expr: '* * * * *',
      }),
    );

    // 第一拍触发，续臂在同一次微任务链里发起。
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledTimes(1);

    // 删除发生在续臂之后：旧闭包不得再触发。
    scheduler.removeJob('cron-1');
    await vi.advanceTimersByTimeAsync(180_000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(scheduler.getJob('cron-1')).toBeUndefined();
  });

  it('改表达式后按新表达式计时', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const handler = vi.fn(async () => undefined);
    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.addJob(
      job({
        id: 'cron-2',
        schedule_kind: 'cron',
        schedule_every: null,
        schedule_expr: '* * * * *',
      }),
    );

    // 改成每小时触发；随后 5 分钟内不应再触发。
    scheduler.updateJob('cron-2', { schedule_expr: '0 * * * *' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(handler).not.toHaveBeenCalled();

    scheduler.removeJob('cron-2');
  });

  it('非法表达式不建臂，并通过回调上报', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const handler = vi.fn(async () => undefined);
    const errors: string[] = [];
    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.setScheduleErrorListener((id, message) => errors.push(`${id}:${message}`));
    scheduler.addJob(
      job({ id: 'bad', schedule_kind: 'cron', schedule_every: null, schedule_expr: '0 0 30 2 *' }),
    );

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('bad:');

    scheduler.removeJob('bad');
  });
});

describe('CronScheduler · 立即运行与下次触发派生', () => {
  it('runJobNow 走同一条 handler / 历史路径', async () => {
    const handler = vi.fn(async () => undefined);
    const scheduler = new CronScheduler(handler, 3, 0);
    // 用一个远期 cron 表达式，确保不会有定时触发干扰断言。
    scheduler.addJob(
      job({
        id: 'manual',
        schedule_kind: 'at',
        schedule_every: null,
        schedule_at: Date.now() + 86_400_000,
      }),
    );

    expect(await scheduler.runJobNow('manual')).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(scheduler.getJob('manual')?.fire_count).toBe(1);
    expect(scheduler.getExecutionHistory('manual').at(-1)?.status).toBe('completed');

    expect(await scheduler.runJobNow('missing')).toBe(false);
    scheduler.removeJob('manual');
  });

  it('getNextFireAt 对 every / cron / at 均给出未来时刻', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const scheduler = new CronScheduler(
      vi.fn(async () => undefined),
      3,
      0,
    );
    const now = Date.now();

    scheduler.addJob(job({ id: 'e', created_at: now, schedule_every: 60_000 }));
    expect(scheduler.getNextFireAt('e')).toBe(now + 60_000);

    scheduler.addJob(
      job({ id: 'c', schedule_kind: 'cron', schedule_every: null, schedule_expr: '0 9 * * *' }),
    );
    expect(scheduler.getNextFireAt('c')).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));

    scheduler.addJob(
      job({ id: 'a', schedule_kind: 'at', schedule_every: null, schedule_at: now + 5_000 }),
    );
    expect(scheduler.getNextFireAt('a')).toBe(now + 5_000);

    // 停用后不再有下次触发。
    scheduler.updateJob('e', { enabled: false });
    expect(scheduler.getNextFireAt('e')).toBeNull();

    scheduler.stopAll();
  });
});

describe('cron scheduler · 执行现场可追溯', () => {
  it('handler 上报的执行会话 id 会写进执行历史', async () => {
    // 回归：`cron_job_executions.session_id` 列一直存在，但 `fireJob` 从不写入，
    // 于是 `delivery_mode: 'none'` 的任务跑完后用户没有任何指针找到产出。
    const scheduler = new CronScheduler(
      async (_job, context) => {
        context?.reportSession('exec-session-1');
      },
      3,
      0,
    );
    scheduler.addJob(
      job({ id: 'trace-1', schedule_every: null, schedule_kind: 'at', schedule_at: 0 }),
    );
    // at + schedule_at=0 不会建臂，但 runJobNow 仍可手动触发。
    await scheduler.runJobNow('trace-1');

    const history = scheduler.getExecutionHistory('trace-1');
    expect(history).toHaveLength(1);
    expect(history[0]?.session_id).toBe('exec-session-1');
    scheduler.stopAll();
  });

  it('执行失败时也保留已上报的会话 id（失败也要能看现场）', async () => {
    const scheduler = new CronScheduler(
      async (_job, context) => {
        context?.reportSession('exec-session-2');
        throw new Error('boom');
      },
      3,
      0,
    );
    scheduler.addJob(
      job({ id: 'trace-2', schedule_every: null, schedule_kind: 'at', schedule_at: 0 }),
    );
    await scheduler.runJobNow('trace-2');

    const history = scheduler.getExecutionHistory('trace-2');
    expect(history[0]).toMatchObject({ status: 'failed', session_id: 'exec-session-2' });
    scheduler.stopAll();
  });
});
