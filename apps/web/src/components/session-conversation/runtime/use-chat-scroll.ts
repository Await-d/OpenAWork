import { useCallback, useEffect, useRef, useState } from 'react';
import { isScrollTopNearLatest, resolveLatestScrollTop } from './scroll-alignment.js';

export const CHAT_SCROLL_BOTTOM_PADDING = '0.95rem';
export const CHAT_SCROLL_BOTTOM_SPACER_HEIGHT = 'clamp(180px, 34vh, 320px)';
const CHAT_LATEST_FOCUS_THRESHOLD_PX = 32;
const CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX = 40;
const CHAT_LATEST_REGION_FALLBACK_PX = 420;
const CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS = 420;

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

      const latestAnchor = getLatestAssistantAnchor();
      if (
        !latestAnchor ||
        latestAnchor === bottomRef.current ||
        !scrollRegion.contains(latestAnchor)
      ) {
        return null;
      }

      const scrollRegionRect = scrollRegion.getBoundingClientRect();
      const latestAnchorRect = latestAnchor.getBoundingClientRect();
      if (scrollRegionRect.height === 0 || latestAnchorRect.height === 0) {
        return null;
      }

      return {
        anchorHeight: latestAnchorRect.height,
        anchorTop: scrollRegion.scrollTop + (latestAnchorRect.top - scrollRegionRect.top),
        clientHeight: scrollRegion.clientHeight,
        maxScrollTop: Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight),
      };
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
      if (distanceToBottom <= CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX) {
        return true;
      }

      const latestAnchorMetrics = getLatestAnchorMetrics(scrollRegion);
      if (!latestAnchorMetrics) {
        return (
          scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight <
          CHAT_LATEST_REGION_FALLBACK_PX
        );
      }

      const followTolerance = Math.min(
        160,
        Math.max(CHAT_LATEST_FOCUS_THRESHOLD_PX * 2, scrollRegion.clientHeight * 0.18),
      );

      return isScrollTopNearLatest({
        ...latestAnchorMetrics,
        align: visibleStreaming ? 'center' : 'latest-edge',
        centerMarginPx: CHAT_LATEST_FOCUS_THRESHOLD_PX,
        scrollTop: scrollRegion.scrollTop,
        tolerancePx: followTolerance,
      });
    },
    [getLatestAnchorMetrics, visibleStreaming],
  );

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (performance.now() < ignoreScrollEventsUntilRef.current) {
      return;
    }

    const isNearLatest = isScrollRegionNearLatest(el);
    isNearBottomRef.current = isNearLatest;
    setShowScrollToBottom(!isNearLatest);
    if (isNearLatest) {
      setHasPendingFollowContent(false);
    }
  }

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth', align: 'center' | 'latest-edge' = 'center') => {
      const scrollRegion = scrollRegionRef.current;
      const latestAnchor = getLatestAssistantAnchor();

      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      setHasPendingFollowContent(false);
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }

      ignoreScrollEventsUntilRef.current =
        behavior === 'smooth' ? performance.now() + CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS : 0;

      pendingScrollFrameRef.current = requestAnimationFrame(() => {
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
