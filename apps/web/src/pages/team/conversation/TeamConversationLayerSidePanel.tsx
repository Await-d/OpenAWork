import type { CSSProperties, RefObject } from 'react';
import type { PendingPermissionRequest } from '@openAwork/web-client';
import { LatestAssistantMessageContext } from '../../../components/chat/message/collapsible-assistant-content.js';
import type { ResolveInlinePermissionActionsFn } from '../../../components/chat/session/ChatPageSections.js';
import { TeamMultiLayerCardWall } from './extras/TeamMultiLayerCardWall.js';
import { resolveRawListOrdering, TeamMultiLayerFeed } from './extras/TeamMultiLayerFeed.js';
import type { MultiLayerViewMode } from './extras/TeamViewModeToggle.js';
import type { LayerMessages } from './extras/team-layer-messages.js';

type ProviderCatalog = Map<string, { id: string; name: string; type: string }>;

export interface TeamConversationLayerSidePanelProps {
  activeLayer?: string | null;
  activeModelId: string;
  activeModelLabel?: string;
  activeProviderId: string;
  currentSessionId: string;
  currentUserEmail: string;
  currentUserDisplayName?: string;
  isOpen: boolean;
  layers: LayerMessages[];
  mode: MultiLayerViewMode;
  onLayerSelect: (layer: string) => void;
  /**
   * 打开某个角色实例的完整会话。卡片墙把它做成卡片底栏的「完整会话」入口；
   * feed 视图不用（它就是完整的合并消息流）。不传时卡片墙不渲染该入口。
   */
  onOpenSession?: (sessionId: string) => void;
  /**
   * 当前会话树下的待处理权限请求（含所有后代角色实例）。卡片墙按 `sessionId`
   * 分发给对应卡片，让用户在卡片上就能处置权限，不必切回 feed 视图。
   */
  pendingPermissions?: readonly PendingPermissionRequest[];
  providerCatalog: ProviderCatalog;
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  scrollRegionRef: RefObject<HTMLDivElement | null>;
  selectedLayer?: string | null;
}

const SIDE_PANEL_STYLE: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  flexDirection: 'column',
  transition: 'flex 200ms ease',
  position: 'relative',
  overflow: 'hidden',
  borderLeft: '1px solid var(--border-default)',
};

/**
 * 计算侧栏 feed 里「最新一条已定稿的助手消息」id，语义与主对话视图
 * TeamConversationView.latestAssistantMessageId 一致：跳过 status === 'streaming'
 * 的流式占位消息，取最后一条 assistant 消息。
 *
 * 跨层顺序复用 feed 的合并排序（resolveRawListOrdering）：层内按数组下标、跨层按可比
 * 时间戳交错、缺失 / 平局回落到 (层级下标, 层内下标)。不再假设「layers 数组顺序即时间线」，
 * 这样侧栏「最新一条」与 feed 实际渲染的最后一条始终同源、同序。
 *
 * 没有任何已定稿助手消息（含 layers 为空）时返回 null —— 侧栏 feed 全部消息照常
 * 走折叠策略，不会报错。
 */
function findLatestFinalizedAssistantId(layers: LayerMessages[]): string | null {
  const ordered = resolveRawListOrdering(layers);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const item = ordered[index];
    if (!item) continue;
    if (item.message.role !== 'assistant') continue;
    if (item.message.status === 'streaming') continue;
    return item.message.id;
  }
  return null;
}

export function TeamConversationLayerSidePanel({
  activeLayer,
  activeModelId,
  activeModelLabel,
  activeProviderId,
  currentSessionId,
  currentUserEmail,
  currentUserDisplayName,
  isOpen,
  layers,
  mode,
  onLayerSelect,
  onOpenSession,
  pendingPermissions,
  providerCatalog,
  resolveInlinePermissionActions,
  scrollRegionRef,
  selectedLayer,
}: TeamConversationLayerSidePanelProps) {
  const style: CSSProperties = {
    ...SIDE_PANEL_STYLE,
    flex: isOpen ? '1 1 45%' : '0 0 0%',
    display: isOpen ? 'flex' : 'none',
  };

  // 与主对话视图共用「最新一条已定稿回复不折叠」的语义：CollapsibleAssistantContent
  // 会跳过整条折叠，并透传 FoldDisabledContext 让围栏块也免折叠。否则侧栏 feed 里
  // 刚出的回复会在流式结束瞬间被收起，与主视图行为不一致。
  //
  // 取舍：多层并排共用 context 的同一个「最新」名额，同一时刻至多一条消息免折叠；
  // 卡片墙正文走 TeamMessageBody（不进 markdown 管线），不受该值影响。
  const latestAssistantMessageId = findLatestFinalizedAssistantId(layers);

  return (
    <LatestAssistantMessageContext value={latestAssistantMessageId}>
      <div aria-label="团队层级消息汇总" style={style}>
        {mode === 'cards' ? (
          <TeamMultiLayerCardWall
            // 用户点选过就用点选值，否则跟随主会话所处层级高亮。
            activeLayer={selectedLayer ?? activeLayer}
            layers={layers}
            onLayerSelect={onLayerSelect}
            onOpenSession={onOpenSession}
            pendingPermissions={pendingPermissions}
            resolveInlinePermissionActions={resolveInlinePermissionActions}
            // 展开态按会话分键持久化 —— 换会话不该继承上一个会话的展开卡片。
            scopeKey={currentSessionId}
          />
        ) : (
          <TeamMultiLayerFeed
            activeLayer={activeLayer}
            currentSessionId={currentSessionId}
            layers={layers}
            activeModelId={activeModelId}
            activeModelLabel={activeModelLabel}
            activeProviderId={activeProviderId}
            providerCatalog={providerCatalog}
            currentUserEmail={currentUserEmail}
            currentUserDisplayName={currentUserDisplayName}
            scrollRegionRef={scrollRegionRef}
            resolveInlinePermissionActions={resolveInlinePermissionActions}
          />
        )}
      </div>
    </LatestAssistantMessageContext>
  );
}
