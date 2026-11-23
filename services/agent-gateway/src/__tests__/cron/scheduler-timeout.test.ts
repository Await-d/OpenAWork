/** 超时报告不等于实际取消：底层 handler 结束前必须保留并发与同任务隔离。 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function cronJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    user_id: 'cron-user',
    name: 'one-shot',
    schedule_kind: 'at',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: null,
    schedule_tz: 'UTC',
    prompt: 'do something',
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

describe('CronScheduler handler 墙钟超时', () => {
  it.each(['resolve', 'reject'] as const)(
    'handler 超时后保留隔离，实际 %s 后释放并发槽位',
    async (settlement) => {
      vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

      const hung: { settle: (() => void) | null } = { settle: null };
      let callCount = 0;
      const handler = vi.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise<void>((resolve, reject) => {
            hung.settle = () =>
              settlement === 'resolve' ? resolve() : reject(new Error('late failure'));
          });
        }
        return Promise.resolve();
      });
      const scheduler = new CronScheduler(handler, 1, 5_000);

      const start = Date.now();
      scheduler.addJob(cronJob({ id: 'hang-job', schedule_at: start + 1_000 }));

      // Fire the first (hanging) job.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(handler).toHaveBeenCalledTimes(1);
      let history = scheduler.getExecutionHistory('hang-job');
      expect(history.at(-1)?.status).toBe('running');

      // The deadline reports failure without cancelling the underlying handler.
      await vi.advanceTimersByTimeAsync(5_000);
      history = scheduler.getExecutionHistory('hang-job');
      const failed = history.at(-1);
      expect(failed?.status).toBe('failed');
      expect(failed?.error ?? '').toContain('timed out after 5000ms');

      expect(scheduler.startJobNow('hang-job')).toEqual({ started: false, reason: 'in-flight' });
      scheduler.addJob(cronJob({ id: 'next-job', schedule_at: Date.now() + 1_000 }));
      expect(scheduler.startJobNow('next-job')).toEqual({ started: false, reason: 'busy' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(scheduler.getExecutionHistory('next-job').at(-1)?.status).toBe('skipped');

      hung.settle?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(failed?.status).toBe('failed');
      expect(failed?.error).toContain('timed out after 5000ms');
      expect(await scheduler.runJobNow('next-job')).toMatchObject({ started: true });
      expect(await scheduler.runJobNow('hang-job')).toMatchObject({ started: true });
      expect(handler).toHaveBeenCalledTimes(3);
      scheduler.stopAll();
    },
  );

  it.each([0, 5_000])(
    'stopAll/restoreJobs 不绕过仍在运行的 handler（timeout=%s）',
    async (timeout) => {
      vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
      const hung: { resolve: (() => void) | null } = { resolve: null };
      const handler = vi.fn(() => {
        if (handler.mock.calls.length === 1) {
          return new Promise<void>((resolve) => {
            hung.resolve = resolve;
          });
        }
        return Promise.resolve();
      });
      const scheduler = new CronScheduler(handler, 3, timeout);
      scheduler.addJob(cronJob({ enabled: false }));
      expect(scheduler.startJobNow('job-1')).toMatchObject({ started: true });
      await vi.advanceTimersByTimeAsync(6_000);
      scheduler.stopAll();
      scheduler.restoreJobs(scheduler.listJobs());
      expect(scheduler.startJobNow('job-1')).toEqual({ started: false, reason: 'in-flight' });
      expect(handler).toHaveBeenCalledTimes(1);
      hung.resolve?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(await scheduler.runJobNow('job-1')).toMatchObject({ started: true });
      scheduler.stopAll();
    },
  );

  it.each(['sync-throw', 'then-throw', 'double-settle'] as const)(
    '%s 不泄漏或重复释放并发占位',
    async (behavior) => {
      const hung: { resolve: (() => void) | null } = { resolve: null };
      let calls = 0;
      const scheduler = new CronScheduler(
        () => {
          calls++;
          if (calls === 1) {
            if (behavior === 'sync-throw') throw new Error('sync failure');
            return {
              then(resolve: () => void) {
                if (behavior === 'then-throw') throw new Error('then failure');
                resolve();
                resolve();
                throw new Error('failure after settlement');
              },
            } as unknown as Promise<void>;
          }
          return new Promise<void>((resolve) => {
            hung.resolve = resolve;
          });
        },
        1,
        0,
      );
      scheduler.addJob(cronJob({ id: 'first', enabled: false }));
      scheduler.addJob(cronJob({ id: 'second', enabled: false }));
      scheduler.addJob(cronJob({ id: 'third', enabled: false }));
      await scheduler.runJobNow('first');
      expect(scheduler.getExecutionHistory('first').at(-1)?.status).toBe(
        behavior === 'double-settle' ? 'completed' : 'failed',
      );
      expect(scheduler.startJobNow('second')).toMatchObject({ started: true });
      expect(scheduler.startJobNow('third')).toEqual({ started: false, reason: 'busy' });
      hung.resolve?.();
      await Promise.resolve();
      await Promise.resolve();
      scheduler.stopAll();
    },
  );

  it.each([0, 5_000])(
    '拒绝值 toString 抛错仍收敛 failed 并释放槽位（timeout=%s）',
    async (timeout) => {
      vi.useFakeTimers();
      const rejection = {
        toString() {
          throw new Error('cannot stringify rejection');
        },
      };
      const handler = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(rejection)
        .mockResolvedValue(undefined);
      const scheduler = new CronScheduler(handler, 1, timeout);
      scheduler.addJob(cronJob({ enabled: false }));
      const completion = vi.fn();
      const failure = vi.fn();
      const run = scheduler.runJobNow('job-1').then(completion, failure);
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).not.toHaveBeenCalled();
      expect(completion).toHaveBeenCalledOnce();
      await run;
      expect(scheduler.getExecutionHistory('job-1').at(-1)).toMatchObject({
        status: 'failed',
        error: 'Cron job handler failed with a non-Error rejection',
      });
      expect(await scheduler.runJobNow('job-1')).toMatchObject({ started: true });
      scheduler.stopAll();
    },
  );

  it('jobTimeoutMs 非正数时禁用墙钟超时（挂起保持 running）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    const hung: { resolve: (() => void) | null } = { resolve: null };
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          hung.resolve = resolve;
        }),
    );

    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.addJob(cronJob({ id: 'no-timeout-job', schedule_at: Date.now() + 1_000 }));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(1);

    // Advance well beyond the default deadline; with jobTimeoutMs=0 the run
    // is never force-failed and stays 'running'.
    await vi.advanceTimersByTimeAsync(600_000 + 60_000);
    const history = scheduler.getExecutionHistory('no-timeout-job');
    expect(history.at(-1)?.status).toBe('running');

    hung.resolve?.();
    scheduler.removeJob('no-timeout-job');
  });
});
