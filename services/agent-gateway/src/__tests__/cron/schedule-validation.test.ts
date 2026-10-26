/**
 * 定时任务写入期校验回归。
 *
 * 背景：HTTP 路由此前只有 Zod 的类型检查，能建出「字段齐全但永不触发」的任务
 * （`cron` 无表达式、`at` 无时间、`every` 无间隔），任务落库后 `scheduleJob`
 * 直接 return，界面却显示「已启用」。时区拼写错误更隐蔽：解析器静默回落 UTC，
 * 任务按错误时间跑且无任何提示。
 */
import { describe, expect, it } from 'vitest';
import { MAX_TIMER_DELAY_MS } from '../../cron/scheduler.js';
import {
  collectScheduleIssues,
  MIN_SCHEDULE_EVERY_MS,
  type ScheduleValidationInput,
} from '../../cron/schedule-validation.js';

function base(overrides: Partial<ScheduleValidationInput> = {}): ScheduleValidationInput {
  return {
    scheduleKind: 'cron',
    scheduleAt: null,
    scheduleEvery: null,
    scheduleExpr: '0 9 * * *',
    scheduleTimeZone: 'Asia/Shanghai',
    deliveryMode: 'desktop',
    deliveryTarget: null,
    sessionId: null,
    ...overrides,
  };
}

describe('schedule-validation', () => {
  it('合法的 cron 配置没有问题', () => {
    expect(collectScheduleIssues(base())).toEqual([]);
  });

  it('cron 缺表达式 / 表达式非法都被拒绝', () => {
    expect(collectScheduleIssues(base({ scheduleExpr: null }))).toHaveLength(1);
    expect(collectScheduleIssues(base({ scheduleExpr: '' }))).toHaveLength(1);
    expect(collectScheduleIssues(base({ scheduleExpr: '99 99 * * *' }))[0]).toContain('不是合法');
  });

  it('时区名拼错被拒绝（否则会静默按 UTC 跑）', () => {
    const issues = collectScheduleIssues(base({ scheduleTimeZone: 'Asia/Shangai' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('IANA');
  });

  it('显式空时区被拒绝（运行期会被当成 UTC）', () => {
    const issues = collectScheduleIssues(base({ scheduleTimeZone: '' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('必须提供时区');
  });

  it('语法合法但永不触发的表达式被拒绝', () => {
    const issues = collectScheduleIssues(base({ scheduleExpr: '0 0 30 2 *' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('不会触发');
  });

  it('at 缺时间 / 时间已过都被拒绝', () => {
    expect(
      collectScheduleIssues(
        base({ scheduleKind: 'at', scheduleExpr: null, scheduleAt: null, scheduleTimeZone: 'UTC' }),
      ),
    ).toHaveLength(1);
    const past = collectScheduleIssues(
      base({
        scheduleKind: 'at',
        scheduleExpr: null,
        scheduleAt: Date.now() - 1_000,
        scheduleTimeZone: 'UTC',
      }),
    );
    expect(past[0]).toContain('未来时间');
  });

  it('allowExpiredAt 放行过期的一次性任务（供 PATCH 改名 / 停用）', () => {
    expect(
      collectScheduleIssues(
        base({
          scheduleKind: 'at',
          scheduleExpr: null,
          scheduleAt: Date.now() - 1_000,
          scheduleTimeZone: 'UTC',
          allowExpiredAt: true,
        }),
      ),
    ).toEqual([]);
  });

  it('every 的间隔不得低于下限', () => {
    expect(
      collectScheduleIssues(
        base({
          scheduleKind: 'every',
          scheduleExpr: null,
          scheduleEvery: MIN_SCHEDULE_EVERY_MS - 1,
          scheduleTimeZone: 'UTC',
        }),
      ),
    ).toHaveLength(1);
    expect(
      collectScheduleIssues(
        base({
          scheduleKind: 'every',
          scheduleExpr: null,
          scheduleEvery: MIN_SCHEDULE_EVERY_MS,
          scheduleTimeZone: 'UTC',
        }),
      ),
    ).toEqual([]);
  });

  it('every 间隔超过定时器上限被拒绝（请改用 cron）', () => {
    const issues = collectScheduleIssues(
      base({
        scheduleKind: 'every',
        scheduleExpr: null,
        scheduleEvery: MAX_TIMER_DELAY_MS + 1,
        scheduleTimeZone: 'UTC',
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('24.8');
  });

  it('投递到会话必须有目标：delivery_target 或绑定的 session_id', () => {
    expect(
      collectScheduleIssues(
        base({ deliveryMode: 'session', deliveryTarget: null, sessionId: null }),
      ),
    ).toHaveLength(1);
    expect(
      collectScheduleIssues(
        base({ deliveryMode: 'session', deliveryTarget: 's-1', sessionId: null }),
      ),
    ).toEqual([]);
    expect(
      collectScheduleIssues(
        base({ deliveryMode: 'session', deliveryTarget: null, sessionId: 's-1' }),
      ),
    ).toEqual([]);
  });

  it('desktop / none 模式不要求目标会话', () => {
    for (const mode of ['desktop', 'none'] as const) {
      expect(
        collectScheduleIssues(base({ deliveryMode: mode, deliveryTarget: null, sessionId: null })),
      ).toEqual([]);
    }
  });
});
