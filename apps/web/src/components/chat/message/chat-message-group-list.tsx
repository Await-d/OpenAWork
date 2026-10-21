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
import MarkdownMessageContent from '../markdown/markdown-message-content.js';
import { setElementScrollTop } from '../../../utils/dom/scroll.js';
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
  /**
   * 一次性「滚动到指定历史消息」请求（`nonce` 变化即视为新请求）。虚拟化下
   * 目标组可能仍在挂载窗口之外——此时调用方的 `scrollIntoView` 会因查不到
   * 节点而静默失效，本组件按目标组偏移先粗滚动一次，把目标带进 overscan 窗口。
   */
  pendingMessageScroll?: { messageId: string; nonce: number } | null;
  pendingPermissions?: InlinePermissionQuickBarPermission[];
  providerCatalog?: ReadonlyMap<string, ChatProviderDescriptor>;
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  trailingContent?: React.ReactNode;
  /**
   * 点击子代理通知行时打开对应子会话。
   *
   * **必须由本组件显式透传给 `ChatGroupBlock`**：调用方（`ChatConversationView`）
   * 是用 JSX 展开传进来的，而 JSX 展开不做多余属性检查——props 未声明/未透传时
   * 不会报类型错误，只会让通知行的 `onOpenChild` 恒为 undefined（整行点不动）。
   */
  onOpenSubagentChild?: (childSessionId: string) => void;
}

const DEFAULT_GROUP_HEIGHT = 148;
const OVERSCAN_PX = 720;
const GROUP_GAP_PX = 24;
const TIME_DIVIDER_HEIGHT_PX = 28;
const VIRTUALIZATION_GROUP_THRESHOLD = 32;
/**
 * 单例 ResizeObserver 的槽位键：每个组件实例各持一份缓存 Map，键只作占位。
 */
const RESIZE_OBSERVER_SLOT = 'viewport';

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
  pendingMessageScroll,
  pendingPermissions,
  providerCatalog,
  onOpenSubagentChild,
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
            {...(onOpenSubagentChild ? { onOpenSubagentChild } : {})}
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
      pendingMessageScroll={pendingMessageScroll}
      pendingPermissions={activePendingPermissions}
      providerCatalog={providerCatalog}
      resolveInlinePermissionActions={showQuickBar ? resolveInlinePermissionActions : undefined}
      scrollRegionRef={scrollRegionRef}
      trailingContent={trailingContent}
      {...(onOpenSubagentChild ? { onOpenSubagentChild } : {})}
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
  pendingMessageScroll,
  pendingPermissions,
  providerCatalog,
  resolveInlinePermissionActions,
  scrollRegionRef,
  trailingContent,
  onOpenSubagentChild,
}: ChatMessageGroupListProps & { dividerLabels: Array<string | null> }) {
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredVersion, setMeasuredVersion] = useState(0);
  // 布局测量缓存。**不得用 useRef 承载**：`layout` / `visibleRange` 两个 useMemo 与
  // ref 回调工厂都必须在渲染期读取它们，而 React Compiler 一旦见到「渲染期读 ref」
  // 就放弃优化整个组件（`Cannot access refs during render`）。
  // `useState` 惰性初始化给出的是一个**身份恒定**的可变容器，读写时机、可变性与原
  // ref 逐点相同——首渲染同样从空 Map 开始，只是不再经过 `ref.current` 这层被编译器
  // 拦截的间接寻址。名称也不再以 `Ref` 结尾，否则会被编译器的「ref 按名字推断」
  // （`enableTreatRefLikeIdentifiersAsRefs`）再次判为渲染期访问 ref。
  const [groupHeightsCache] = useState(() => new Map<string, number>());
  const [groupSignaturesCache] = useState(() => new Map<string, string>());
  const groupContentMetricsRef = useRef(new Map<string, GroupContentMetrics>());
  const [nodeCache] = useState(() => new Map<string, HTMLDivElement>());
  const [nodeCallbackCache] = useState(
    () => new Map<string, (element: HTMLDivElement | null) => void>(),
  );
  const [resizeObserverCache] = useState(() => new Map<string, ResizeObserver>());

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

    const observer = new ResizeObserver((entries) => {
      let changed = false;

      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualGroupKey;
        if (!key) {
          continue;
        }

        const nextHeight = Math.ceil(entry.contentRect.height);
        if (nextHeight > 0 && groupHeightsCache.get(key) !== nextHeight) {
          groupHeightsCache.set(key, nextHeight);
          changed = true;
        }
      }

      if (changed) {
        setMeasuredVersion((value) => value + 1);
      }
    });
    // 观察器同样改由 state 缓存承载（而不是 useRef）：交给 `ref=` 的节点回调在提交期
    // 需要它来 observe / unobserve，而编译器把「ref 属性值可达范围内的 ref 读取」判成
    // 渲染期访问 ref，整个组件会因此退出优化。实例生命周期与原来完全一致。
    resizeObserverCache.set(RESIZE_OBSERVER_SLOT, observer);

    for (const element of nodeCache.values()) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      resizeObserverCache.delete(RESIZE_OBSERVER_SLOT);
    };
  }, []);

  useEffect(() => {
    const validKeys = new Set(groups.map((group) => group.key));
    let changed = false;

    for (const group of groups) {
      const signature = getGroupLayoutSignature(group);
      const metrics = readGroupContentMetrics(group);
      const previousSignature = groupSignaturesCache.get(group.key);

      if (previousSignature !== undefined && previousSignature !== signature) {
        const previousMetrics = groupContentMetricsRef.current.get(group.key);
        const shrank =
          previousMetrics !== undefined && metrics.contentWeight < previousMetrics.contentWeight;
        const statusChanged =
          previousMetrics !== undefined && metrics.statuses !== previousMetrics.statuses;

        // 内容缩水或状态跃迁（流式结束、折叠生效、编辑截断）时旧实测可能偏大，必须丢弃重测；
        // 仅内容增长时保留旧实测作为下界，供屏幕内的组继续沿用并由 RO 纠正。
        if (shrank || statusChanged) {
          groupHeightsCache.delete(group.key);
        }
        changed = true;
      }

      groupSignaturesCache.set(group.key, signature);
      groupContentMetricsRef.current.set(group.key, metrics);
    }

    for (const [key, element] of Array.from(nodeCache.entries())) {
      if (!validKeys.has(key)) {
        resizeObserverCache.get(RESIZE_OBSERVER_SLOT)?.unobserve(element);
        nodeCache.delete(key);
        nodeCallbackCache.delete(key);
        groupHeightsCache.delete(key);
        groupSignaturesCache.delete(key);
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
        hasObservedNode: nodeCache.has(group.key),
        measuredHeight: groupHeightsCache.get(group.key),
        signatureMatches: groupSignaturesCache.get(group.key) === signature,
      });
      totalHeight += height + dividerExtra + GROUP_GAP_PX;
    });

    return {
      offsets,
      totalHeight: totalHeight > 0 ? totalHeight - GROUP_GAP_PX : 0,
    };
    // 三个缓存身份恒定（useState 惰性初始化），列进依赖只为让 React Compiler 能保留
    // 这个手写 useMemo；运行时身份不变，等价于永不额外触发重算。
  }, [
    groups,
    measurementVersion,
    dividerLabels,
    groupSignaturesCache,
    groupHeightsCache,
    nodeCache,
  ]);

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
            hasObservedNode: key !== undefined && nodeCache.has(key),
            measuredHeight: key === undefined ? undefined : groupHeightsCache.get(key),
            signatureMatches: key !== undefined && groupSignaturesCache.get(key) === signature,
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
  }, [
    groups,
    layout.offsets,
    scrollTop,
    viewportHeight,
    // 同 layout：仅为编译器保留手写 memo，运行时身份恒定。
    groupSignaturesCache,
    groupHeightsCache,
    nodeCache,
  ]);

  const getMeasuredNodeRef = useCallback(
    (key: string) => {
      const existing = nodeCallbackCache.get(key);
      if (existing) {
        return existing;
      }

      const callback = (element: HTMLDivElement | null) => {
        const previousElement = nodeCache.get(key);
        if (previousElement && previousElement !== element) {
          resizeObserverCache.get(RESIZE_OBSERVER_SLOT)?.unobserve(previousElement);
          nodeCache.delete(key);
        }

        if (!element) {
          return;
        }

        nodeCache.set(key, element);

        // Immediately measure on mount. Relying only on ResizeObserver can leave
        // the first paint on estimate heights — common when a long history jumps
        // to the bottom and the top-of-list groups briefly enter the overscan
        // window before true heights are known. That mismatch is the main cause
        // of the occasional "first message is scrambled until refresh" bug.
        const measuredHeight = Math.ceil(element.getBoundingClientRect().height);
        if (measuredHeight > 0 && groupHeightsCache.get(key) !== measuredHeight) {
          groupHeightsCache.set(key, measuredHeight);
          setMeasuredVersion((value) => value + 1);
        }

        resizeObserverCache.get(RESIZE_OBSERVER_SLOT)?.observe(element);
      };

      nodeCallbackCache.set(key, callback);
      return callback;
      // 回调体读的缓存/观察器都是身份恒定的 state 容器，列进依赖只为让编译器
      // 保留这个手写 useCallback（否则回调每次渲染换身份 → ref 回调反复装卸）。
    },
    [nodeCallbackCache, nodeCache, groupHeightsCache, resizeObserverCache],
  );

  const visibleGroups = groups.slice(visibleRange.startIndex, visibleRange.endIndex);

  // 一次性「滚动到目标消息」：历史跳转 / 搜索扩窗后，目标组可能仍在挂载窗口
  // 之外（离屏组不渲染节点），调用方的 `scrollIntoView` 会因查不到节点而静默
  // 失效，视口就会停在无关位置。这里按目标组的布局偏移粗滚动一次，把目标带进
  // overscan 窗口；节点挂载后由调用方（jump list / search）精确居中并高亮。
  const handledMessageScrollNonceRef = useRef(0);
  useEffect(() => {
    const request = pendingMessageScroll;
    if (!request || request.nonce === handledMessageScrollNonceRef.current) return;

    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion || scrollRegion.clientHeight === 0) return;

    const targetIndex = groups.findIndex(
      (group) =>
        group.kind === 'messages' &&
        group.entries.some((entry) => entry.message.id === request.messageId),
    );
    // 目标还没进入当前渲染窗口（扩窗尚未落地）：保留请求，等下一次渲染再试。
    if (targetIndex < 0) return;

    handledMessageScrollNonceRef.current = request.nonce;

    const targetTop = layout.offsets[targetIndex] ?? 0;
    const targetBottom = layout.offsets[targetIndex + 1] ?? layout.totalHeight;
    const desiredTop = targetTop + (targetBottom - targetTop) / 2 - scrollRegion.clientHeight / 2;
    const maxTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight);
    // scrollRegion 来自 props 传入的 ref，直接写 scrollTop 会让本组件整体退出
    // React Compiler 优化，故走收敛函数（见 utils/dom/scroll.ts）。
    setElementScrollTop(scrollRegion, Math.max(0, Math.min(desiredTop, maxTop)));
  }, [groups, layout, pendingMessageScroll, scrollRegionRef]);

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
                {...(onOpenSubagentChild ? { onOpenSubagentChild } : {})}
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

/**
 * 子代理结果卡片正文的渲染器：注入给 shared-ui 的 `SubagentNoticeRow`，
 * 让 `answer` / `raw` 正文按 Markdown 渲染（`<results>` 分节已在通知侧解析，
 * 这里渲染的是纯正文）。模块级函数引用天然稳定，不破坏结果卡片的 memo。
 */
function renderSubagentResultBody(markdown: string): React.ReactNode {
  return <MarkdownMessageContent content={markdown} />;
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
        {/* 通知行复用消息行的列结构（占位头像 + 同一条 flex gap），
            保证通知文本与相邻消息的**内容列**左对齐；窄屏下 gap 收窄也自动跟随，
            避免再写死一个 40px 缩进。 */}
        <div className="chat-message-row chat-message-row--notice" data-role="synthetic">
          <div className="chat-message-avatar-frame" aria-hidden="true">
            <div className="chat-message-avatar-spacer" />
          </div>
          <div className="chat-message-main">
            <SubagentNoticeRow
              notice={group.notice}
              renderBody={renderSubagentResultBody}
              {...(onOpenSubagentChild ? { onOpenChild: onOpenSubagentChild } : {})}
            />
          </div>
        </div>
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

/**
 * 组布局签名 / 内容度量 / 单条消息高度估算的弱缓存。
 *
 * 虚拟化列表每帧都要为**全表**重算这三样（`layout` 与 `visibleRange` 各一遍，加上
 * 同步签名的 effect），而组对象与消息对象在发布后都是不可变的（entries 不原地修改，
 * 消息更新走新对象），按引用缓存安全且命中率接近 100%。
 *
 * 实测背景：`estimateGroupHeight` 内部会对每条消息调用 `readAssistantTracePayload`
 * （带 parts 的消息要重建 trace、无 parts 的老消息要 `JSON.parse` 整段 content），
 * 原实现每帧两次全表执行——长会话 + 工具输出多时，这是纯浪费的每帧线性成本。
 */
const groupContentMetricsCache = new WeakMap<ChatRenderGroup, GroupContentMetrics>();
const groupLayoutSignatureCache = new WeakMap<ChatRenderGroup, string>();
const messageHeightEstimateCache = new WeakMap<ChatRenderEntry['message'], number>();

function readGroupContentMetrics(group: ChatRenderGroup): GroupContentMetrics {
  const cached = groupContentMetricsCache.get(group);
  if (cached !== undefined) {
    return cached;
  }

  let metrics: GroupContentMetrics;
  if (group.kind === 'subagent-notice') {
    // 通知行是固定高度的单行，内容权重只用于高度估算的兜底。
    metrics = { contentWeight: 0, statuses: group.notice.state };
  } else {
    let contentWeight = 0;
    const statuses: string[] = [];

    for (const entry of group.entries) {
      const message = entry.message;
      contentWeight += message.content.length;
      contentWeight += (message.parts?.length ?? 0) * 64;
      contentWeight += (message.modifiedFilesSummary?.files.length ?? 0) * 16;
      statuses.push(message.status ?? '');
    }

    metrics = { contentWeight, statuses: statuses.join('|') };
  }

  groupContentMetricsCache.set(group, metrics);
  return metrics;
}

function getGroupLayoutSignature(group: ChatRenderGroup): string {
  const cached = groupLayoutSignatureCache.get(group);
  if (cached !== undefined) {
    return cached;
  }

  let signature: string;
  if (group.kind === 'subagent-notice') {
    signature = `notice:${group.notice.id}:${group.notice.state}:${group.notice.description}`;
  } else {
    signature = group.entries
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

  groupLayoutSignatureCache.set(group, signature);
  return signature;
}

function estimateMessageContentHeight(message: ChatRenderEntry['message']): number {
  const cached = messageHeightEstimateCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  let height = 0;
  // Try to parse assistant trace content for a more accurate estimate.
  const trace = readAssistantTracePayload(message);
  if (trace) {
    // Text content
    const textChars = trace.text.length;
    height += Math.min(360, Math.max(48, Math.ceil(textChars / 90) * 18));

    // Reasoning blocks — each rendered as a collapsible section
    if (trace.reasoningBlocks) {
      for (const block of trace.reasoningBlocks) {
        height += Math.min(200, Math.max(40, Math.ceil(block.length / 90) * 18));
      }
    }

    // Tool calls — each rendered as a card with header + collapsible body
    if (trace.toolCalls.length > 0) {
      height += trace.toolCalls.length * 120;
    }
  } else {
    // Plain text content
    const contentChars = message.content.length;
    height += Math.min(540, Math.max(64, Math.ceil(contentChars / 90) * 18));
  }

  messageHeightEstimateCache.set(message, height);
  return height;
}

function estimateGroupHeight(group: ChatRenderGroup): number {
  if (group.kind === 'subagent-notice') {
    // 单行紧凑通知：行高 16px + 上下各 8px padding + 8px 兜底。
    return 16 + 8 + 8 + 8;
  }

  let estimatedContentHeight = 0;
  let extraHeaderHeight = 0;

  for (let entryIndex = 0; entryIndex < group.entries.length; entryIndex++) {
    const entry = group.entries[entryIndex]!;

    if (entryIndex > 0) {
      extraHeaderHeight += 28;
    }

    estimatedContentHeight += estimateMessageContentHeight(entry.message);
  }

  return DEFAULT_GROUP_HEIGHT + estimatedContentHeight + extraHeaderHeight;
}
