import type { CSSProperties, RefObject } from 'react';
import type { PendingPermissionRequest } from '@openAwork/web-client';
import type { ResolveInlinePermissionActionsFn } from '../../../components/chat/session/ChatPageSections.js';
import { TeamMultiLayerCardWall } from './extras/TeamMultiLayerCardWall.js';
import { TeamMultiLayerFeed } from './extras/TeamMultiLayerFeed.js';
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

  return (
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
  );
}
