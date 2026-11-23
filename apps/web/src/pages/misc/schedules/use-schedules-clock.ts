import { useEffect, useState } from 'react';

/**
 * 页面级「当前时刻」。
 *
 * 卡片倒计时（`3 小时后`）与时间轴分组（今天 / 明天）都依赖它：不更新的话，
 * 页面开着不动会一直显示旧值。最小可读粒度是分钟，30 秒一刷足够；
 * 页面隐藏时不刷新（与实时流的门控约定一致，别在后台白跑定时器）。
 */
/** 30s 粒度即可：页面最小可读单位是分钟（导出仅为内部使用，不对外暴露）。 */
const SCHEDULES_CLOCK_INTERVAL_MS = 30_000;

export function useSchedulesClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setNowMs(Date.now());
    }, SCHEDULES_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return nowMs;
}
