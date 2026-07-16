import type { CSSProperties, RefObject } from 'react';
import { TeamMultiLayerFeed } from './extras/TeamMultiLayerFeed.js';
import { TeamMultiLayerPanel, type LayerMessages } from './extras/TeamMultiLayerPanel.js';
import type { MultiLayerViewMode } from './extras/TeamViewModeToggle.js';

type ProviderCatalog = Map<string, { id: string; name: string; type: string }>;

type ResolveInlinePermissionActions = (requestId: string) =>
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
  providerCatalog: ProviderCatalog;
  resolveInlinePermissionActions?: ResolveInlinePermissionActions;
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
      {mode === 'feed' ? (
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
      ) : (
        <TeamMultiLayerPanel
          activeLayer={selectedLayer ?? activeLayer}
          currentSessionId={currentSessionId}
          layers={layers}
          viewMode={mode}
          onLayerSelect={onLayerSelect}
        />
      )}
    </div>
  );
}
