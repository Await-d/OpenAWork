/**
 * Robustness: a hung cron handler must not permanently leak its
 * concurrency slot.
 *
 * `CronScheduler` tracks a global `runningCount` against `maxConcurrent`
 * and `fireJob` early-returns once the cap is reached. Before the
 * wall-clock guard, a handler that connects to an upstream but never
 * settles would hold its slot forever; after `maxConcurrent` such hangs,
 * every future fire would silently no-op and the whole cron subsystem
 * would stall with no error surfaced.
 *
 * These tests assert that `runHandlerWithTimeout` bounds each invocation,
 * records the timed-out run as `failed`, reclaims the slot, and that a
 * non-positive `jobTimeoutMs` disables the deadline.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function cronJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
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
  it('handler 挂起超过 jobTimeoutMs 时标记 failed 并释放并发槽位', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    const hung: { resolve: (() => void) | null } = { resolve: null };
    let callCount = 0;
    const handler = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        // First fire hangs forever (until we manually settle it later).
        return new Promise<void>((resolve) => {
          hung.resolve = resolve;
        });
      }
      return Promise.resolve();
    });

    // maxConcurrent=1 makes slot exhaustion observable: if the hung slot
    // is never reclaimed, the second fire would be dropped.
    const scheduler = new CronScheduler(handler, 1, 5_000);

    const start = Date.now();
    scheduler.addJob(cronJob({ id: 'hang-job', schedule_at: start + 1_000 }));

    // Fire the first (hanging) job.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(1);
    let history = scheduler.getExecutionHistory('hang-job');
    expect(history.at(-1)?.status).toBe('running');

    // Cross the 5s deadline: the hung run is aborted + recorded failed.
    await vi.advanceTimersByTimeAsync(5_000);
    history = scheduler.getExecutionHistory('hang-job');
    const failed = history.at(-1);
    expect(failed?.status).toBe('failed');
    expect(failed?.error ?? '').toContain('timed out after 5000ms');

    // Slot reclaimed: a fresh job now fires successfully under maxConcurrent=1.
    scheduler.addJob(cronJob({ id: 'next-job', schedule_at: Date.now() + 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handler).toHaveBeenCalledTimes(2);
    const nextHistory = scheduler.getExecutionHistory('next-job');
    expect(nextHistory.at(-1)?.status).toBe('completed');

    // Settle the originally-hung promise to avoid a dangling pending promise.
    hung.resolve?.();
    scheduler.removeJob('hang-job');
    scheduler.removeJob('next-job');
  });

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
