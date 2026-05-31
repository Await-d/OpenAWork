import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function cronJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    name: 'every-minute',
    schedule_kind: 'cron',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: '* * * * *',
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

describe('CronScheduler cron reschedule resilience', () => {
  it('handler 持续 reject 时仍会继续重排下一次 cron tick（不停摆）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      throw new Error('handler boom');
    });

    const scheduler = new CronScheduler(handler);
    scheduler.addJob(cronJob());

    await vi.advanceTimersByTimeAsync(60_000);
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBeGreaterThan(afterFirst);

    scheduler.removeJob('job-1');
  });

  it('handler 成功时也持续重排', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const handler = vi.fn(async () => undefined);
    const scheduler = new CronScheduler(handler);
    scheduler.addJob(cronJob({ id: 'job-2' }));

    await vi.advanceTimersByTimeAsync(60_000);
    const first = handler.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler.mock.calls.length).toBeGreaterThan(first);
    scheduler.removeJob('job-2');
  });
});
