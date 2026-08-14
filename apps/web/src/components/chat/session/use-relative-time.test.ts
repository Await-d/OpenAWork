/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRelativeTime } from './use-relative-time.js';

describe('useRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('返回 null 当 timestamp 为 undefined', () => {
    const { result } = renderHook(() => useRelativeTime(undefined));
    expect(result.current).toBeNull();
  });

  it('返回 null 当 timestamp 无效', () => {
    const { result } = renderHook(() => useRelativeTime('invalid-date'));
    expect(result.current).toBeNull();
  });

  it('显示"刚刚"当消息在10秒内', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(now - 5000));
    expect(result.current).toBe('刚刚');
  });

  it('显示秒数当消息在1分钟内', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(now - 30 * 1000));
    expect(result.current).toBe('30 秒前');
  });

  it('显示分钟数当消息在1小时内', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(now - 15 * 60 * 1000));
    expect(result.current).toBe('15 分钟前');
  });

  it('显示小时数当消息在24小时内', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(now - 5 * 60 * 60 * 1000));
    expect(result.current).toBe('5 小时前');
  });

  it('显示"昨天"当消息在1天前', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(now - 25 * 60 * 60 * 1000));
    expect(result.current).toBe('昨天');
  });

  it('显示天数当消息在7天内', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(now - 3 * 24 * 60 * 60 * 1000));
    expect(result.current).toBe('3 天前');
  });

  it('显示完整日期当消息超过7天', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const pastDate = now - 10 * 24 * 60 * 60 * 1000;
    const { result } = renderHook(() => useRelativeTime(pastDate));

    // 验证返回的是格式化的日期字符串（不是相对时间）
    expect(result.current).not.toContain('天前');
    expect(result.current).toBeTruthy();
  });

  it('使用 fake timers 时能正确初始化时间', () => {
    const now = Date.now();
    const messageTime = now - 35000; // 35秒前
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(messageTime));
    expect(result.current).toBe('35 秒前');
  });

  it('当 enabled 为 false 时不更新', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useRelativeTime(now - 5000, false));
    expect(result.current).toBe('刚刚');

    // 前进30秒
    vi.setSystemTime(now + 30 * 1000);
    vi.advanceTimersByTime(5000);

    // 应该仍然显示"刚刚"，因为 enabled 为 false
    expect(result.current).toBe('刚刚');
  });

  it('接受字符串格式的 timestamp', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const timestamp = new Date(now - 5000).toISOString();
    const { result } = renderHook(() => useRelativeTime(timestamp));
    expect(result.current).toBe('刚刚');
  });

  it('清理定时器当组件卸载', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const { unmount } = renderHook(() => useRelativeTime(now - 30 * 1000));

    // 获取活跃的定时器数量
    const timersBefore = vi.getTimerCount();

    unmount();

    // 卸载后定时器应该被清理
    const timersAfter = vi.getTimerCount();
    expect(timersAfter).toBeLessThan(timersBefore);
  });
});
