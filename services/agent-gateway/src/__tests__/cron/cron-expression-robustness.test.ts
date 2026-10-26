/**
 * 复查探针：坏存量数据的健壮性。
 *
 * 表达式校验是**本轮新加**的（HTTP schema 的 `.refine` 与工具层
 * `assertScheduleConsistent`）。在此之前写入的行没有任何校验，DB 里可能存在
 * `schedule_kind='cron'` 但 `schedule_expr` 是垃圾串的存量任务。
 *
 * 这些行一旦让只读派生路径（`getNextFireAt`）抛错，`GET /cron/jobs` 就会整体
 * 500、列表页直接白屏——单个坏任务拖垮整个管理面。
 */
import { describe, expect, it } from 'vitest';
import { CronScheduler } from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';

function job(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'bad-1',
    user_id: 'u1',
    name: 'bad',
    schedule_kind: 'cron',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: 'nonsense-expr',
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
    max_iterations: 10,
    last_fired_at: null,
    fire_count: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe('cron · 坏存量表达式的只读派生健壮性', () => {
  it('getNextFireAt 对无法解析的表达式不抛错（返回 null）', () => {
    const scheduler = new CronScheduler(async () => undefined, 3, 0);
    scheduler.addJob(job());
    expect(() => scheduler.getNextFireAt('bad-1')).not.toThrow();
    scheduler.stopAll();
  });

  it('getNextFireAt 对 8 年内无解的表达式不抛错（返回 null）', () => {
    const scheduler = new CronScheduler(async () => undefined, 3, 0);
    scheduler.addJob(job({ schedule_expr: '0 0 30 2 *' }));
    expect(() => scheduler.getNextFireAt('bad-1')).not.toThrow();
    scheduler.stopAll();
  });
});
