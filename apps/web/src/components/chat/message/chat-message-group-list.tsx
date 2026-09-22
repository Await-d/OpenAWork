import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SubagentNotice } from '@openAwork/shared';
import { SubagentNoticeRow } from '@openAwork/shared-ui';
import type { ChatMessage, ChatUsageDetails } from '../../conversation-runtime/messages/support.js';
import { readAssistantTracePayload } from '../../conversation-runtime/messages/support.js';
import { CHAT_SCROLL_BOTTOM_SPACER_HEIGHT } from '../../conversation-runtime/scroll/scroll-constants.js';
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

/**
 * 渲染群组 = 判别联合。`kind` 必填，因此**每个**访问 `.entries` / `.role` 的消费者
 * 都必须显式窄化——这给了编译期保护，避免新增群组类型时被静默当成消息组处理
 * （本仓历史上多次出现的「静默错位」失效模式）。
 *
 * `subagent-notice` 群组承载网关注入的子代理完成通知（`role: 'synthetic'`），
 * 对齐 opencode 把 notice 作为时间线行渲染的语义；它**不是**聊天气泡，
 * 因此不进入 `ChatMessage[]`、也不触碰 role 分支密集的消息渲染层。
 */
export interface ChatRenderMessageGroup {
  kind: 'messages';
  actions?: ChatRenderAction[];
  entries: ChatRenderEntry[];
  key: string;
  role: ChatMessage['role'];
}

export interface ChatRenderNoticeGroup {
  kind: 'subagent-notice';
  /** 与消息组同一时间轴，用于按位置排序。 */
  createdAt: number;
  key: string;
  notice: SubagentNotice;
}

export type ChatRenderGroup = ChatRenderMessageGroup | ChatRenderNoticeGroup;

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
  trailingContent?: React.ReactNode;
}

const DEFAULT_GROUP_HEIGHT = 148;
const OVERSCAN_PX = 720;
const GROUP_GAP_PX = 24;
const TIME_DIVIDER_HEIGHT_PX = 28;
const VIRTUALIZATION_GROUP_THRESHOLD = 32;
const FALLBACK_VIEWPORT_HEIGHT = 720;
// Shared bottom-spacer height — see scroll-constants.ts for rationale.
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
  trailingContent,
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
        {trailingContent}
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
      trailingContent={trailingContent}
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
  if (group.kind === 'subagent-notice') {
    return group.createdAt;
  }
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
  trailingContent,
}: ChatMessageGroupListProps & { dividerLabels: Array<string | null> }) {
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const groupHeightsRef = useRef(new Map<string, number>());
  const groupSignaturesRef = useRef(new Map<string, string>());
  const groupContentMetricsRef = useRef(new Map<string, GroupContentMetrics>());
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
    let changed = false;

    for (const group of groups) {
      const signature = getGroupLayoutSignature(group);
      const metrics = readGroupContentMetrics(group);
      const previousSignature = groupSignaturesRef.current.get(group.key);

      if (previousSignature !== undefined && previousSignature !== signature) {
        const previousMetrics = groupContentMetricsRef.current.get(group.key);
        const shrank =
          previousMetrics !== undefined && metrics.contentWeight < previousMetrics.contentWeight;
        const statusChanged =
          previousMetrics !== undefined && metrics.statuses !== previousMetrics.statuses;

        // 内容缩水或状态跃迁（流式结束、折叠生效、编辑截断）时旧实测可能偏大，必须丢弃重测；
        // 仅内容增长时保留旧实测作为下界，供屏幕内的组继续沿用并由 RO 纠正。
        if (shrank || statusChanged) {
          groupHeightsRef.current.delete(group.key);
        }
        changed = true;
      }

      groupSignaturesRef.current.set(group.key, signature);
      groupContentMetricsRef.current.set(group.key, metrics);
    }

    for (const [key, element] of Array.from(nodeMapRef.current.entries())) {
      if (!validKeys.has(key)) {
        resizeObserverRef.current?.unobserve(element);
        nodeMapRef.current.delete(key);
        nodeRefCallbackMapRef.current.delete(key);
        groupHeightsRef.current.delete(key);
        groupSignaturesRef.current.delete(key);
        groupContentMetricsRef.current.delete(key);
      }
    }

    if (changed) {
      setMeasuredVersion((value) => value + 1);
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
      const signature = getGroupLayoutSignature(group);
      const height = resolveGroupHeight({
        estimateHeight: estimateGroupHeight(group),
        hasObservedNode: nodeMapRef.current.has(group.key),
        measuredHeight: groupHeightsRef.current.get(group.key),
        signatureMatches: groupSignaturesRef.current.get(group.key) === signature,
      });
      totalHeight += height + dividerExtra + GROUP_GAP_PX;
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
      const group = groups[startIndex];
      const signature = group ? getGroupLayoutSignature(group) : '';
      const height = group
        ? resolveGroupHeight({
            estimateHeight: estimateGroupHeight(group),
            hasObservedNode: key !== undefined && nodeMapRef.current.has(key),
            measuredHeight: key === undefined ? undefined : groupHeightsRef.current.get(key),
            signatureMatches:
              key !== undefined && groupSignaturesRef.current.get(key) === signature,
          })
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
      {trailingContent}
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
  onOpenSubagentChild,
  providerCatalog,
  timeDividerLabel,
}: {
  activeModelId: string;
  activeModelLabel?: string;
  activeProviderId: string;
  currentUserDisplayName?: string;
  currentUserEmail: string;
  group: ChatRenderGroup;
  /** 点击子代理通知时打开对应子会话；未传入时通知行不可点击。 */
  onOpenSubagentChild?: (childSessionId: string) => void;
  providerCatalog?: ReadonlyMap<string, ChatProviderDescriptor>;
  timeDividerLabel?: string | null;
}) {
  if (group.kind === 'subagent-notice') {
    return (
      <div
        className="chat-message-group"
        data-chat-group-root="true"
        data-group-key={group.key}
        data-role="synthetic"
      >
        {timeDividerLabel ? <TimeDividerRow label={timeDividerLabel} /> : null}
        <SubagentNoticeRow
          notice={group.notice}
          {...(onOpenSubagentChild ? { onOpenChild: onOpenSubagentChild } : {})}
        />
      </div>
    );
  }

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

// 分组布局高度的解析输入：由布局 useMemo 组装，纯函数便于单测。
export interface ResolveGroupHeightInput {
  /** 该组当前是否有已挂载并纳入 ResizeObserver 观测的 DOM 节点。 */
  hasObservedNode: boolean;
  /** 当前内容签名是否与上一次一致（一致说明实测高度仍然可信）。 */
  signatureMatches: boolean;
  /** 上一次的实测高度，可能不存在。 */
  measuredHeight: number | undefined;
  /** 封顶估算高度，仅在实测不可信时使用。 */
  estimateHeight: number;
}

export function resolveGroupHeight(input: ResolveGroupHeightInput): number {
  const { estimateHeight, hasObservedNode, measuredHeight, signatureMatches } = input;

  if (signatureMatches) {
    return measuredHeight ?? estimateHeight;
  }

  // 签名不一致但该组当前有已挂载、被 RO 观测的节点时，仍然沿用上一次实测高度：
  // 屏幕内的组永远有 DOM，ResizeObserver 会在任何真实尺寸变化时纠正它；
  // 若此时退回封顶估算，后续所有组的偏移都会整体上移并发生重叠。
  // 离屏组（无节点）仍然走签名门禁，因为其实测高度可能已经过期。
  if (hasObservedNode && measuredHeight !== undefined) {
    return measuredHeight;
  }

  return estimateHeight;
}

interface GroupContentMetrics {
  contentWeight: number;
  statuses: string;
}

function readGroupContentMetrics(group: ChatRenderGroup): GroupContentMetrics {
  if (group.kind === 'subagent-notice') {
    // 通知行是固定高度的单行，内容权重只用于高度估算的兜底。
    return { contentWeight: 0, statuses: group.notice.state };
  }

  let contentWeight = 0;
  const statuses: string[] = [];

  for (const entry of group.entries) {
    const message = entry.message;
    contentWeight += message.content.length;
    contentWeight += (message.parts?.length ?? 0) * 64;
    contentWeight += (message.modifiedFilesSummary?.files.length ?? 0) * 16;
    statuses.push(message.status ?? '');
  }

  return { contentWeight, statuses: statuses.join('|') };
}

function getGroupLayoutSignature(group: ChatRenderGroup): string {
  if (group.kind === 'subagent-notice') {
    return `notice:${group.notice.id}:${group.notice.state}:${group.notice.description}`;
  }

  return group.entries
    .map((entry) => {
      const message = entry.message;
      return [
        message.id,
        message.status ?? '',
        message.content.length,
        message.parts?.length ?? 0,
        message.modifiedFilesSummary?.files.length ?? 0,
      ].join(':');
    })
    .join('|');
}

function estimateGroupHeight(group: ChatRenderGroup): number {
  if (group.kind === 'subagent-notice') {
    // 单行紧凑通知：13px 文字 + 上 12px / 下 4px padding。
    return 16 + 12 + 4 + 8;
  }

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
