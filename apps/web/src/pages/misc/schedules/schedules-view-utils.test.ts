import { describe, expect, it } from 'vitest';
import type { CronJobRecord } from '@openAwork/web-client';
import {
  bucketOf,
  describeExecutionStatus,
  formatClock,
  formatRelativeToNow,
  formatScheduleText,
  groupByDay,
  localDayDiff,
  startOfLocalDay,
  summarize,
  trackMarkRatio,
} from './schedules-view-utils.js';
import { formatTimestamp } from '../../../components/schedules/schedule-form-utils.js';

/** 固定「现在」：2026-11-02 14:20 **本地时区**（避免用 UTC 字符串造成时区漂移）。 */
const NOW = new Date(2026, 10, 2, 14, 20).getTime();

function ms(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function job(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-a',
    name: '每日同步',
    schedule_kind: 'cron',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: '0 9 * * *',
    schedule_tz: 'Asia/Shanghai',
    prompt: '同步',
    enabled: true,
    delete_after_run: false,
    delivery_mode: 'desktop',
    delivery_target: null,
    last_fired_at: null,
    fire_count: 0,
    scheduleKind: 'cron',
    scheduleDisplay: '每天 9 点',
    status: 'enabled',
    running: false,
    fireCount: 0,
    lastFiredAt: null,
    nextFireAt: null,
    lastExecution: null,
    ...overrides,
  };
}

describe('时间换算', () => {
  it('startOfLocalDay 取本地当天 00:00，localDayDiff 只看本地日历日', () => {
    expect(startOfLocalDay(NOW)).toBe(ms(2026, 11, 2, 0));
    expect(localDayDiff(ms(2026, 11, 2, 23, 59), NOW)).toBe(0);
    expect(localDayDiff(ms(2026, 11, 3, 9), NOW)).toBe(1);
    expect(localDayDiff(ms(2026, 11, 1, 9), NOW)).toBe(-1);
  });

  it('formatClock 输出本地 HH:mm，trackMarkRatio 落在 0–1', () => {
    expect(formatClock(ms(2026, 11, 2, 9, 5))).toBe('09:05');
    expect(formatClock(ms(2026, 11, 2, 23, 30))).toBe('23:30');
    expect(trackMarkRatio(ms(2026, 11, 2, 0))).toBe(0);
    expect(trackMarkRatio(ms(2026, 11, 2, 12))).toBeCloseTo(0.5, 5);
  });

  it('formatRelativeToNow 覆盖不足 1 分钟 / 分钟 / 小时 / 天 / 未排期', () => {
    expect(formatRelativeToNow(null, NOW)).toBe('已停用');
    expect(formatRelativeToNow(NOW + 30_000, NOW)).toBe('不到 1 分钟后');
    expect(formatRelativeToNow(NOW + 10 * 60_000, NOW)).toBe('10 分钟后');
    expect(formatRelativeToNow(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前');
    expect(formatRelativeToNow(NOW + 2 * 86_400_000, NOW)).toBe('2 天后');
  });
});

describe('formatScheduleText', () => {
  it('单次任务用客户端本地时区渲染，不用网关的进程时区文案', () => {
    const at = ms(2026, 11, 3, 10, 30);
    expect(
      formatScheduleText(job({ schedule_kind: 'at', schedule_at: at, scheduleDisplay: '明天' })),
    ).toBe(formatTimestamp(at));
  });

  it('cron / every 沿用网关派生文案，单次任务缺 schedule_at 时也回落', () => {
    expect(formatScheduleText(job({ scheduleDisplay: '每天 9 点' }))).toBe('每天 9 点');
    expect(
      formatScheduleText(
        job({ schedule_kind: 'at', schedule_at: null, scheduleDisplay: '已过期' }),
      ),
    ).toBe('已过期');
  });
});

describe('describeExecutionStatus', () => {
  it('跳过与过期都是灰色语义，不落成成功或运行中', () => {
    expect(describeExecutionStatus('skipped')).toEqual({ label: '跳过', tone: 'muted' });
    expect(describeExecutionStatus('expired')).toEqual({ label: '已过期', tone: 'muted' });
    expect(describeExecutionStatus('completed').tone).toBe('success');
    expect(describeExecutionStatus('failed').tone).toBe('danger');
    expect(describeExecutionStatus('running').tone).toBe('running');
  });
});

describe('分组与概览', () => {
  it('bucketOf 区分今天 / 明天 / 本周稍后 / 更晚 / 未排期', () => {
    expect(bucketOf(job({ nextFireAt: ms(2026, 11, 2, 23, 30) }), NOW)).toBe('today');
    expect(bucketOf(job({ nextFireAt: ms(2026, 11, 3, 9) }), NOW)).toBe('tomorrow');
    expect(bucketOf(job({ nextFireAt: ms(2026, 11, 5, 9) }), NOW)).toBe('week');
    expect(bucketOf(job({ nextFireAt: ms(2026, 11, 20, 9) }), NOW)).toBe('later');
    expect(bucketOf(job({ status: 'disabled', nextFireAt: null }), NOW)).toBe('unscheduled');
    // 已停用即使残留 nextFireAt 也不应被当作已排期。
    expect(bucketOf(job({ status: 'disabled', nextFireAt: ms(2026, 11, 3, 9) }), NOW)).toBe(
      'unscheduled',
    );
  });

  it('groupByDay 按桶顺序返回、组内按时间升序、空桶不返回', () => {
    const groups = groupByDay(
      [
        job({ id: 'later', name: '更晚的', nextFireAt: ms(2026, 11, 20, 9) }),
        job({ id: 'today-late', name: '今晚', nextFireAt: ms(2026, 11, 2, 23, 30) }),
        job({ id: 'today-soon', name: '马上', nextFireAt: ms(2026, 11, 2, 14, 30) }),
        job({ id: 'off', name: '已停用', status: 'disabled', nextFireAt: null }),
      ],
      NOW,
    );
    expect(groups.map((group) => group.bucket)).toEqual(['today', 'later', 'unscheduled']);
    expect(groups[0]?.jobs.map((item) => item.id)).toEqual(['today-soon', 'today-late']);
    expect(groups[1]?.jobs.map((item) => item.id)).toEqual(['later']);
    expect(groups[2]?.jobs.map((item) => item.id)).toEqual(['off']);
  });

  it('summarize 统计概览并只把 failed 计入失败列表', () => {
    const stats = summarize(
      [
        job({
          id: 'run',
          name: '巡检',
          running: true,
          nextFireAt: ms(2026, 11, 2, 14, 30),
        }),
        job({ id: 'tomorrow', name: '明日', nextFireAt: ms(2026, 11, 3, 9) }),
        job({ id: 'at', name: '一次性', schedule_kind: 'at', nextFireAt: ms(2026, 11, 3, 10, 30) }),
        job({
          id: 'fail',
          name: '周报',
          nextFireAt: null,
          lastFiredAt: ms(2026, 11, 2, 10),
          lastExecution: {
            id: 'exec-1',
            job_id: 'fail',
            status: 'failed',
            started_at: ms(2026, 11, 2, 10),
            finished_at: ms(2026, 11, 2, 10, 2),
            error: '模型调用超时',
          },
        }),
        job({
          id: 'skipped',
          name: '备份',
          status: 'disabled',
          nextFireAt: null,
          lastExecution: {
            id: 'exec-2',
            job_id: 'skipped',
            status: 'skipped',
            started_at: ms(2026, 11, 1, 0),
            finished_at: null,
          },
        }),
      ],
      NOW,
    );

    expect(stats.total).toBe(5);
    expect(stats.enabled).toBe(4);
    expect(stats.running).toBe(1);
    expect(stats.singleShot).toBe(1);
    expect(stats.todayUpcoming).toBe(1);
    expect(stats.nextToday).toEqual({
      id: 'run',
      name: '巡检',
      nextFireAt: ms(2026, 11, 2, 14, 30),
    });
    // skipped 不是失败：不进告警条。
    expect(stats.failures).toEqual([
      { id: 'fail', name: '周报', lastFiredAt: ms(2026, 11, 2, 10), error: '模型调用超时' },
    ]);
  });

  it('summarize 在没有任何待执行任务时 nextToday 为 null', () => {
    const stats = summarize([job({ nextFireAt: ms(2026, 11, 3, 9) })], NOW);
    expect(stats.todayUpcoming).toBe(0);
    expect(stats.nextToday).toBeNull();
    expect(stats.failures).toEqual([]);
  });
});
