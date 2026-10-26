/**
 * 5 段 cron 表达式解析与时区感知的下次触发回归。
 *
 * 修复前的 `parseCronExpression` 只校验段数并恒定返回「到下一分钟」，
 * 任何 `cron` 任务都会变成每分钟跑一次。本文件同时锁定：
 *  1. 字段语法（通配 / 区间 / 步长 / 列表 / 越界）；
 *  2. 「日 与 星期」的 OR 语义；
 *  3. 时区换算（同一表达式在不同 tz 下落在不同的 UTC 时刻）。
 */
import { describe, expect, it } from 'vitest';
import {
  isValidCronExpression,
  nextCronFireAfter,
  parseCronExpressionFields,
} from '../../cron/cron-expression.js';

describe('cron-expression · 字段解析', () => {
  it('展开通配符与列表', () => {
    const parsed = parseCronExpressionFields('0,30 9 * * *');
    expect(parsed.minutes).toEqual([0, 30]);
    expect(parsed.hours).toEqual([9]);
    expect(parsed.months).toHaveLength(12);
    expect(parsed.dayOfMonthRestricted).toBe(false);
    expect(parsed.dayOfWeekRestricted).toBe(false);
  });

  it('支持区间与步长', () => {
    expect(parseCronExpressionFields('*/15 * * * *').minutes).toEqual([0, 15, 30, 45]);
    expect(parseCronExpressionFields('0 9-17 * * *').hours).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(parseCronExpressionFields('0 0-23/6 * * *').hours).toEqual([0, 6, 12, 18]);
  });

  it('星期 7 折叠为 0（周日），且去重', () => {
    expect(parseCronExpressionFields('0 0 * * 7').daysOfWeek).toEqual([0]);
    expect(parseCronExpressionFields('0 0 * * 0,7,1').daysOfWeek).toEqual([0, 1]);
  });

  it('越界与非法语法被拒绝', () => {
    for (const expr of [
      '* * * *',
      '* * * * * *',
      '60 * * * *',
      '* 24 * * *',
      '* * 0 * *',
      '* * * 13 *',
      '* * * * 8',
      '1-0 * * * *',
      '*/0 * * * *',
      'a * * * *',
      '1--2 * * * *',
    ]) {
      expect(isValidCronExpression(expr), expr).toBe(false);
    }
  });

  it('合法表达式通过校验', () => {
    for (const expr of ['* * * * *', '0 9 * * 1-5', '0 0 1 * *', '30 4 1,15 * 0']) {
      expect(isValidCronExpression(expr), expr).toBe(true);
    }
  });
});

describe('cron-expression · 下次触发', () => {
  it('每天 09:00（UTC）落在下一个 9 点整，而不是下一分钟', () => {
    const from = Date.UTC(2026, 0, 1, 8, 30, 15);
    const next = nextCronFireAfter('0 9 * * *', 'UTC', from);
    expect(next).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));
  });

  it('已过今天触发点时顺延到明天', () => {
    const from = Date.UTC(2026, 0, 1, 9, 0, 0);
    expect(nextCronFireAfter('0 9 * * *', 'UTC', from)).toBe(Date.UTC(2026, 0, 2, 9, 0, 0));
  });

  it('时区生效：同一表达式在 Asia/Shanghai 下偏移 8 小时', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(nextCronFireAfter('0 9 * * *', 'UTC', from)).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));
    expect(nextCronFireAfter('0 9 * * *', 'Asia/Shanghai', from)).toBe(
      Date.UTC(2026, 0, 1, 1, 0, 0),
    );
  });

  it('星期过滤：周六下午求下一个工作日 09:00', () => {
    // 2026-01-03 是周六。
    const from = Date.UTC(2026, 0, 3, 12, 0, 0);
    // 2026-01-05 是周一。
    expect(nextCronFireAfter('0 9 * * 1', 'UTC', from)).toBe(Date.UTC(2026, 0, 5, 9, 0, 0));
  });

  it('日与星期同时受限时取「或」', () => {
    // 2026-01-02 是周五；`1 * *` 命中「每月 1 号」或「每周一」。
    const from = Date.UTC(2026, 0, 2, 12, 0, 0);
    const next = nextCronFireAfter('0 9 1 * 1', 'UTC', from);
    // 下一个命中：2026-01-05（周一）早于 2026-02-01。
    expect(next).toBe(Date.UTC(2026, 0, 5, 9, 0, 0));
  });

  it('只受限一方时忽略另一方', () => {
    const from = Date.UTC(2026, 0, 2, 12, 0, 0);
    // 只有日受限 → 下一个 1 号（2026-02-01）。
    expect(nextCronFireAfter('0 0 1 * *', 'UTC', from)).toBe(Date.UTC(2026, 1, 1, 0, 0, 0));
  });

  it('搜索窗口内无解时返回 null（2 月 30 日）', () => {
    expect(nextCronFireAfter('0 0 30 2 *', 'UTC', Date.UTC(2026, 0, 1, 0, 0, 0))).toBeNull();
  });

  it('未知时区回落到 UTC 而非抛错', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(nextCronFireAfter('0 9 * * *', 'Not/AZone', from)).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));
  });

  it('结果严格大于起点（同一分钟不重复触发）', () => {
    const from = Date.UTC(2026, 0, 1, 9, 0, 0);
    expect(nextCronFireAfter('* * * * *', 'UTC', from)).toBe(Date.UTC(2026, 0, 1, 9, 1, 0));
  });
});
