/**
 * 实时预览的主文档滚动几何。
 *
 * 实时画面是网关侧 Chromium 的位图，浏览器自己的滚动条不会出现在截图里，前端也
 * 读不到远端文档的尺寸。这里通过 `scroll.metrics` 控制指令向网关要一份几何数据，
 * 供 `LiveScrollbar` 画出一条按比例、可拖动的滚动条：
 *
 * - **定期重取**：页面可能动态长高（懒加载 / 列表追加），也可能是页面脚本在滚动，
 *   只靠用户操作推导会越用越偏；
 * - **帧元数据补位**：`screencastFrame` 自带 `scrollOffsetY`，滚轮 / 页面内滚动
 *   产生的每一帧都能把 thumb 拉回真实位置，不必等下一次轮询；
 * - **重置点**：切标签 / 改地址 / 刷新时清空旧指标，避免新页面沿用上一个页面的
 *   内容高度（表现为「新页面明明很短，滚动条却很长」）。
 */

import { useCallback, useEffect, useState } from 'react';
import type { BrowserLiveSession } from './use-browser-live-session.js';

/** 页面动态内容的重取间隔：滚动位置有帧元数据兜底，这里只管内容高度。 */
export const LIVE_SCROLL_METRICS_POLL_MS = 1500;

export interface LiveScrollMetrics {
  /** 当前纵向滚动位置（CSS px）。 */
  scrollY: number;
  /** 可滚动距离（不小于 0）。 */
  maxScrollY: number;
  /** 视口高度（CSS px）。 */
  viewportHeight: number;
  /** 主文档内容高度（CSS px）。 */
  contentHeight: number;
}

interface UseLiveScrollMetricsOptions {
  readonly session: BrowserLiveSession;
  /** 面板不可见 / 未连接时关闭轮询并清空指标。 */
  readonly enabled: boolean;
  /** 页面身份（url + 刷新代号）：变化时清空旧指标并立即重取。 */
  readonly resetKey: string;
}

function readNonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

/** 校验并收敛 `scroll` 信封载荷；形状不符时返回 null 而不是抛出。 */
export function toLiveScrollMetrics(payload: unknown): LiveScrollMetrics | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const scrollY = readNonNegative(record['scrollY']);
  const maxScrollY = readNonNegative(record['maxScrollY']);
  const viewportHeight = readNonNegative(record['viewportHeight']);
  const contentHeight = readNonNegative(record['contentHeight']);
  if (
    scrollY === null ||
    maxScrollY === null ||
    viewportHeight === null ||
    contentHeight === null
  ) {
    return null;
  }
  return {
    scrollY: Math.min(scrollY, maxScrollY),
    maxScrollY,
    viewportHeight,
    contentHeight,
  };
}

export function useLiveScrollMetrics({ session, enabled, resetKey }: UseLiveScrollMetricsOptions): {
  metrics: LiveScrollMetrics | null;
  requestMetrics: () => void;
} {
  const [metrics, setMetrics] = useState<LiveScrollMetrics | null>(null);

  const requestMetrics = useCallback(() => {
    if (!enabled) return;
    session.send({ ch: 'control', action: 'scroll.metrics' });
  }, [enabled, session]);

  useEffect(() => {
    if (!enabled) {
      setMetrics(null);
      return;
    }

    return session.subscribe((envelope) => {
      if (envelope.ch === 'scroll') {
        const next = toLiveScrollMetrics(envelope.payload);
        if (next !== null) setMetrics(next);
        return;
      }

      // 帧元数据里的滚动偏移比轮询实时：滚轮 / 页面内滚动每产生一帧都能回填。
      // 只更新位置，不动内容高度——高度始终以 `scroll.metrics` 为准。
      if (envelope.ch === 'frame') {
        const payload = envelope.payload as { scrollOffsetY?: unknown } | null | undefined;
        const offset = readNonNegative(payload?.scrollOffsetY);
        if (offset === null) return;
        setMetrics((previous) =>
          previous === null
            ? previous
            : { ...previous, scrollY: Math.min(offset, previous.maxScrollY) },
        );
      }
    });
  }, [enabled, session]);

  // 页面身份一变就丢掉旧指标，并立刻重取一次（轮询要到下一个周期才到）。
  useEffect(() => {
    setMetrics(null);
    if (!enabled) return;
    session.send({ ch: 'control', action: 'scroll.metrics' });
  }, [enabled, resetKey, session]);

  useEffect(() => {
    if (!enabled || session.phase !== 'connected') return;
    const timer = setInterval(requestMetrics, LIVE_SCROLL_METRICS_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, requestMetrics, session.phase]);

  return { metrics, requestMetrics };
}
