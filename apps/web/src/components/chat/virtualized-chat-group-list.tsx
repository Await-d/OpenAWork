import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatUsageDetails } from '../../pages/chat-page/support.js';
import type { ChatMessage } from '../../pages/chat-page/support.js';
import { MessageRow, sharedUiThemeVars } from './ChatPageSections.js';

export interface ChatRenderAction {
  id: string;
  label: string;
  onClick: () => void;
  title?: string;
}

export interface ChatRenderEntry {
  actions?: ChatRenderAction[];
  message: ChatMessage;
  renderContent: (message: ChatMessage) => React.ReactNode;
  usageDetails?: ChatUsageDetails;
}

export interface ChatRenderGroup {
  entries: ChatRenderEntry[];
  key: string;
  role: ChatMessage['role'];
}

interface VirtualizedChatGroupListProps {
  activeModelId: string;
  activeModelLabel?: string;
  activeProviderId: string;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  currentUserEmail: string;
  groups: ChatRenderGroup[];
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
}

const DEFAULT_GROUP_HEIGHT = 148;
const OVERSCAN_PX = 720;
const VIRTUALIZATION_GROUP_THRESHOLD = 64;
const FALLBACK_VIEWPORT_HEIGHT = 720;

export function VirtualizedChatGroupList({
  activeModelId,
  activeModelLabel,
  activeProviderId,
  bottomRef,
  currentUserEmail,
  groups,
  scrollRegionRef,
}: VirtualizedChatGroupListProps) {
  const shouldVirtualize = groups.length >= VIRTUALIZATION_GROUP_THRESHOLD;

  if (!shouldVirtualize) {
    return (
      <>
        {groups.map((group) => (
          <ChatGroupBlock
            key={group.key}
            activeModelId={activeModelId}
            activeModelLabel={activeModelLabel}
            activeProviderId={activeProviderId}
            currentUserEmail={currentUserEmail}
            group={group}
          />
        ))}
        <div ref={bottomRef} style={{ height: 28, flexShrink: 0 }} />
      </>
    );
  }

  return (
    <VirtualizedChatGroupViewport
      activeModelId={activeModelId}
      activeModelLabel={activeModelLabel}
      activeProviderId={activeProviderId}
      bottomRef={bottomRef}
      currentUserEmail={currentUserEmail}
      groups={groups}
      scrollRegionRef={scrollRegionRef}
    />
  );
}

function VirtualizedChatGroupViewport({
  activeModelId,
  activeModelLabel,
  activeProviderId,
  bottomRef,
  currentUserEmail,
  groups,
  scrollRegionRef,
}: VirtualizedChatGroupListProps) {
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const groupHeightsRef = useRef(new Map<string, number>());
  const observedElementsRef = useRef(new Map<string, Element>());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) {
      return;
    }

    const syncViewport = () => {
      setViewportHeight(scrollRegion.clientHeight || FALLBACK_VIEWPORT_HEIGHT);
      setScrollTop(scrollRegion.scrollTop);
    };

    const handleScroll = () => {
      setScrollTop(scrollRegion.scrollTop);
      setViewportHeight(scrollRegion.clientHeight || FALLBACK_VIEWPORT_HEIGHT);
    };

    syncViewport();
    scrollRegion.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', syncViewport);

    return () => {
      scrollRegion.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', syncViewport);
    };
  }, [scrollRegionRef]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    resizeObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualGroupKey;
        if (!key) {
          continue;
        }
        const nextHeight = Math.ceil(entry.contentRect.height);
        if (groupHeightsRef.current.get(key) !== nextHeight && nextHeight > 0) {
          groupHeightsRef.current.set(key, nextHeight);
          changed = true;
        }
      }
      if (changed) {
        setMeasuredVersion((value) => value + 1);
      }
    });

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    const validKeys = new Set(groups.map((group) => group.key));
    for (const key of Array.from(groupHeightsRef.current.keys())) {
      if (!validKeys.has(key)) {
        groupHeightsRef.current.delete(key);
      }
    }
  }, [groups]);

  const layout = useMemo(() => {
    const offsets: number[] = [];
    let totalHeight = 0;

    for (const group of groups) {
      offsets.push(totalHeight);
      totalHeight += groupHeightsRef.current.get(group.key) ?? estimateGroupHeight(group);
    }

    return { offsets, totalHeight };
  }, [groups, measuredVersion]);

  const visibleRange = useMemo(() => {
    const startBoundary = Math.max(0, scrollTop - OVERSCAN_PX);
    const endBoundary = scrollTop + viewportHeight + OVERSCAN_PX;

    let startIndex = 0;
    while (startIndex < groups.length) {
      const currentOffset = layout.offsets[startIndex];
      const currentGroup = groups[startIndex];
      if (currentOffset === undefined || !currentGroup) {
        break;
      }

      const currentHeight =
        groupHeightsRef.current.get(currentGroup.key) ?? estimateGroupHeight(currentGroup);
      if (currentOffset + currentHeight >= startBoundary) {
        break;
      }

      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < groups.length) {
      const currentOffset = layout.offsets[endIndex];
      if (currentOffset === undefined || currentOffset >= endBoundary) {
        break;
      }

      endIndex += 1;
    }

    return {
      endIndex: Math.min(groups.length, endIndex + 1),
      startIndex: Math.max(0, startIndex - 1),
    };
  }, [groups, layout.offsets, scrollTop, viewportHeight]);

  const setMeasuredElement = (key: string, element: HTMLDivElement | null) => {
    const previousElement = observedElementsRef.current.get(key);
    if (previousElement && resizeObserverRef.current) {
      resizeObserverRef.current.unobserve(previousElement);
      observedElementsRef.current.delete(key);
    }

    if (!element) {
      return;
    }

    observedElementsRef.current.set(key, element);

    const fallbackHeight = Math.ceil(element.getBoundingClientRect().height);
    if (fallbackHeight > 0 && groupHeightsRef.current.get(key) !== fallbackHeight) {
      groupHeightsRef.current.set(key, fallbackHeight);
      setMeasuredVersion((value) => value + 1);
    }

    resizeObserverRef.current?.observe(element);
  };

  const visibleGroups = groups.slice(visibleRange.startIndex, visibleRange.endIndex);

  return (
    <>
      <div
        data-testid="chat-virtualized-group-list"
        style={{
          position: 'relative',
          minHeight: layout.totalHeight,
        }}
      >
        {visibleGroups.map((group, index) => {
          const actualIndex = visibleRange.startIndex + index;

          return (
            <div
              key={group.key}
              data-virtual-group-key={group.key}
              ref={(element) => setMeasuredElement(group.key, element)}
              style={{
                position: 'absolute',
                top: layout.offsets[actualIndex] ?? 0,
                left: 0,
                right: 0,
              }}
            >
              <ChatGroupBlock
                activeModelId={activeModelId}
                activeModelLabel={activeModelLabel}
                activeProviderId={activeProviderId}
                currentUserEmail={currentUserEmail}
                group={group}
              />
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} style={{ height: 28, flexShrink: 0 }} />
    </>
  );
}

function ChatGroupBlock({
  activeModelId,
  activeModelLabel,
  activeProviderId,
  currentUserEmail,
  group,
}: {
  activeModelId: string;
  activeModelLabel?: string;
  activeProviderId: string;
  currentUserEmail: string;
  group: ChatRenderGroup;
}) {
  return (
    <div className="chat-message-group" data-role={group.role}>
      {group.entries.map((entry, entryIndex) => (
        <MessageRow
          key={entry.message.id}
          message={entry.message}
          providerId={entry.message.providerId?.trim() || activeProviderId}
          modelId={entry.message.model?.trim() || activeModelLabel || activeModelId}
          email={currentUserEmail}
          actions={entry.actions}
          groupedWithPrevious={entryIndex > 0}
          renderContent={entry.renderContent}
          sharedUiThemeVars={sharedUiThemeVars}
          usageDetails={entry.usageDetails}
        />
      ))}
    </div>
  );
}

function estimateGroupHeight(group: ChatRenderGroup): number {
  const contentChars = group.entries.reduce((sum, entry) => sum + entry.message.content.length, 0);
  const estimatedContentHeight = Math.min(540, Math.max(64, Math.ceil(contentChars / 90) * 18));
  const groupedHeaderPenalty = group.entries.length > 1 ? 28 : 0;

  return DEFAULT_GROUP_HEIGHT + estimatedContentHeight + groupedHeaderPenalty;
}
