/**
 * useHistoryInfinite — 消息历史无限加载 hook（W4-03）
 *
 * 功能：
 *   - 监听滚动容器：当用户滚动到距顶部 200px 以内时，触发 `onLoadOlder()` 回调
 *   - 加载前记录滚动锚点（scrollHeight - scrollTop），加载完成后通过 rAF 恢复位置
 *   - 使用 isLoading / hasMore 标志防止重复触发
 *   - 每次最多加载一批（50 条），由消费方控制
 *
 * 使用方：
 *   消费方需在 `onLoadOlder()` 返回的 Promise resolve 后调用 `setLoadingDone()`，
 *   或直接依赖 isLoading 外部状态。
 *
 * 注意：
 *   此 hook 仅负责滚动检测与锚点恢复，不持有消息数据。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface UseHistoryInfiniteOptions {
  /** 消息列表滚动容器 */
  scrollRegionRef: RefObject<HTMLDivElement | null>;
  /** 距顶部触发加载的阈值（px），默认 200 */
  threshold?: number;
  /** 是否正在加载（防止重复触发） */
  isLoading: boolean;
  /** 是否还有更多历史消息可加载 */
  hasMore: boolean;
  /** 触发加载旧消息的回调 */
  onLoadOlder: () => void;
}

export interface UseHistoryInfiniteResult {
  /**
   * 在新消息插入 DOM 前调用：记录当前滚动锚点。
   * 调用后 rAF 恢复位置，防止内容插入导致跳动。
   */
  saveScrollAnchor: () => void;
  /**
   * 在新消息插入 DOM 后调用：通过 rAF 恢复锚点位置。
   */
  restoreScrollAnchor: () => void;
}

/** 判断用户是否接近顶部 */
function isNearTop(el: HTMLDivElement, threshold: number): boolean {
  return el.scrollTop <= threshold;
}

export function useHistoryInfinite({
  scrollRegionRef,
  threshold = 200,
  isLoading,
  hasMore,
  onLoadOlder,
}: UseHistoryInfiniteOptions): UseHistoryInfiniteResult {
  // scrollHeight - scrollTop 锚点：记录触发加载前的"距底部距离"
  const anchorRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const saveScrollAnchor = useCallback((): void => {
    const el = scrollRegionRef.current;
    if (!el) return;
    anchorRef.current = el.scrollHeight - el.scrollTop;
  }, [scrollRegionRef]);

  const restoreScrollAnchor = useCallback((): void => {
    const anchor = anchorRef.current;
    if (anchor === null) return;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRegionRef.current;
      if (!el || anchorRef.current === null) return;
      // 恢复到"距底部相同距离"的位置
      el.scrollTop = el.scrollHeight - anchor;
      anchorRef.current = null;
    });
  }, [scrollRegionRef]);

  useEffect(() => {
    const el = scrollRegionRef.current;
    if (!el) return;

    let rafScheduled = false;

    const handleScroll = () => {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        if (!scrollRegionRef.current) return;
        if (isLoading || !hasMore) return;
        if (isNearTop(scrollRegionRef.current, threshold)) {
          onLoadOlder();
        }
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [scrollRegionRef, threshold, isLoading, hasMore, onLoadOlder]);

  // 清理悬挂的 rAF
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return { saveScrollAnchor, restoreScrollAnchor };
}
