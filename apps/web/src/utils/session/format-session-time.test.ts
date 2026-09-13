import { describe, expect, it } from 'vitest';
import { formatSessionTime, formatSessionTimeTitle } from './format-session-time.js';

// 2026-09-13 是周日，便于断言「周X」分支。
const NOW = new Date(2026, 8, 13, 15, 30, 0);

describe('formatSessionTime', () => {
  it('1 分钟内显示「刚刚」', () => {
    expect(formatSessionTime(new Date(2026, 8, 13, 15, 29, 40), NOW)).toBe('刚刚');
  });

  it('1 小时内显示相对分钟', () => {
    expect(formatSessionTime(new Date(2026, 8, 13, 15, 5, 0), NOW)).toBe('25分钟前');
  });

  it('今天更早的时间显示 HH:mm', () => {
    expect(formatSessionTime(new Date(2026, 8, 13, 9, 5, 0), NOW)).toBe('09:05');
  });

  it('昨天显示「昨天」', () => {
    expect(formatSessionTime(new Date(2026, 8, 12, 23, 0, 0), NOW)).toBe('昨天');
  });

  it('最近 7 天内显示周几', () => {
    // 2026-09-10 是周四
    expect(formatSessionTime(new Date(2026, 8, 10, 8, 0, 0), NOW)).toBe('周四');
  });

  it('同年更早显示月日', () => {
    expect(formatSessionTime(new Date(2026, 7, 14, 8, 0, 0), NOW)).toBe('8月14日');
  });

  it('跨年显示完整年月日', () => {
    expect(formatSessionTime(new Date(2025, 11, 31, 8, 0, 0), NOW)).toBe('2025/12/31');
  });

  it('接受 ISO 字符串输入', () => {
    expect(
      formatSessionTime('2026-09-13T09:05:00.000Z', new Date('2026-09-13T09:30:00.000Z')),
    ).toBe('25分钟前');
  });

  it('无效输入返回空字符串', () => {
    expect(formatSessionTime(null)).toBe('');
    expect(formatSessionTime(undefined)).toBe('');
    expect(formatSessionTime('not-a-date')).toBe('');
  });

  it('未来时间不产生负数文案', () => {
    expect(formatSessionTime(new Date(2026, 8, 13, 16, 0, 0), NOW)).toBe('16:00');
  });
});

describe('formatSessionTimeTitle', () => {
  it('输出可读的完整时间', () => {
    expect(formatSessionTimeTitle(new Date(2026, 8, 13, 9, 5, 0))).toBe('2026-09-13 09:05');
  });

  it('无效输入返回空字符串', () => {
    expect(formatSessionTimeTitle('')).toBe('');
    expect(formatSessionTimeTitle('bad-value')).toBe('');
  });
});
