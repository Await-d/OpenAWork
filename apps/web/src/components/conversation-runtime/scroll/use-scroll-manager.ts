import { useCallback, useEffect, useRef } from 'react';
import {
  CHAT_AUTO_FOLLOW_ALIGN,
  isScrollTopNearLatest,
  resolveLatestScrollTop,
} from './scroll-alignment.js';
import {
  CHAT_LATEST_FOCUS_THRESHOLD_PX,
  CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX,
  CHAT_LATEST_REGION_FALLBACK_PX,
  CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS,
} from './scroll-constants.js';

export interface ScrollManagerRefs {
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  pendingScrollFrameRef: React.MutableRefObject<number | null>;
  contentColumnRef: React.RefObject<HTMLDivElement | null>;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export interface ScrollManagerSetters {
  setShowScrollToBottom: (value: boolean) => void;
  setHasPendingFollowContent: (value: boolean) => void;
}

export interface ScrollManagerEffects {
  messagesLength: number;
  visibleStreaming: boolean;
  visibleStreamBufferLength: number;
  editorMode: boolean;
}

export interface ScrollManagerOptions {
  /** 滚动到顶部附近时触发加载更早消息（距离顶部 <= 阈值 px）。 */
  onNearTop?: () => void;
  /** 触发加载的阈值（距顶部 px），默认 120。 */
  nearTopThreshold?: number;
  /** 防抖间隔 ms，避免连续触发，默认 800。 */
  nearTopDebounceMs?: number;
}

export interface ScrollManagerReturn {
  isNearBottomRef: React.MutableRefObject<boolean>;
  ignoreScrollEventsUntilRef: React.MutableRefObject<number>;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  scrollToBottom: (behavior?: ScrollBehavior, align?: 'center' | 'latest-edge') => void;
}

export function useScrollManager(
  refs: ScrollManagerRefs,
  setters: ScrollManagerSetters,
  effects: ScrollManagerEffects,
  options?: ScrollManagerOptions,
): ScrollManagerReturn {
  const {
    scrollRegionRef,
    bottomRef,
    pendingScrollFrameRef,
    contentColumnRef,
    editorPaneRef,
    textareaRef,
  } = refs;
  const { setShowScrollToBottom, setHasPendingFollowContent } = setters;
  const { messagesLength, visibleStreaming, visibleStreamBufferLength, editorMode } = effects;
  const isNearBottomRef = useRef(true);
  const ignoreScrollEventsUntilRef = useRef(0);
  const lastNearTopTriggeredRef = useRef(0);
  const isNearTopTriggeredRef = useRef(false);

  const getLatestAssistantAnchor = useCallback((): HTMLElement | null => {
    const sr = scrollRegionRef.current;
    if (!sr) return bottomRef.current;
    const groups = sr.querySelectorAll<HTMLElement>(
      '[data-chat-group-root="true"][data-role="assistant"]',
    );
    return groups[groups.length - 1] ?? bottomRef.current;
  }, [scrollRegionRef, bottomRef]);

  const getLatestAnchorMetrics = useCallback(
    (scrollRegion: HTMLDivElement | null) => {
      if (!scrollRegion || scrollRegion.clientHeight <= 0) return null;
      const la = getLatestAssistantAnchor();
      if (!la || la === bottomRef.current || !scrollRegion.contains(la)) return null;
      const srR = scrollRegion.getBoundingClientRect();
      const laR = la.getBoundingClientRect();
      if (srR.height === 0 || laR.height === 0) return null;
      return {
        anchorHeight: laR.height,
        anchorTop: scrollRegion.scrollTop + (laR.top - srR.top),
        clientHeight: scrollRegion.clientHeight,
        maxScrollTop: Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight),
      };
    },
    [getLatestAssistantAnchor, bottomRef],
  );

  const isScrollRegionNearLatest = useCallback(
    (scrollRegion: HTMLDivElement | null): boolean => {
      if (!scrollRegion) return true;
      const dist = scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight;
      if (dist <= CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX) return true;
      const m = getLatestAnchorMetrics(scrollRegion);
      if (!m) return dist < CHAT_LATEST_REGION_FALLBACK_PX;
      const tol = Math.min(
        160,
        Math.max(CHAT_LATEST_FOCUS_THRESHOLD_PX * 2, scrollRegion.clientHeight * 0.18),
      );
      // Auto-follow always uses latest-edge, so near-latest detection must
      // match that target. Center-align detection would keep reporting "near"
      // while the expanding tool body sits below the fold.
      return isScrollTopNearLatest({
        ...m,
        align: CHAT_AUTO_FOLLOW_ALIGN,
        centerMarginPx: CHAT_LATEST_FOCUS_THRESHOLD_PX,
        scrollTop: scrollRegion.scrollTop,
        tolerancePx: tol,
      });
    },
    [getLatestAnchorMetrics],
  );

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (performance.now() < ignoreScrollEventsUntilRef.current) return;
    const near = isScrollRegionNearLatest(el);
    const wasNear = isNearBottomRef.current;
    isNearBottomRef.current = near;
    if (wasNear !== near) {
      setShowScrollToBottom(!near);
    }
    if (near && !wasNear) {
      setHasPendingFollowContent(false);
    }

    // ─── 滚动到顶部附近 → 自动加载更早消息 ───────────────────────
    if (options?.onNearTop) {
      const threshold = options.nearTopThreshold ?? 120;
      const debounceMs = options.nearTopDebounceMs ?? 800;
      const now = performance.now();
      if (el.scrollTop <= threshold) {
        if (!isNearTopTriggeredRef.current && now - lastNearTopTriggeredRef.current > debounceMs) {
          isNearTopTriggeredRef.current = true;
          lastNearTopTriggeredRef.current = now;
          // 记录当前滚动位置，加载后恢复视口锚点
          options.onNearTop();
        }
      } else if (el.scrollTop > threshold + 40) {
        // 离开顶部区域后重置，允许下次再次触发
        isNearTopTriggeredRef.current = false;
      }
    }
  }

  const scrollToBottom = useCallback(
    // Default to latest-edge so accidental callers (and tool-card height
    // growth) pin the growing bottom into view rather than the midpoint.
    (behavior: ScrollBehavior = 'smooth', align: 'center' | 'latest-edge' = 'latest-edge') => {
      const sr = scrollRegionRef.current;
      const la = getLatestAssistantAnchor();
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      setHasPendingFollowContent(false);
      if (pendingScrollFrameRef.current !== null)
        cancelAnimationFrame(pendingScrollFrameRef.current);
      const nextIgnore =
        behavior === 'smooth'
          ? performance.now() + CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS
          : behavior === 'auto'
            ? performance.now() + 80
            : 0;
      ignoreScrollEventsUntilRef.current = Math.max(ignoreScrollEventsUntilRef.current, nextIgnore);
      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        if (sr) {
          const maxST = Math.max(0, sr.scrollHeight - sr.clientHeight);
          const m =
            la && la !== bottomRef.current && sr.contains(la) ? getLatestAnchorMetrics(sr) : null;
          const nextTop = m
            ? resolveLatestScrollTop({
                ...m,
                align,
                centerMarginPx: CHAT_LATEST_FOCUS_THRESHOLD_PX,
              })
            : maxST;
          if (
            sr.clientHeight === 0 ||
            Math.abs(sr.scrollTop - nextTop) > CHAT_LATEST_FOCUS_THRESHOLD_PX
          )
            sr.scrollTo({ top: nextTop, behavior });
        } else {
          bottomRef.current?.scrollIntoView({
            behavior,
            block: align === 'center' ? 'center' : 'end',
          });
        }
        pendingScrollFrameRef.current = null;
      });
    },
    [
      getLatestAnchorMetrics,
      getLatestAssistantAnchor,
      scrollRegionRef,
      bottomRef,
      pendingScrollFrameRef,
      setShowScrollToBottom,
      setHasPendingFollowContent,
    ],
  );

  // Scroll-related effects
  useEffect(() => {
    if (messagesLength === 0 && !visibleStreaming && visibleStreamBufferLength === 0) {
      setShowScrollToBottom(false);
      setHasPendingFollowContent(false);
    }
  }, [
    messagesLength,
    visibleStreamBufferLength,
    visibleStreaming,
    setShowScrollToBottom,
    setHasPendingFollowContent,
  ]);

  useEffect(() => {
    if (visibleStreaming && isNearBottomRef.current) {
      // Pin to latest-edge so tool-card expansion (which grows the assistant
      // group downward) stays visible; center would leave the body off-screen.
      scrollToBottom('auto', CHAT_AUTO_FOLLOW_ALIGN);
    }
  }, [scrollToBottom, visibleStreaming, isNearBottomRef]);

  useEffect(() => {
    if (visibleStreaming && isNearBottomRef.current && visibleStreamBufferLength > 0) {
      scrollToBottom('auto', CHAT_AUTO_FOLLOW_ALIGN);
    }
  }, [scrollToBottom, visibleStreamBufferLength, visibleStreaming, isNearBottomRef]);

  useEffect(() => {
    if (editorMode) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && editorPaneRef.current?.contains(activeElement)) {
      textareaRef.current?.focus();
    }
  }, [editorMode, editorPaneRef, textareaRef]);

  useEffect(() => {
    if (isNearBottomRef.current && messagesLength > 0) {
      scrollToBottom('auto', CHAT_AUTO_FOLLOW_ALIGN);
    }
  }, [messagesLength, scrollToBottom, isNearBottomRef]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const contentColumn = contentColumnRef.current;
    if (!contentColumn) return;
    // ResizeObserver is the primary follow path for tool-call height growth
    // (tool cards do not change visibleStreamBufferLength). Must use
    // latest-edge, not center.
    const observer = new ResizeObserver(() => {
      if (!isNearBottomRef.current) return;
      if (messagesLength === 0 && !visibleStreaming) return;
      scrollToBottom('auto', CHAT_AUTO_FOLLOW_ALIGN);
    });
    observer.observe(contentColumn);
    return () => observer.disconnect();
  }, [messagesLength, scrollToBottom, visibleStreaming, contentColumnRef, isNearBottomRef]);

  return { isNearBottomRef, ignoreScrollEventsUntilRef, handleScroll, scrollToBottom };
}
