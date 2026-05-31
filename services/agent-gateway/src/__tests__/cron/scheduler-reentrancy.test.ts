/**
 * Robustness: a single `every`/`cron` cron job whose handler outruns its
 * own period must not stack copies of itself.
 *
 * `CronScheduler.fireJob` tracks a global `runningCount` against
 * `maxConcurrent`, but that cap alone does NOT stop one job from
 * double-firing: before the per-job reentrancy guard, every interval tick
 * that arrived while the prior run of the SAME job was still pending would
 * consume another concurrency slot for that job — running non-idempotent
 * work twice and starving every other job of slots.
 *
 * These tests assert that overlapping fires of the same job are dropped
 * while one is in flight, that the slot is released on settle (and on
 * throw), and that distinct jobs are unaffected.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function cronJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    name: 'every-job',
    schedule_kind: 'every',
    schedule_at: null,
    schedule_every: 1_000,
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

describe('CronScheduler 单 job 重入保护', () => {
  it('handler 慢于 interval 时不会把同一 job 叠加触发', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    const hung: { resolve: (() => void) | null } = { resolve: null };
    let callCount = 0;
    const handler = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        // First fire hangs across several interval ticks.
        return new Promise<void>((resolve) => {
          hung.resolve = resolve;
        });
      }
      return Promise.resolve();
    });

    // maxConcurrent=3 (default-ish) so the global cap is NOT what blocks the
    // overlap — only the per-job in-flight guard is. jobTimeoutMs=0 disables
    // the wall-clock deadline so the hang persists across ticks.
    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.addJob(cronJob({ id: 'slow-job', schedule_every: 1_000 }));

    // Fire #1 starts and hangs.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(1);

    // Three more ticks arrive while fire #1 is still pending — all dropped.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(handler).toHaveBeenCalledTimes(1);

    // Exactly one running execution row for this job (no stacking).
    const running = scheduler.getExecutionHistory('slow-job').filter((e) => e.status === 'running');
    expect(running).toHaveLength(1);

    // Settle the hung run, then the next tick fires normally.
    hung.resolve?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(scheduler.getExecutionHistory('slow-job').at(-1)?.status).toBe('completed');

    scheduler.removeJob('slow-job');
  });

  it('handler 抛错后释放 in-flight 槽位，下一拍可再触发', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    let callCount = 0;
    const handler = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve();
    });

    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.addJob(cronJob({ id: 'flaky-job', schedule_every: 1_000 }));

    // Fire #1 rejects; the in-flight slot must be released in finally.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(scheduler.getExecutionHistory('flaky-job').at(-1)?.status).toBe('failed');

    // Next tick fires again (slot was not wedged).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(scheduler.getExecutionHistory('flaky-job').at(-1)?.status).toBe('completed');

    scheduler.removeJob('flaky-job');
  });

  it('不同 job 之间互不影响（一个挂起不阻塞另一个）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    const hung: { resolve: (() => void) | null } = { resolve: null };
    const handler = vi.fn((job: CronJobRecord) => {
      if (job.id === 'hang-job') {
        return new Promise<void>((resolve) => {
          hung.resolve = resolve;
        });
      }
      return Promise.resolve();
    });

    // maxConcurrent=3 leaves room for both jobs concurrently.
    const scheduler = new CronScheduler(handler, 3, 0);
    scheduler.addJob(cronJob({ id: 'hang-job', schedule_every: 1_000 }));
    scheduler.addJob(cronJob({ id: 'fast-job', schedule_every: 1_000 }));

    await vi.advanceTimersByTimeAsync(1_000);
    // hang-job is in flight; fast-job still completes each tick.
    expect(scheduler.getExecutionHistory('fast-job').at(-1)?.status).toBe('completed');

    await vi.advanceTimersByTimeAsync(2_000);
    const fastCompleted = scheduler
      .getExecutionHistory('fast-job')
      .filter((e) => e.status === 'completed');
    expect(fastCompleted.length).toBeGreaterThanOrEqual(3);
    // hang-job stayed single in-flight the whole time.
    expect(
      scheduler.getExecutionHistory('hang-job').filter((e) => e.status === 'running'),
    ).toHaveLength(1);

    hung.resolve?.();
    scheduler.removeJob('hang-job');
    scheduler.removeJob('fast-job');
  });
});
