/**
 * 定时任务视图派生回归（Web `/schedules` 页与工具输出的共同数据源）。
 *
 * 重点是 `status` 的**语义约束**：它只表达启停态。`shared-ui` 的 `CronManager`
 * 在 `status === 'running'` 时会隐藏「启用 / 禁用」按钮并禁用「立即运行」
 * （`CronManager.tsx` 245 / 263 / 284 行），因此把「运行中」写进 `status`
 * 会让一个长任务（单次上限 10 分钟）在跑的过程中**无法被停用**。
 * 运行中信息由独立字段 `running` 承载。
 */
import { describe, expect, it } from 'vitest';
import {
  formatScheduleDisplay,
  resolveCronJobStatus,
  toCronJobView,
} from '../../cron/schedule-display.js';
import type { CronJobRecord } from '../../cron/types.js';

function job(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    user_id: 'u1',
    name: 'job',
    schedule_kind: 'cron',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: '0 9 * * *',
    schedule_tz: 'Asia/Shanghai',
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

describe('cron schedule-display · 调度描述', () => {
  it('cron 带时区、every 归一到人类单位、at 落本地时间', () => {
    expect(formatScheduleDisplay(job())).toBe('0 9 * * *（Asia/Shanghai）');
    expect(formatScheduleDisplay(job({ schedule_kind: 'every', schedule_every: 3_600_000 }))).toBe(
      '每 1 小时',
    );
    expect(formatScheduleDisplay(job({ schedule_kind: 'every', schedule_every: 120_000 }))).toBe(
      '每 2 分钟',
    );
    // 只按「能整除」降档：90s 不能被 60s 整除，故落到秒级而不是「1.5 分钟」。
    expect(formatScheduleDisplay(job({ schedule_kind: 'every', schedule_every: 90_000 }))).toBe(
      '每 90 秒',
    );
    expect(formatScheduleDisplay(job({ schedule_kind: 'every', schedule_every: 1500 }))).toBe(
      '每 1500 毫秒',
    );
    expect(formatScheduleDisplay(job({ schedule_kind: 'every', schedule_every: 86_400_000 }))).toBe(
      '每 1 天',
    );
    expect(formatScheduleDisplay(job({ schedule_kind: 'at', schedule_at: 0 }))).not.toBe('—');
  });

  it('字段缺失时退化为占位符而非抛错', () => {
    expect(formatScheduleDisplay(job({ schedule_kind: 'cron', schedule_expr: null }))).toBe('—');
    expect(formatScheduleDisplay(job({ schedule_kind: 'every', schedule_every: null }))).toBe('—');
    expect(formatScheduleDisplay(job({ schedule_kind: 'at', schedule_at: null }))).toBe('—');
  });
});

describe('cron schedule-display · 状态语义', () => {
  it('status 只随 enabled 变化，运行中同时成立时为 enabled', () => {
    expect(resolveCronJobStatus(job({ enabled: true }))).toBe('enabled');
    expect(resolveCronJobStatus(job({ enabled: false }))).toBe('disabled');

    const running = toCronJobView(job({ enabled: true }), {
      nextFireAt: 1,
      running: true,
    });
    expect(running.status).toBe('enabled');
    expect(running.running).toBe(true);

    // 停用中的任务即使在途：status 仍是 disabled（界面要显示「启用」按钮）。
    const disabledRunning = toCronJobView(job({ enabled: false }), {
      nextFireAt: null,
      running: true,
    });
    expect(disabledRunning.status).toBe('disabled');
    expect(disabledRunning.running).toBe(true);
  });

  it('视图保留原始字段并补驼峰别名', () => {
    const view = toCronJobView(
      job({ fire_count: 3, last_fired_at: 123, schedule_kind: 'every', schedule_every: 60_000 }),
      {
        nextFireAt: 456,
      },
    );
    expect(view).toMatchObject({
      id: 'job-1',
      schedule_kind: 'every',
      scheduleKind: 'every',
      fire_count: 3,
      fireCount: 3,
      last_fired_at: 123,
      lastFiredAt: 123,
      nextFireAt: 456,
      running: false,
    });
  });
});
