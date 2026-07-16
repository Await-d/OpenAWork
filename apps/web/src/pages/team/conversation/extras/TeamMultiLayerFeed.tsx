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

import { useMemo, useState, type CSSProperties, type RefObject } from 'react';
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
  scrollRegionRef: RefObject<HTMLDivElement | null>;
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

// ─── 辅助函数 ───────────────────────────────────────────────────────

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
 * 合并所有层级的消息为一条按时间排序的扁平列表，
 * 并为每条消息注入对应层级的 identityOverride。
 */
function buildMergedEntries(
  layers: LayerMessages[],
  resolveInlinePermissionActions?: TeamMultiLayerFeedProps['resolveInlinePermissionActions'],
): ChatRenderEntry[] {
  const allMessages: Array<{
    layerData: LayerMessages;
    message: ChatMessage;
    timestamp: number;
  }> = [];

  for (const layer of layers) {
    for (const message of layer.messages) {
      allMessages.push({
        layerData: layer,
        message,
        timestamp: parseTimestamp(message.createdAt),
      });
    }
    // 注入流式占位消息
    if (layer.streamingMessage) {
      allMessages.push({
        layerData: layer,
        message: layer.streamingMessage,
        timestamp: Date.now(),
      });
    }
  }

  allMessages.sort((a, b) => a.timestamp - b.timestamp);

  return allMessages.map(({ message, layerData }) => {
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

/**
 * 构建单层级的消息 entries。
 */
function buildSingleLayerEntries(
  layer: LayerMessages,
  resolveInlinePermissionActions?: TeamMultiLayerFeedProps['resolveInlinePermissionActions'],
): ChatRenderEntry[] {
  const messages = [...layer.messages];
  if (layer.streamingMessage) {
    messages.push(layer.streamingMessage);
  }

  return messages.map((message) => {
    const identity = buildLayerMessageIdentity(message, layer);

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
  scrollRegionRef,
  resolveInlinePermissionActions,
}: TeamMultiLayerFeedProps): React.ReactElement {
  // 'all' = 合并时间线，否则为指定层级
  const [selectedTab, setSelectedTab] = useState<string>('all');

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

  // 当前选中层级的 LayerMessages（single 模式下使用）
  const selectedLayer = useMemo(
    () => layers.find((l) => l.layer === selectedTab) ?? null,
    [layers, selectedTab],
  );

  // 构建 grouped entries
  const groupedEntries = useMemo<ChatRenderGroup[]>(() => {
    if (selectedTab === 'all') {
      const entries = buildMergedEntries(layers, resolveInlinePermissionActions);
      return groupChatRenderEntries(entries);
    }
    if (selectedLayer) {
      const entries = buildSingleLayerEntries(selectedLayer, resolveInlinePermissionActions);
      return groupChatRenderEntries(entries);
    }
    return [];
  }, [selectedTab, layers, selectedLayer, resolveInlinePermissionActions]);

  const hasMessages = groupedEntries.length > 0;
  const totalMessageCount = tabs.reduce((sum, t) => sum + t.count, 0);

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

      {/* 合并模式提示 */}
      {selectedTab === 'all' && hasMessages && (
        <div style={MERGE_HINT_STYLE}>
          <ClockIcon size={11} />
          <span>合并时间线 · 按时间排序，层级色标区分归属</span>
        </div>
      )}

      {/* 消息流 */}
      <div ref={scrollRegionRef} style={SCROLL_STYLE}>
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
              scrollRegionRef={scrollRegionRef}
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
    </div>
  );
}
