/**
 * message-format 的三个纯格式化函数：时间 / 时长 / stopReason 标签。
 * 它们直接服务 UI，任何 undefined / 非法值都必须回落到 null（而不是
 * "Invalid Date" / "NaNs" 这类泄漏到界面的字符串）。
 */
import { describe, expect, it } from 'vitest';
import { formatDurationLabel, formatShortTime, formatStopReasonLabel } from './message-format.js';

describe('formatShortTime', () => {
  it('undefined / 非法字符串返回 null', () => {
    expect(formatShortTime(undefined)).toBeNull();
    expect(formatShortTime('not-a-date')).toBeNull();
  });

  it('数字与 ISO 字符串按本地时间格式化为 HH:mm', () => {
    const timestamp = Date.UTC(2024, 0, 2, 3, 4, 5);
    const expected = new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    expect(formatShortTime(timestamp)).toBe(expected);
    expect(formatShortTime(new Date(timestamp).toISOString())).toBe(expected);
  });

  it('0 视作 Unix epoch（不因 falsy 被拒绝）', () => {
    expect(formatShortTime(0)).toBe(
      new Date(0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
  });
});

describe('formatDurationLabel', () => {
  it('undefined / 0 / 负数返回 null', () => {
    expect(formatDurationLabel(undefined)).toBeNull();
    expect(formatDurationLabel(0)).toBeNull();
    expect(formatDurationLabel(-1)).toBeNull();
  });

  it('毫秒级直接带 ms 单位', () => {
    expect(formatDurationLabel(1)).toBe('1ms');
    expect(formatDurationLabel(999)).toBe('999ms');
  });

  it('1s–10s 保留一位小数，≥10s 取整数秒', () => {
    expect(formatDurationLabel(1000)).toBe('1.0s');
    expect(formatDurationLabel(1500)).toBe('1.5s');
    // 9.999s → toFixed(1) → 10.0s（仍是小数分支）
    expect(formatDurationLabel(9999)).toBe('10.0s');
    expect(formatDurationLabel(10_000)).toBe('10s');
    expect(formatDurationLabel(59_000)).toBe('59s');
  });

  it('NaN 返回 null（falsy 检查生效）', () => {
    expect(formatDurationLabel(Number.NaN)).toBeNull();
  });

  it('Infinity 未被拒绝，会进入秒分支（现状，已记录不做修复）', () => {
    expect(formatDurationLabel(Number.POSITIVE_INFINITY)).toBe('Infinitys');
  });
});

describe('formatStopReasonLabel', () => {
  it('undefined / 空串返回 null', () => {
    expect(formatStopReasonLabel(undefined)).toBeNull();
    expect(formatStopReasonLabel('')).toBeNull();
  });

  it('已知 stopReason 映射为中文标签', () => {
    expect(formatStopReasonLabel('end_turn')).toBe('完成');
    expect(formatStopReasonLabel('tool_use')).toBe('调用工具');
    // 权限暂停是「等待」而不是「已停止」：标签必须给出专属等待态，避免误导。
    expect(formatStopReasonLabel('tool_permission')).toBe('等待权限');
    expect(formatStopReasonLabel('max_tokens')).toBe('达到上限');
    expect(formatStopReasonLabel('error')).toBe('错误');
    expect(formatStopReasonLabel('cancelled')).toBe('已停止');
  });

  it('未知 stopReason 原样透传', () => {
    expect(formatStopReasonLabel('pause_turn')).toBe('pause_turn');
  });
});
