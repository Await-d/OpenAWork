import { useCallback, useEffect, useRef } from 'react';
import { isScrollTopNearLatest, resolveLatestScrollTop } from './scroll-alignment.js';
import {
  CHAT_LATEST_FOCUS_THRESHOLD_PX,
  CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX,
  CHAT_LATEST_REGION_FALLBACK_PX,
  CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS,
} from './chat-page-utils.js';

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
      return isScrollTopNearLatest({
        ...m,
        align: visibleStreaming ? 'center' : 'latest-edge',
        centerMarginPx: CHAT_LATEST_FOCUS_THRESHOLD_PX,
        scrollTop: scrollRegion.scrollTop,
        tolerancePx: tol,
      });
    },
    [getLatestAnchorMetrics, visibleStreaming],
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
  }

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth', align: 'center' | 'latest-edge' = 'center') => {
      const sr = scrollRegionRef.current;
      const la = getLatestAssistantAnchor();
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      setHasPendingFollowContent(false);
      if (pendingScrollFrameRef.current !== null)
        cancelAnimationFrame(pendingScrollFrameRef.current);
      ignoreScrollEventsUntilRef.current =
        behavior === 'smooth' ? performance.now() + CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS : 0;
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
      scrollToBottom('auto');
    }
  }, [scrollToBottom, visibleStreaming, isNearBottomRef]);

  useEffect(() => {
    if (visibleStreaming && isNearBottomRef.current && visibleStreamBufferLength > 0) {
      scrollToBottom('auto');
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
      scrollToBottom('auto', 'latest-edge');
    }
  }, [messagesLength, scrollToBottom, isNearBottomRef]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const contentColumn = contentColumnRef.current;
    if (!contentColumn) return;
    const observer = new ResizeObserver(() => {
      if (!isNearBottomRef.current) return;
      if (messagesLength === 0 && !visibleStreaming) return;
      scrollToBottom('auto', visibleStreaming ? 'center' : 'latest-edge');
    });
    observer.observe(contentColumn);
    return () => observer.disconnect();
  }, [messagesLength, scrollToBottom, visibleStreaming, contentColumnRef, isNearBottomRef]);

  return { isNearBottomRef, ignoreScrollEventsUntilRef, handleScroll, scrollToBottom };
}
