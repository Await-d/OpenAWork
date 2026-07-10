/**
 * Robustness: CronScheduler.executions is an in-memory array pushed once per
 * job fire and previously never trimmed. A frequently-firing job (e.g. `every`
 * minute) would grow it without bound for the scheduler's lifetime. The
 * history ring now caps total records, dropping oldest-first.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function cronJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    user_id: 'cron-user',
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

describe('CronScheduler 执行历史上限', () => {
  it('频繁触发时 executions 被裁剪到上限，保留最近的记录', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    const handler = vi.fn(() => Promise.resolve());
    // Tiny cap so a handful of fires exceeds it; maxConcurrent=3, cap=5.
    const scheduler = new CronScheduler(handler, 3, 0, 5);
    scheduler.addJob(cronJob({ id: 'spammy', schedule_every: 1_000 }));

    // Fire ~20 times; each completes synchronously within the tick.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(15);

    const history = scheduler.getExecutionHistory();
    // Bounded at the cap rather than growing to the fire count.
    expect(history.length).toBeLessThanOrEqual(5);
    // Retained records are the most recent (all completed, monotonic starts).
    expect(history.every((e) => e.status === 'completed')).toBe(true);
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i]!.started_at).toBeGreaterThanOrEqual(history[i - 1]!.started_at);
    }

    scheduler.removeJob('spammy');
  });

  it('executionHistoryMax<=0 时禁用裁剪（保留全部）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    const handler = vi.fn(() => Promise.resolve());
    const scheduler = new CronScheduler(handler, 3, 0, 0);
    scheduler.addJob(cronJob({ id: 'unbounded', schedule_every: 1_000 }));

    await vi.advanceTimersByTimeAsync(10_000);
    const history = scheduler.getExecutionHistory();
    // No trimming: one record per fire.
    expect(history.length).toBe(handler.mock.calls.length);
    expect(history.length).toBeGreaterThanOrEqual(8);

    scheduler.removeJob('unbounded');
  });
});
