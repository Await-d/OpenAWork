/**
 * 统计栏单行适配的宽度观测：ResizeObserver 优先，缺失环境（jsdom / 老浏览器）
 * 回退 window.resize。
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  resolveStatsBarFit,
  type StatsBarFit,
  type StatsBarItemMetrics,
} from './composer-stats-bar-fit.js';

export interface UseStatsBarFitResult {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly fit: StatsBarFit;
}

export function useStatsBarFit(items: readonly StatsBarItemMetrics[]): UseStatsBarFitResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const update = () => setAvailableWidth(element.clientWidth);
    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(() => update());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // items 每帧可能重建，而裁剪计算只是几十次数值运算，无需 useMemo 记忆。
  const fit = resolveStatsBarFit({ availableWidth, items });

  return { containerRef, fit };
}
