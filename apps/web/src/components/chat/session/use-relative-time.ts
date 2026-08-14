import { useEffect, useState } from 'react';
import { formatRelativeTime } from '../../layout/notification/format-time.js';

/**
 * 动态更新相对时间的 Hook
 * @param timestamp - 消息时间戳（毫秒）
 * @param enabled - 是否启用动态更新（默认 true）
 * @returns 相对时间字符串（如"2分钟前"）
 */
export function useRelativeTime(
  timestamp: number | string | undefined,
  enabled: boolean = true,
): string | null {
  const [relativeTime, setRelativeTime] = useState<string | null>(() => {
    if (timestamp === undefined) return null;
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return formatRelativeTime(date);
  });

  useEffect(() => {
    if (!enabled || timestamp === undefined) return;

    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
    if (Number.isNaN(date.getTime())) return;

    // 立即更新一次
    setRelativeTime(formatRelativeTime(date));

    // 根据消息年龄决定更新频率
    const getUpdateInterval = (messageDate: Date): number => {
      const diffMs = Date.now() - messageDate.getTime();
      const diffMin = diffMs / (60 * 1000);
      const diffHour = diffMs / (60 * 60 * 1000);

      // 10秒内：每秒更新
      if (diffMs < 10 * 1000) return 1000;
      // 1分钟内：每5秒更新
      if (diffMin < 1) return 5000;
      // 1小时内：每分钟更新
      if (diffMin < 60) return 60 * 1000;
      // 24小时内：每10分钟更新
      if (diffHour < 24) return 10 * 60 * 1000;
      // 7天内：每小时更新
      if (diffHour < 24 * 7) return 60 * 60 * 1000;
      // 超过7天：不再更新（显示固定日期）
      return 0;
    };

    let intervalId: number | undefined;

    const scheduleNextUpdate = () => {
      const interval = getUpdateInterval(date);
      if (interval === 0) return; // 不再需要更新

      intervalId = window.setTimeout(() => {
        setRelativeTime(formatRelativeTime(date));
        scheduleNextUpdate(); // 递归调度下一次更新
      }, interval);
    };

    scheduleNextUpdate();

    return () => {
      if (intervalId !== undefined) {
        clearTimeout(intervalId);
      }
    };
  }, [timestamp, enabled]);

  return relativeTime;
}
