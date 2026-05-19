import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isScrollTopNearLatest,
  resolveLatestScrollTop,
} from '../../../../components/conversation-runtime/scroll/scroll-alignment.js';
import {
  CHAT_SCROLL_BOTTOM_PADDING,
  CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
} from '../../../../components/conversation-runtime/scroll/scroll-constants.js';

// 同名常量 re-export，保持向后兼容（chat-message-group-list 等外部引用方依赖
// 从本模块导入这两个名字）。SSOT 在 ./scroll-constants.ts。
export {
  CHAT_SCROLL_BOTTOM_PADDING,
  CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
} from '../../../../components/conversation-runtime/scroll/scroll-constants.js';

// Center alignment bias when scrolling latest message into view.
// Kept at 0.5 (viewport vertical middle) — the visual "latest message
// closer to composer" effect now comes from the smaller bottom spacer
// (CHAT_SCROLL_BOTTOM_SPACER_HEIGHT) rather than from off-centre
// alignment, which kept feeling odd while streaming.
const CHAT_LATEST_CENTER_BIAS = 0.5;

// 注意：这 4 个常量是 use-chat-scroll 内部私有版本，与 scroll-constants 中的
// 公开常量在历史上有 drift（特别是 PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS：
// 私有=700，公开=420）。本次抽离 SSOT 仅统一公开侧（PADDING / SPACER_HEIGHT），
// 这里保持原值不变，避免 use-chat-scroll 的运行时行为发生意外变化。
// 后续 §6.3 chat 装配层迁移时再决定是否合并。
const CHAT_LATEST_FOCUS_THRESHOLD_PX = 32;
const CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX = 40;
const CHAT_LATEST_REGION_FALLBACK_PX = 420;
const CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS = 700;

export interface UseChatScrollOptions {
  visibleStreaming: boolean;
  visibleStreamBufferLength: number;
  messageCount: number;
  editorMode: boolean;
}

export interface UseChatScrollReturn {
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  contentColumnRef: React.RefObject<HTMLDivElement | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  showScrollToBottom: boolean;
  hasPendingFollowContent: boolean;
  setHasPendingFollowContent: React.Dispatch<React.SetStateAction<boolean>>;
  scrollToBottom: (behavior?: ScrollBehavior, align?: 'center' | 'latest-edge') => void;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  chatScrollBottomPadding: string;
  chatScrollBottomSpacerHeight: string;
}

export function useChatScroll(options: UseChatScrollOptions): UseChatScrollReturn {
  const { visibleStreaming, visibleStreamBufferLength, messageCount, editorMode } = options;

  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const contentColumnRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const isNearBottomRef = useRef(true);
  const ignoreScrollEventsUntilRef = useRef(0);
  // Cache the most recent anchor measurement for the duration of a
  // single animation frame. Multiple call sites
  // (handleScroll → isScrollRegionNearLatest → getLatestAnchorMetrics,
  //  scrollToBottom → getLatestAnchorMetrics) can hit this in the same
  // frame, especially during smooth-scroll where browsers fire
  // additional scroll events. Recomputing means another
  // querySelectorAll + getBoundingClientRect (forced layout) per call,
  // which is the source of `[Violation] 'message' handler took 100ms+`
  // during initial render and the click→smooth-scroll animation.
  const latestAnchorMetricsCacheRef = useRef<{
    expiresAt: number;
    metrics: {
      anchorHeight: number;
      anchorTop: number;
      clientHeight: number;
      maxScrollTop: number;
    } | null;
  } | null>(null);
  const ANCHOR_METRICS_CACHE_MS = 32; // ≈ 2 frames at 60Hz

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasPendingFollowContent, setHasPendingFollowContent] = useState(false);

  const getLatestAssistantAnchor = useCallback((): HTMLElement | null => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) {
      return bottomRef.current;
    }

    const groups = scrollRegion.querySelectorAll<HTMLElement>(
      '[data-chat-group-root="true"][data-role="assistant"]',
    );

    return groups[groups.length - 1] ?? bottomRef.current;
  }, []);

  const getLatestAnchorMetrics = useCallback(
    (
      scrollRegion: HTMLDivElement | null,
    ): {
      anchorHeight: number;
      anchorTop: number;
      clientHeight: number;
      maxScrollTop: number;
    } | null => {
      if (!scrollRegion || scrollRegion.clientHeight <= 0) {
        return null;
      }

      // Frame-scoped cache: if a recent measurement is still valid, return it.
      const cache = latestAnchorMetricsCacheRef.current;
      const now = performance.now();
      if (cache && cache.expiresAt > now) {
        return cache.metrics;
      }

      const latestAnchor = getLatestAssistantAnchor();
      if (
        !latestAnchor ||
        latestAnchor === bottomRef.current ||
        !scrollRegion.contains(latestAnchor)
      ) {
        latestAnchorMetricsCacheRef.current = {
          expiresAt: now + ANCHOR_METRICS_CACHE_MS,
          metrics: null,
        };
        return null;
      }

      const scrollRegionRect = scrollRegion.getBoundingClientRect();
      const latestAnchorRect = latestAnchor.getBoundingClientRect();
      if (scrollRegionRect.height === 0 || latestAnchorRect.height === 0) {
        latestAnchorMetricsCacheRef.current = {
          expiresAt: now + ANCHOR_METRICS_CACHE_MS,
          metrics: null,
        };
        return null;
      }

      const metrics = {
        anchorHeight: latestAnchorRect.height,
        anchorTop: scrollRegion.scrollTop + (latestAnchorRect.top - scrollRegionRect.top),
        clientHeight: scrollRegion.clientHeight,
        maxScrollTop: Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight),
      };
      latestAnchorMetricsCacheRef.current = {
        expiresAt: now + ANCHOR_METRICS_CACHE_MS,
        metrics,
      };
      return metrics;
    },
    [getLatestAssistantAnchor],
  );

  const isScrollRegionNearLatest = useCallback(
    (scrollRegion: HTMLDivElement | null): boolean => {
      if (!scrollRegion) {
        return true;
      }

      const distanceToBottom =
        scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight;
      // Cheap path 1: at the very bottom — definitely near latest.
      if (distanceToBottom <= CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX) {
        return true;
      }
      // Cheap path 2: clearly far from the bottom (more than the
      // fallback region) — definitely NOT near latest. Skip the
      // expensive anchor measurement entirely.
      // querySelectorAll + getBoundingClientRect on a long DOM after
      // a session switch can cost 80–150ms per call, which shows up
      // as `[Violation] 'message' handler took ...` warnings.
      if (distanceToBottom > CHAT_LATEST_REGION_FALLBACK_PX * 2) {
        return false;
      }

      const latestAnchorMetrics = getLatestAnchorMetrics(scrollRegion);
      if (!latestAnchorMetrics) {
        return distanceToBottom < CHAT_LATEST_REGION_FALLBACK_PX;
      }

      const followTolerance = Math.min(
        160,
        Math.max(CHAT_LATEST_FOCUS_THRESHOLD_PX * 2, scrollRegion.clientHeight * 0.18),
      );

      return isScrollTopNearLatest({
        ...latestAnchorMetrics,
        align: visibleStreaming ? 'center' : 'latest-edge',
        centerBias: CHAT_LATEST_CENTER_BIAS,
        centerMarginPx: CHAT_LATEST_FOCUS_THRESHOLD_PX,
        scrollTop: scrollRegion.scrollTop,
        tolerancePx: followTolerance,
      });
    },
    [getLatestAnchorMetrics, visibleStreaming],
  );

  const handleScrollFrameRef = useRef<number | null>(null);
  const handleScrollLastTargetRef = useRef<HTMLDivElement | null>(null);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (performance.now() < ignoreScrollEventsUntilRef.current) {
      return;
    }

    // Coalesce multiple scroll events per frame into one measurement.
    // Reading scrollTop / scrollHeight + getBoundingClientRect inside
    // the handler forces a layout sync; doing it 60+ times per second
    // (browsers fire scroll well above rAF cadence) was the source of
    // `[Violation] 'message' handler took 100ms+` warnings.
    handleScrollLastTargetRef.current = el;
    if (handleScrollFrameRef.current !== null) {
      return;
    }
    handleScrollFrameRef.current = requestAnimationFrame(() => {
      handleScrollFrameRef.current = null;
      const target = handleScrollLastTargetRef.current;
      if (!target) return;

      const isNearLatest = isScrollRegionNearLatest(target);
      isNearBottomRef.current = isNearLatest;
      // Only call setState when the actual flag flips — avoids
      // useless rerender churn during continuous scroll where the
      // value is stable.
      setShowScrollToBottom((prev) => (prev === !isNearLatest ? prev : !isNearLatest));
      if (isNearLatest) {
        setHasPendingFollowContent((prev) => (prev ? false : prev));
      }
    });
  }

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth', align: 'center' | 'latest-edge' = 'center') => {
      const scrollRegion = scrollRegionRef.current;

      isNearBottomRef.current = true;
      setShowScrollToBottom((prev) => (prev ? false : prev));
      setHasPendingFollowContent((prev) => (prev ? false : prev));
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }

      ignoreScrollEventsUntilRef.current =
        behavior === 'smooth' ? performance.now() + CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS : 0;

      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        // Move the DOM lookup *inside* the rAF so any pending React
        // commit has fully landed (and we don't risk reading stale
        // layout). Keeping it here also defers the querySelectorAll
        // until the browser is in the read phase of the frame.
        const latestAnchor = getLatestAssistantAnchor();
        if (scrollRegion) {
          const maxScrollTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight);
          const latestAnchorMetrics =
            latestAnchor &&
            latestAnchor !== bottomRef.current &&
            scrollRegion.contains(latestAnchor)
              ? getLatestAnchorMetrics(scrollRegion)
              : null;
          const nextTop = latestAnchorMetrics
            ? resolveLatestScrollTop({
                ...latestAnchorMetrics,
                align,
                centerBias: CHAT_LATEST_CENTER_BIAS,
                centerMarginPx: CHAT_LATEST_FOCUS_THRESHOLD_PX,
              })
            : maxScrollTop;
          const shouldForceScroll = scrollRegion.clientHeight === 0;

          if (
            shouldForceScroll ||
            Math.abs(scrollRegion.scrollTop - nextTop) > CHAT_LATEST_FOCUS_THRESHOLD_PX
          ) {
            scrollRegion.scrollTo({ top: nextTop, behavior });
          }
        } else {
          bottomRef.current?.scrollIntoView({
            behavior,
            block: align === 'center' ? 'center' : 'end',
          });
        }
        pendingScrollFrameRef.current = null;
      });
    },
    [getLatestAnchorMetrics, getLatestAssistantAnchor],
  );

  useEffect(() => {
    return () => {
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }
      if (handleScrollFrameRef.current !== null) {
        cancelAnimationFrame(handleScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (messageCount === 0 && !visibleStreaming && visibleStreamBufferLength === 0) {
      setShowScrollToBottom(false);
      setHasPendingFollowContent(false);
    }
  }, [messageCount, visibleStreamBufferLength, visibleStreaming]);

  useEffect(() => {
    if (visibleStreaming && isNearBottomRef.current) {
      scrollToBottom('auto');
    }
  }, [scrollToBottom, visibleStreaming]);

  useEffect(() => {
    if (visibleStreaming && isNearBottomRef.current && visibleStreamBufferLength > 0) {
      scrollToBottom('auto');
    }
  }, [scrollToBottom, visibleStreamBufferLength, visibleStreaming]);

  useEffect(() => {
    if (editorMode) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && contentColumnRef.current?.contains(activeElement)) {
      // focus textarea — handled externally via textareaRef
    }
  }, [editorMode]);

  useEffect(() => {
    if (isNearBottomRef.current && messageCount > 0) {
      scrollToBottom('auto', 'latest-edge');
    }
  }, [messageCount, scrollToBottom]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const contentColumn = contentColumnRef.current;
    if (!contentColumn) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!isNearBottomRef.current) {
        return;
      }

      if (messageCount === 0 && !visibleStreaming) {
        return;
      }

      scrollToBottom('auto', visibleStreaming ? 'center' : 'latest-edge');
    });

    observer.observe(contentColumn);

    return () => {
      observer.disconnect();
    };
  }, [messageCount, scrollToBottom, visibleStreaming]);

  return {
    scrollRegionRef,
    bottomRef,
    contentColumnRef,
    isNearBottomRef,
    showScrollToBottom,
    hasPendingFollowContent,
    setHasPendingFollowContent,
    scrollToBottom,
    handleScroll,
    chatScrollBottomPadding: CHAT_SCROLL_BOTTOM_PADDING,
    chatScrollBottomSpacerHeight: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
  };
}
