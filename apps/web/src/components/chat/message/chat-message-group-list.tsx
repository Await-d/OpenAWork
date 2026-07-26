import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ChatUsageDetails } from '../../conversation-runtime/messages/support.js';
import { readAssistantTracePayload } from '../../conversation-runtime/messages/support.js';
import { CHAT_SCROLL_BOTTOM_SPACER_HEIGHT } from '../../../pages/chat-page/conversation/render/use-chat-scroll.js';
import {
  InlinePermissionQuickBar,
  MessageRow,
  type ResolveInlinePermissionActionsFn,
  sharedUiThemeVars,
} from '../session/ChatPageSections.js';
import { decideTimeDivider } from './time-divider.js';

export interface ChatRenderAction {
  id: string;
  label: string;
  onClick: () => void;
  title?: string;
}

export interface ChatIdentityOverride {
  color?: string;
  displayName: string;
  icon?: string;
  initials?: string;
}

export interface ChatRenderEntry {
  actions?: ChatRenderAction[];
  groupIdentityKey?: string;
  identityOverride?: ChatIdentityOverride;
  message: ChatMessage;
  presentationMode?: 'chat' | 'team';
  renderContent: (message: ChatMessage) => React.ReactNode;
  usageDetails?: ChatUsageDetails;
}

export interface ChatRenderGroup {
  actions?: ChatRenderAction[];
  entries: ChatRenderEntry[];
  key: string;
  role: ChatMessage['role'];
}

export interface ChatProviderDescriptor {
  id: string;
  name?: string;
  type?: string;
}

export interface InlinePermissionQuickBarPermission {
  requestId: string;
  toolName: string;
  reason: string;
  scope: string;
  riskLevel: string;
  previewAction?: string;
}

interface ChatMessageGroupListProps {
  activeModelId: string;
  activeModelLabel?: string;
  activeProviderId: string;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  currentUserDisplayName?: string;
  currentUserEmail: string;
  groups: ChatRenderGroup[];
  pendingPermissions?: InlinePermissionQuickBarPermission[];
  providerCatalog?: ReadonlyMap<string, ChatProviderDescriptor>;
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
}

const DEFAULT_GROUP_HEIGHT = 148;
const OVERSCAN_PX = 720;
const GROUP_GAP_PX = 24;
const TIME_DIVIDER_HEIGHT_PX = 28;
const VIRTUALIZATION_GROUP_THRESHOLD = 32;
const FALLBACK_VIEWPORT_HEIGHT = 720;
// Shared bottom-spacer height — see use-chat-scroll.ts for rationale.
// Importing here means the value is single-sourced; trimming it
// brings the latest message closer to the composer everywhere.

export function ChatMessageGroupList({
  activeModelId,
  activeModelLabel,
  activeProviderId,
  bottomRef,
  currentUserDisplayName,
  currentUserEmail,
  groups,
  pendingPermissions,
  providerCatalog,
  resolveInlinePermissionActions,
  scrollRegionRef,
}: ChatMessageGroupListProps) {
  const shouldVirtualize = groups.length >= VIRTUALIZATION_GROUP_THRESHOLD;
  const activePendingPermissions = pendingPermissions?.filter((p) => p.requestId) ?? [];
  const showQuickBar =
    activePendingPermissions.length > 0 && resolveInlinePermissionActions !== undefined;

  const dividerLabels = useMemo(() => computeDividerLabels(groups), [groups]);

  if (!shouldVirtualize) {
    return (
      <>
        {groups.map((group, groupIndex) => (
          <ChatGroupBlock
            key={group.key}
            activeModelId={activeModelId}
            activeModelLabel={activeModelLabel}
            activeProviderId={activeProviderId}
            currentUserDisplayName={currentUserDisplayName}
            currentUserEmail={currentUserEmail}
            group={group}
            providerCatalog={providerCatalog}
            timeDividerLabel={dividerLabels[groupIndex] ?? null}
          />
        ))}
        {showQuickBar && (
          <InlinePermissionQuickBar
            permissions={activePendingPermissions}
            resolveActions={resolveInlinePermissionActions}
          />
        )}
        <div ref={bottomRef} style={{ height: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT, flexShrink: 0 }} />
      </>
    );
  }

  return (
    <VirtualizedChatGroupViewport
      activeModelId={activeModelId}
      activeModelLabel={activeModelLabel}
      activeProviderId={activeProviderId}
      bottomRef={bottomRef}
      currentUserDisplayName={currentUserDisplayName}
      currentUserEmail={currentUserEmail}
      dividerLabels={dividerLabels}
      groups={groups}
      pendingPermissions={activePendingPermissions}
      providerCatalog={providerCatalog}
      resolveInlinePermissionActions={showQuickBar ? resolveInlinePermissionActions : undefined}
      scrollRegionRef={scrollRegionRef}
    />
  );
}

function computeDividerLabels(groups: ChatRenderGroup[]): Array<string | null> {
  const now = Date.now();
  const labels: Array<string | null> = [];
  let previousTs: number | null = null;

  for (const group of groups) {
    const ts = readGroupTimestamp(group);
    const decision = decideTimeDivider(ts, previousTs, now);
    labels.push(decision.show ? decision.label : null);
    if (ts != null && Number.isFinite(ts)) {
      previousTs = ts;
    }
  }

  return labels;
}

function readGroupTimestamp(group: ChatRenderGroup): number | null {
  const first = group.entries[0]?.message;
  if (!first) return null;
  const raw = first.createdAt;
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  // createdAt may also arrive as ISO string from older payloads.
  const parsed = Date.parse(raw as unknown as string);
  return Number.isFinite(parsed) ? parsed : null;
}

function VirtualizedChatGroupViewport({
  activeModelId,
  activeModelLabel,
  activeProviderId,
  bottomRef,
  currentUserDisplayName,
  currentUserEmail,
  dividerLabels,
  groups,
  pendingPermissions,
  providerCatalog,
  resolveInlinePermissionActions,
  scrollRegionRef,
}: ChatMessageGroupListProps & { dividerLabels: Array<string | null> }) {
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const groupHeightsRef = useRef(new Map<string, number>());
  const nodeMapRef = useRef(new Map<string, HTMLDivElement>());
  const nodeRefCallbackMapRef = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
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
        if (nextHeight > 0 && groupHeightsRef.current.get(key) !== nextHeight) {
          groupHeightsRef.current.set(key, nextHeight);
          changed = true;
        }
      }

      if (changed) {
        setMeasuredVersion((value) => value + 1);
      }
    });

    for (const element of nodeMapRef.current.values()) {
      resizeObserverRef.current.observe(element);
    }

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    const validKeys = new Set(groups.map((group) => group.key));
    for (const [key, element] of Array.from(nodeMapRef.current.entries())) {
      if (!validKeys.has(key)) {
        resizeObserverRef.current?.unobserve(element);
        nodeMapRef.current.delete(key);
        nodeRefCallbackMapRef.current.delete(key);
        groupHeightsRef.current.delete(key);
      }
    }
  }, [groups]);

  const measurementVersion = measuredVersion;
  const layout = useMemo(() => {
    const offsets: number[] = [];
    let totalHeight = 0;

    void measurementVersion;

    groups.forEach((group, i) => {
      offsets.push(totalHeight);
      const dividerExtra = dividerLabels[i] ? TIME_DIVIDER_HEIGHT_PX : 0;
      totalHeight +=
        (groupHeightsRef.current.get(group.key) ?? estimateGroupHeight(group)) +
        dividerExtra +
        GROUP_GAP_PX;
    });

    return {
      offsets,
      totalHeight: totalHeight > 0 ? totalHeight - GROUP_GAP_PX : 0,
    };
  }, [groups, measurementVersion, dividerLabels]);

  const visibleRange = useMemo(() => {
    const startBoundary = Math.max(0, scrollTop - OVERSCAN_PX);
    const endBoundary = scrollTop + viewportHeight + OVERSCAN_PX;

    let startIndex = 0;
    while (startIndex < groups.length) {
      const key = groups[startIndex]?.key;
      const height = key
        ? (groupHeightsRef.current.get(key) ?? estimateGroupHeight(groups[startIndex]!))
        : 0;
      if ((layout.offsets[startIndex] ?? 0) + height >= startBoundary) {
        break;
      }
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < groups.length && (layout.offsets[endIndex] ?? 0) <= endBoundary) {
      endIndex += 1;
    }

    return {
      endIndex: Math.min(groups.length, endIndex + 1),
      startIndex: Math.max(0, startIndex - 1),
    };
  }, [groups, layout.offsets, scrollTop, viewportHeight]);

  const getMeasuredNodeRef = useCallback((key: string) => {
    const existing = nodeRefCallbackMapRef.current.get(key);
    if (existing) {
      return existing;
    }

    const callback = (element: HTMLDivElement | null) => {
      const previousElement = nodeMapRef.current.get(key);
      if (previousElement && previousElement !== element) {
        resizeObserverRef.current?.unobserve(previousElement);
        nodeMapRef.current.delete(key);
      }

      if (!element) {
        return;
      }

      nodeMapRef.current.set(key, element);

      // Immediately measure on mount. Relying only on ResizeObserver can leave
      // the first paint on estimate heights — common when a long history jumps
      // to the bottom and the top-of-list groups briefly enter the overscan
      // window before true heights are known. That mismatch is the main cause
      // of the occasional "first message is scrambled until refresh" bug.
      const measuredHeight = Math.ceil(element.getBoundingClientRect().height);
      if (measuredHeight > 0 && groupHeightsRef.current.get(key) !== measuredHeight) {
        groupHeightsRef.current.set(key, measuredHeight);
        setMeasuredVersion((value) => value + 1);
      }

      resizeObserverRef.current?.observe(element);
    };

    nodeRefCallbackMapRef.current.set(key, callback);
    return callback;
  }, []);

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
              ref={getMeasuredNodeRef(group.key)}
              style={{
                position: 'absolute',
                top: layout.offsets[actualIndex] ?? 0,
                left: 0,
                right: 0,
                // Do not clip content while heights are still settling.
                // Clipping against a stale estimate is what makes the first
                // (and other) messages look scrambled until a full remount.
                overflow: 'visible',
              }}
            >
              <ChatGroupBlock
                activeModelId={activeModelId}
                activeModelLabel={activeModelLabel}
                activeProviderId={activeProviderId}
                currentUserDisplayName={currentUserDisplayName}
                currentUserEmail={currentUserEmail}
                group={group}
                providerCatalog={providerCatalog}
                timeDividerLabel={dividerLabels[actualIndex] ?? null}
              />
            </div>
          );
        })}
      </div>
      {pendingPermissions && pendingPermissions.length > 0 && resolveInlinePermissionActions && (
        <InlinePermissionQuickBar
          permissions={pendingPermissions}
          resolveActions={resolveInlinePermissionActions}
        />
      )}
      <div ref={bottomRef} style={{ height: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT, flexShrink: 0 }} />
    </>
  );
}

const ChatGroupBlock = React.memo(function ChatGroupBlock({
  activeModelId,
  activeModelLabel,
  activeProviderId,
  currentUserDisplayName,
  currentUserEmail,
  group,
  providerCatalog,
  timeDividerLabel,
}: {
  activeModelId: string;
  activeModelLabel?: string;
  activeProviderId: string;
  currentUserDisplayName?: string;
  currentUserEmail: string;
  group: ChatRenderGroup;
  providerCatalog?: ReadonlyMap<string, ChatProviderDescriptor>;
  timeDividerLabel?: string | null;
}) {
  return (
    <div
      className="chat-message-group"
      data-chat-group-root="true"
      data-group-key={group.key}
      data-role={group.role}
    >
      {timeDividerLabel ? <TimeDividerRow label={timeDividerLabel} /> : null}
      {group.entries.map((entry, entryIndex) => {
        const resolvedProviderId = entry.message.providerId?.trim() || activeProviderId;
        const resolvedProvider = resolvedProviderId
          ? providerCatalog?.get(resolvedProviderId)
          : undefined;

        return (
          <MessageRow
            key={entry.message.id}
            message={entry.message}
            providerId={resolvedProviderId}
            providerName={resolvedProvider?.name}
            providerType={resolvedProvider?.type}
            modelId={entry.message.model?.trim() || activeModelLabel || activeModelId}
            email={currentUserEmail}
            currentUserDisplayName={currentUserDisplayName}
            actions={entryIndex === 0 ? (group.actions ?? entry.actions) : entry.actions}
            groupedWithPrevious={entryIndex > 0}
            identityOverride={entry.identityOverride}
            presentationMode={entry.presentationMode ?? 'chat'}
            renderContent={entry.renderContent}
            sharedUiThemeVars={sharedUiThemeVars}
            usageDetails={entry.usageDetails}
          />
        );
      })}
    </div>
  );
});

function TimeDividerRow({ label }: { label: string }) {
  return (
    <div className="chat-time-divider" aria-hidden="true">
      <span className="chat-time-divider-line" />
      <span className="chat-time-divider-label">{label}</span>
      <span className="chat-time-divider-line" />
    </div>
  );
}

function estimateGroupHeight(group: ChatRenderGroup): number {
  let estimatedContentHeight = 0;
  let extraHeaderHeight = 0;

  for (let entryIndex = 0; entryIndex < group.entries.length; entryIndex++) {
    const entry = group.entries[entryIndex]!;
    const message = entry.message;

    if (entryIndex > 0) {
      extraHeaderHeight += 28;
    }

    // Try to parse assistant trace content for a more accurate estimate.
    const trace = readAssistantTracePayload(message);
    if (trace) {
      // Text content
      const textChars = trace.text.length;
      estimatedContentHeight += Math.min(360, Math.max(48, Math.ceil(textChars / 90) * 18));

      // Reasoning blocks — each rendered as a collapsible section
      if (trace.reasoningBlocks) {
        for (const block of trace.reasoningBlocks) {
          estimatedContentHeight += Math.min(200, Math.max(40, Math.ceil(block.length / 90) * 18));
        }
      }

      // Tool calls — each rendered as a card with header + collapsible body
      if (trace.toolCalls.length > 0) {
        estimatedContentHeight += trace.toolCalls.length * 120;
      }
    } else {
      // Plain text content
      const contentChars = message.content.length;
      estimatedContentHeight += Math.min(540, Math.max(64, Math.ceil(contentChars / 90) * 18));
    }
  }

  return DEFAULT_GROUP_HEIGHT + estimatedContentHeight + extraHeaderHeight;
}
