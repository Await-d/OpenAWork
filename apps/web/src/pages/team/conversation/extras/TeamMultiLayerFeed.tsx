/**
 * TeamMultiLayerFeed · 混合模式多层级消息流
 *
 * 方案 C：默认「全部层级」合并时间线，可切换到单层级视图。
 * 使用 ChatMessageGroupList 组件渲染消息（与 chat / 主对话区完全一致），
 * 通过 identityOverride 标注每条消息所属的层级身份。
 *
 * 布局：
 *   - 顶部：层级 Tab 栏（全部 + 各层级），显示消息计数
 *   - 消息流：ChatMessageGroupList 完整渲染（markdown、工具调用、推理折叠等）
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type {
  ChatRenderAction,
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../../../components/chat/message/chat-message-group-list.js';
import { ChatMessageGroupList } from '../../../../components/chat/message/chat-message-group-list.js';
import { renderChatMessageContentWithOptions } from '../../../../components/chat/session/ChatPageSections.js';
import { groupChatRenderEntries } from '../../../../components/conversation-runtime/messages/group-render-entries.js';
import {
  getRoleLayerIdentity,
  getRoleLayerIdentityFromAgentId,
} from '../../runtime/data/role-layer-identity.js';
import type { LayerMessages } from './TeamMultiLayerPanel.js';

export interface TeamMultiLayerFeedProps {
  /** 当前活跃层级（高亮标识）。 */
  activeLayer?: string | null;
  /** 当前主会话 id。 */
  currentSessionId?: string | null;
  /** 所有层级消息数据。 */
  layers: LayerMessages[];
  /** provider 信息（传给 ChatMessageGroupList）。 */
  activeModelId: string;
  activeModelLabel?: string;
  activeProviderId: string;
  providerCatalog: Map<string, { id: string; name: string; type: string }>;
  currentUserEmail: string;
  currentUserDisplayName?: string;
  /**
   * 可选的外部 scrollRegionRef —— 仅用于与外部共享滚动位置（如权限面板定位）。
   * 组件内部始终使用自己的独立 ref 做滚动管理，不会覆盖外部 ref。
   */
  scrollRegionRef?: RefObject<HTMLDivElement | null>;
  resolveInlinePermissionActions?: (requestId: string) =>
    | {
        errorMessage?: string;
        helperMessage?: string;
        items: Array<{
          danger?: boolean;
          disabled?: boolean;
          hint?: string;
          id: string;
          label: string;
          onClick: () => void;
          primary?: boolean;
        }>;
        pendingLabel?: string;
      }
    | undefined;
}

// ─── 样式 ───────────────────────────────────────────────────────────

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--bg-base)',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  flexShrink: 0,
  overflowX: 'auto',
  alignItems: 'center',
};

const TAB_BASE_STYLE: CSSProperties = {
  padding: '6px 12px',
  border: '1px solid transparent',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 'var(--radius-sm, 6px)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  lineHeight: 1,
};

function tabStyle(active: boolean, accentColor?: string): CSSProperties {
  if (active) {
    return {
      ...TAB_BASE_STYLE,
      background: accentColor
        ? `color-mix(in srgb, ${accentColor} 10%, transparent)`
        : 'color-mix(in srgb, var(--accent) 12%, transparent)',
      color: accentColor ?? 'var(--accent)',
      borderColor: accentColor
        ? `color-mix(in srgb, ${accentColor} 20%, transparent)`
        : 'color-mix(in srgb, var(--accent) 20%, transparent)',
    };
  }
  return {
    ...TAB_BASE_STYLE,
    background: 'transparent',
    color: 'var(--fg-muted)',
    borderColor: 'transparent',
  };
}

const TAB_DOT_STYLE: (color: string) => CSSProperties = (color) => ({
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
  boxShadow: `0 0 6px color-mix(in srgb, ${color} 40%, transparent)`,
});

const TAB_COUNT_STYLE: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  opacity: 0.6,
  fontVariantNumeric: 'tabular-nums',
  marginLeft: 1,
};

const MERGE_HINT_STYLE: CSSProperties = {
  padding: '6px 14px',
  background: 'color-mix(in srgb, var(--accent) 5%, transparent)',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: 10.5,
  color: 'var(--fg-muted)',
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};

const SCROLL_STYLE: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0.75rem 10px 0.75rem 14px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const CONTENT_COLUMN_STYLE: CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: '1.25rem',
  minHeight: '100%',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: 10,
  color: 'var(--fg-subtle)',
  fontSize: 12,
  textAlign: 'center',
  padding: '32px 16px',
};

const EMPTY_ICON_STYLE: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--fg-subtle)',
};

const LOAD_MORE_HINT_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '8px 4px 6px',
  color: 'var(--fg-subtle)',
  fontSize: 10,
  lineHeight: 1.35,
  textAlign: 'center',
  flexShrink: 0,
};

const SCROLL_BOTTOM_BTN_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 12px',
  borderRadius: 'var(--radius-pill, 9999px)',
  border: '1px solid var(--accent-border)',
  background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: 'var(--shadow-sm)',
  transition: 'all 120ms ease',
  whiteSpace: 'nowrap',
  zIndex: 10,
};

// ─── SVG 图标 ───────────────────────────────────────────────────────

function LayersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function EmptyFeedIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

// ─── 稳定的空 ref（避免每次渲染创建新对象）──────────────────────────

const STUB_BOTTOM_REF: RefObject<HTMLDivElement | null> = { current: null };

// ─── 分页常量 ───────────────────────────────────────────────────────

const INITIAL_VISIBLE_MESSAGE_COUNT = 50;
const LOAD_MORE_BATCH_SIZE = 50;
const LOAD_MORE_SCROLL_THRESHOLD_PX = 48;

// ─── 辅助函数 ───────────────────────────────────────────────────────

interface RawMessageItem {
  message: ChatMessage;
  layerData: LayerMessages;
  timestamp: number;
}

function parseTimestamp(ts: number | string | undefined): number {
  if (!ts) return 0;
  return typeof ts === 'string' ? parseInt(ts, 10) : ts;
}

function buildLayerMessageIdentity(
  message: ChatMessage,
  layer: Pick<LayerMessages, 'displayName' | 'layer' | 'sourceDisplayName' | 'sourceLayer'>,
) {
  const identity =
    message.role === 'assistant'
      ? message.agentId
        ? getRoleLayerIdentityFromAgentId(message.agentId)
        : getRoleLayerIdentity(layer.layer)
      : layer.sourceLayer
        ? getRoleLayerIdentity(layer.sourceLayer)
        : null;
  const displayName =
    message.role === 'assistant'
      ? (layer.displayName ?? identity?.label)
      : (layer.sourceDisplayName ?? null);

  if (!identity || !displayName) {
    return null;
  }

  return {
    groupIdentityKey:
      message.role === 'assistant'
        ? message.agentId?.trim() || `layer:${layer.layer}`
        : `source:${layer.sourceLayer ?? layer.layer}:${displayName}`,
    identityOverride: {
      color: identity.color,
      displayName,
      icon: identity.icon,
      initials: identity.initials,
    },
  };
}

/**
 * 合并所有层级的消息为按时间排序的扁平列表。
 * 仅收集数据 + 排序，不创建 renderContent 闭包 —— 闭包延迟到分页后才创建，
 * 避免对不渲染的消息创建闭包导致 React.memo 失效和 GC 压力。
 */
function buildMergedRawList(layers: LayerMessages[]): RawMessageItem[] {
  const allMessages: RawMessageItem[] = [];

  for (const layer of layers) {
    for (const message of layer.messages) {
      allMessages.push({
        layerData: layer,
        message,
        timestamp: parseTimestamp(message.createdAt),
      });
    }
    if (layer.streamingMessage) {
      allMessages.push({
        layerData: layer,
        message: layer.streamingMessage,
        timestamp: Date.now(),
      });
    }
  }

  allMessages.sort((a, b) => a.timestamp - b.timestamp);
  return allMessages;
}

/**
 * 构建单层级的原始消息列表。
 */
function buildSingleLayerRawList(layer: LayerMessages): RawMessageItem[] {
  const messages = [...layer.messages];
  if (layer.streamingMessage) {
    messages.push(layer.streamingMessage);
  }
  return messages.map((message) => ({
    message,
    layerData: layer,
    timestamp: parseTimestamp(message.createdAt),
  }));
}

/**
 * 将原始消息列表转为 ChatRenderEntry[]（创建 renderContent 闭包）。
 * 只在分页后调用，仅对要渲染的消息创建闭包。
 */
function rawListToEntries(
  rawList: RawMessageItem[],
  resolveInlinePermissionActions?: TeamMultiLayerFeedProps['resolveInlinePermissionActions'],
): ChatRenderEntry[] {
  return rawList.map(({ message, layerData }) => {
    const identity = buildLayerMessageIdentity(message, layerData);

    return {
      message,
      renderContent: (m: ChatMessage) =>
        renderChatMessageContentWithOptions(m, {
          presentationMode: 'team',
          resolveInlinePermissionActions,
        }),
      ...(identity ?? {}),
      actions: [] as ChatRenderAction[],
    };
  });
}

// ─── 主组件 ─────────────────────────────────────────────────────────

export function TeamMultiLayerFeed({
  layers,
  activeModelId,
  activeModelLabel,
  activeProviderId,
  providerCatalog,
  currentUserEmail,
  currentUserDisplayName,
  scrollRegionRef: _externalScrollRegionRef,
  resolveInlinePermissionActions,
}: TeamMultiLayerFeedProps): React.ReactElement {
  const [selectedTab, setSelectedTab] = useState<string>('all');

  // ─── 独立的滚动管理 ─────────────────────────────────────────────
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

  // ─── 分页：默认只渲染最新 50 条，滚动到顶部自动加载更多 ──────────
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const historyExpansionRef = useRef(false);
  const previousTotalCountRef = useRef<number>(0);

  // 层级 Tab 列表
  const tabs = useMemo(() => {
    const seen = new Map<string, number>();
    for (const layer of layers) {
      const count = layer.messages.length + (layer.streamingMessage ? 1 : 0);
      const existing = seen.get(layer.layer) ?? 0;
      seen.set(layer.layer, existing + count);
    }
    return Array.from(seen.entries()).map(([layer, count]) => ({
      layer,
      count,
      identity: getRoleLayerIdentity(layer),
    }));
  }, [layers]);

  // 当前选中层级的 LayerMessages
  const selectedLayer = useMemo(
    () => layers.find((l) => l.layer === selectedTab) ?? null,
    [layers, selectedTab],
  );

  // 先构建全部原始消息列表（轻量，不含 renderContent 闭包）
  const rawList = useMemo(() => {
    if (selectedTab === 'all') {
      return buildMergedRawList(layers);
    }
    if (selectedLayer) {
      return buildSingleLayerRawList(selectedLayer);
    }
    return [];
  }, [selectedTab, layers, selectedLayer]);

  const totalEntryCount = rawList.length;

  // 分页起始索引：默认只显示最后 50 条
  const [visibleStartIndex, setVisibleStartIndex] = useState(() =>
    Math.max(totalEntryCount - INITIAL_VISIBLE_MESSAGE_COUNT, 0),
  );

  // 当消息总数变化或 tab 切换时，重置/调整分页
  useEffect(() => {
    const nextDefaultStart = Math.max(totalEntryCount - INITIAL_VISIBLE_MESSAGE_COUNT, 0);
    const prevTotal = previousTotalCountRef.current;

    if (totalEntryCount < prevTotal) {
      historyExpansionRef.current = false;
      setVisibleStartIndex(nextDefaultStart);
    } else if (totalEntryCount > prevTotal && !historyExpansionRef.current) {
      setVisibleStartIndex(nextDefaultStart);
    }

    previousTotalCountRef.current = totalEntryCount;
  }, [totalEntryCount, selectedTab]);

  // 切换 tab 时重置分页
  useEffect(() => {
    historyExpansionRef.current = false;
    const newStart = Math.max(rawList.length - INITIAL_VISIBLE_MESSAGE_COUNT, 0);
    setVisibleStartIndex(newStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab]);

  // 分页后的 raw list → 转 entries（仅对要渲染的消息创建闭包）
  const visibleEntries = useMemo<ChatRenderEntry[]>(
    () => rawListToEntries(rawList.slice(visibleStartIndex), resolveInlinePermissionActions),
    [rawList, visibleStartIndex, resolveInlinePermissionActions],
  );

  // 分组
  const groupedEntries = useMemo<ChatRenderGroup[]>(
    () => groupChatRenderEntries(visibleEntries),
    [visibleEntries],
  );

  const hasMessages = groupedEntries.length > 0;
  const totalMessageCount = tabs.reduce((sum, t) => sum + t.count, 0);
  const hasHiddenHistory = visibleStartIndex > 0;
  const visibleRenderedCount = visibleEntries.length;

  // 计算消息流签名 —— 内容变化时触发自动滚动
  const lastMessageSignature = useMemo(() => {
    let sig = '';
    for (const layer of layers) {
      const lastMsg = layer.messages[layer.messages.length - 1];
      if (lastMsg) {
        sig += `${lastMsg.id}:${lastMsg.content?.length ?? 0};`;
      }
      if (layer.streamingMessage) {
        sig += `stream:${layer.streamingMessage.content?.length ?? 0};`;
      }
    }
    return sig;
  }, [layers]);

  // 加载更多：记录锚点，扩展 visibleStartIndex
  const loadOlderMessages = useCallback(() => {
    if (visibleStartIndex <= 0 || prependAnchorRef.current) {
      return;
    }
    const el = internalScrollRef.current;
    if (!el) return;
    prependAnchorRef.current = {
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
    historyExpansionRef.current = true;
    // 加载历史时关闭自动滚动，防止自动滚底覆盖锚点恢复
    setAutoScroll(false);
    setVisibleStartIndex((current) => Math.max(0, current - LOAD_MORE_BATCH_SIZE));
  }, [visibleStartIndex]);

  // 锚点恢复：加载更多后保持滚动位置
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = internalScrollRef.current;
    if (!anchor || !el) return;
    const delta = el.scrollHeight - anchor.scrollHeight;
    el.scrollTop = anchor.scrollTop + delta;
    prependAnchorRef.current = null;
  }, [groupedEntries]);

  // 自动滚动到底部
  useEffect(() => {
    if (!autoScroll) return;
    const el = internalScrollRef.current;
    if (!el) return;
    let cancelled = false;
    const rafs: number[] = [];
    const doScroll = () => {
      if (!cancelled) el.scrollTop = el.scrollHeight;
    };
    rafs.push(
      requestAnimationFrame(() => {
        doScroll();
        rafs.push(requestAnimationFrame(doScroll));
      }),
    );
    return () => {
      cancelled = true;
      rafs.forEach(cancelAnimationFrame);
    };
  }, [autoScroll, lastMessageSignature, selectedTab]);

  // 首次挂载或 tab 切换时滚到底（三段 rAF 确保异步内容渲染完成）
  useEffect(() => {
    const el = internalScrollRef.current;
    if (!el) return;
    let cancelled = false;
    const rafs: number[] = [];
    const doScroll = () => {
      if (!cancelled) el.scrollTop = el.scrollHeight;
    };
    rafs.push(
      requestAnimationFrame(() => {
        doScroll();
        rafs.push(
          requestAnimationFrame(() => {
            doScroll();
            rafs.push(requestAnimationFrame(doScroll));
          }),
        );
      }),
    );
    return () => {
      cancelled = true;
      rafs.forEach(cancelAnimationFrame);
    };
  }, [selectedTab]);

  // 监听容器可见性变化 —— 从隐藏变为可见时滚到底
  useEffect(() => {
    const el = internalScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let prevVisible = el.clientHeight > 0;
    const observer = new ResizeObserver(() => {
      const isVisible = el.clientHeight > 0;
      if (isVisible && !prevVisible && autoScroll) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
      prevVisible = isVisible;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoScroll]);

  const handleScroll = useCallback(() => {
    const el = internalScrollRef.current;
    if (!el) return;
    // 滚动到顶部附近 → 加载更早消息
    if (el.scrollTop <= LOAD_MORE_SCROLL_THRESHOLD_PX) {
      loadOlderMessages();
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(isNearBottom);
    setShowScrollBottomBtn(!isNearBottom);
  }, [loadOlderMessages]);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    const el = internalScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  // 窗口摘要
  const windowSummary = hasHiddenHistory
    ? `已显示最近 ${visibleRenderedCount} / ${totalEntryCount} 条`
    : `已显示全部 ${totalEntryCount} 条`;

  return (
    <div style={PANEL_STYLE}>
      {/* 层级 Tab 栏 */}
      <div style={TAB_BAR_STYLE}>
        <button
          type="button"
          style={tabStyle(selectedTab === 'all')}
          onClick={() => setSelectedTab('all')}
        >
          <LayersIcon size={12} />
          全部
          <span style={TAB_COUNT_STYLE}>{totalMessageCount}</span>
        </button>
        {tabs.map(({ layer, count, identity }) => (
          <button
            key={layer}
            type="button"
            style={tabStyle(selectedTab === layer, identity.color)}
            onClick={() => setSelectedTab(layer)}
          >
            <span style={TAB_DOT_STYLE(identity.color)} />
            {identity.short}
            <span style={TAB_COUNT_STYLE}>{count}</span>
          </button>
        ))}
      </div>

      {/* 合并模式提示 + 窗口摘要 */}
      {selectedTab === 'all' && hasMessages && (
        <div style={MERGE_HINT_STYLE}>
          <ClockIcon size={11} />
          <span>合并时间线 · 按时间排序，层级色标区分归属</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-subtle)' }}>
            {windowSummary}
          </span>
        </div>
      )}
      {selectedTab !== 'all' && hasMessages && (
        <div style={{ ...MERGE_HINT_STYLE, gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{windowSummary}</span>
        </div>
      )}

      {/* 消息流 */}
      <div
        ref={internalScrollRef}
        style={SCROLL_STYLE}
        onScroll={handleScroll}
        role="log"
        aria-label="团队层级消息汇总"
        aria-live="polite"
      >
        {hasHiddenHistory ? (
          <div style={LOAD_MORE_HINT_STYLE}>上滑到顶部后自动加载更早消息</div>
        ) : null}
        {hasMessages ? (
          <div style={CONTENT_COLUMN_STYLE}>
            <ChatMessageGroupList
              activeModelId={activeModelId}
              activeModelLabel={activeModelLabel}
              activeProviderId={activeProviderId}
              bottomRef={STUB_BOTTOM_REF}
              currentUserDisplayName={currentUserDisplayName}
              currentUserEmail={currentUserEmail}
              groups={groupedEntries}
              providerCatalog={providerCatalog}
              resolveInlinePermissionActions={resolveInlinePermissionActions}
              scrollRegionRef={internalScrollRef}
            />
          </div>
        ) : (
          <div style={EMPTY_STYLE}>
            <div style={EMPTY_ICON_STYLE}>
              <EmptyFeedIcon size={22} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--fg-muted)', fontSize: 13 }}>
              {selectedTab === 'all' ? '暂无层级消息' : '该层级暂无消息'}
            </div>
            <div>团队各层级的对话动态将在这里实时汇总</div>
          </div>
        )}
      </div>

      {/* 滚动到底部按钮 */}
      {showScrollBottomBtn && hasMessages && (
        <button
          type="button"
          className="team-v2-control"
          style={SCROLL_BOTTOM_BTN_STYLE}
          onClick={scrollToBottom}
        >
          ↓ 最新消息
        </button>
      )}
    </div>
  );
}
