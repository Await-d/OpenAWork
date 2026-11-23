import { describe, expect, it } from 'vitest';
import {
  SQLITE_UTC_DATETIME_PATTERN,
  formatServerDate,
  formatServerDateTime,
  formatServerTime,
  parseServerTimestamp,
  toServerDate,
  toServerIsoString,
} from './server-timestamp.js';

/**
 * 断言必须与运行环境的时区无关：CI 常为 UTC，本机为 Asia/Shanghai。
 * 因此期望值一律用 `Date.UTC(...)` 或「同一个 Date 的本地化结果」表达。
 */
describe('parseServerTimestamp', () => {
  it('把无时区 SQLite 文本按 UTC 解析（不得按本地时区偏移）', () => {
    expect(parseServerTimestamp('2026-11-18 15:48:55')).toBe(Date.UTC(2026, 10, 18, 15, 48, 55));
    expect(parseServerTimestamp('2026-11-18 15:48:55.250')).toBe(
      Date.UTC(2026, 10, 18, 15, 48, 55, 250),
    );
  });

  it('带时区语义的 ISO 字符串按原语义解析', () => {
    expect(parseServerTimestamp('2026-11-18T15:48:55.000Z')).toBe(
      Date.UTC(2026, 10, 18, 15, 48, 55),
    );
    expect(parseServerTimestamp('2026-11-18T23:48:55+08:00')).toBe(
      Date.UTC(2026, 10, 18, 15, 48, 55),
    );
  });

  it('数值入参按 epoch 毫秒原样返回', () => {
    const epoch = Date.UTC(2026, 10, 18, 15, 48, 55);
    expect(parseServerTimestamp(epoch)).toBe(epoch);
    expect(parseServerTimestamp(String(epoch))).toBe(epoch);
    expect(parseServerTimestamp(new Date(epoch))).toBe(epoch);
  });

  it('无法解析的入参返回 null', () => {
    expect(parseServerTimestamp(null)).toBeNull();
    expect(parseServerTimestamp(undefined)).toBeNull();
    expect(parseServerTimestamp('')).toBeNull();
    expect(parseServerTimestamp('   ')).toBeNull();
    expect(parseServerTimestamp('不是时间')).toBeNull();
    expect(parseServerTimestamp(Number.NaN)).toBeNull();
  });

  it('无时区文本与本地时区无关：同一文本在不同 TZ 下得到同一时间点', () => {
    const text = '2026-11-18 15:48:55';
    expect(parseServerTimestamp(text)).toBe(Date.parse('2026-11-18T15:48:55Z'));
  });
});

describe('toServerDate / toServerIsoString', () => {
  it('toServerDate 返回等价 Date', () => {
    expect(toServerDate('2026-11-18 15:48:55')?.toISOString()).toBe('2026-11-18T15:48:55.000Z');
    expect(toServerDate(null)).toBeNull();
  });

  it('toServerIsoString 输出带 Z 的 ISO', () => {
    expect(toServerIsoString('2026-11-18 15:48:55')).toBe('2026-11-18T15:48:55.000Z');
    expect(toServerIsoString('oops')).toBeNull();
  });
});

describe('格式化 helper 走本地时区', () => {
  const value = '2026-11-18 15:48:55';
  const localTimeText = new Date(value.replace(' ', 'T') + 'Z').toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  it('formatServerTime 与本地化结果一致', () => {
    expect(formatServerTime(value)).toBe(localTimeText);
  });

  it('formatServerDateTime / formatServerDate 复用同一时间点', () => {
    const expectedDateTime = new Date(value.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', {
      hour12: false,
    });
    const expectedDate = new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('zh-CN');
    expect(formatServerDateTime(value)).toBe(expectedDateTime);
    expect(formatServerDate(value)).toBe(expectedDate);
  });

  it('无法解析时返回 fallback', () => {
    expect(formatServerTime(null, { fallback: '未知' })).toBe('未知');
    expect(formatServerDateTime(undefined)).toBe('—');
    expect(formatServerDate('x', { fallback: '无' })).toBe('无');
  });
});

describe('SQLITE_UTC_DATETIME_PATTERN', () => {
  it('只匹配无时区的 SQLite datetime 形态', () => {
    expect(SQLITE_UTC_DATETIME_PATTERN.test('2026-11-18 15:48:55')).toBe(true);
    expect(SQLITE_UTC_DATETIME_PATTERN.test('2026-11-18 15:48:55.123')).toBe(true);
    expect(SQLITE_UTC_DATETIME_PATTERN.test('2026-11-18T15:48:55Z')).toBe(false);
    expect(SQLITE_UTC_DATETIME_PATTERN.test('2026-11-18')).toBe(false);
  });
});
