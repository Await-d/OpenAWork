import type { HandoffEntry } from '../../../../../stores/team/team-events.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { EmptyState } from '../../shared/content-kit/index.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { CrossLayerConversationView } from './CrossLayerConversationView.js';
import { LayerConversationContextHeader } from './LayerConversationContextHeader.js';
import { LayerFlowDetailEmptyState } from './LayerFlowDetailEmptyState.js';
import { LayerFlowDetailModeBar } from './LayerFlowDetailModeBar.js';
import { LayerFlowHandoffHeader } from './LayerFlowHandoffHeader.js';
import type { LayerNodeView } from './LayerFlowPipeline.js';
import { LayerFlowRoleInstanceTabs } from './LayerFlowRoleInstanceTabs.js';
import { LayerFlowSelectedHandoffMeta } from './LayerFlowSelectedHandoffMeta.js';
import { type LayerFlowDetailMode } from './layer-flow-view-model.js';
import {
  CONVERSATION_WRAPPER_STYLE,
  DETAIL_BODY_STYLE,
  DETAIL_PANE_STYLE,
  DETAIL_TOOLBAR_STYLE,
} from './layer-flow-view-styles.js';

interface LayerFlowDetailPaneProps {
  detailMode: LayerFlowDetailMode;
  detailSelectedTeam: AgentTeamsSidebarTeam | null;
  effectiveSelectedTeam: AgentTeamsSidebarTeam | null;
  layerViews: readonly LayerNodeView[];
  selectedHandoff: HandoffEntry | null;
  selectedHandoffReuseBadge: string | null;
  selectedSessionId: string | null;
  sessionTitleById: ReadonlyMap<string, string>;
  onDetailModeChange: (mode: LayerFlowDetailMode) => void;
  onSelectSessionId: (sessionId: string) => void;
}

export function LayerFlowDetailPane({
  detailMode,
  detailSelectedTeam,
  effectiveSelectedTeam,
  layerViews,
  selectedHandoff,
  selectedHandoffReuseBadge,
  selectedSessionId,
  sessionTitleById,
  onDetailModeChange,
  onSelectSessionId,
}: LayerFlowDetailPaneProps) {
  return (
    <div style={DETAIL_PANE_STYLE}>
      {selectedSessionId || selectedHandoff ? (
        <div style={DETAIL_BODY_STYLE}>
          <div style={DETAIL_TOOLBAR_STYLE}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
              <strong
                style={{
                  fontSize: 13,
                  color: 'var(--fg-strong)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {selectedHandoff?.summary ?? detailSelectedTeam?.title ?? '层级详情'}
              </strong>
              {selectedHandoff ? <LayerFlowSelectedHandoffMeta entry={selectedHandoff} /> : null}
            </div>
            <LayerFlowDetailModeBar detailMode={detailMode} onChange={onDetailModeChange} />
          </div>

          {detailMode === 'thread' ? (
            <ThreadDetailBody
              effectiveSelectedTeam={effectiveSelectedTeam}
              selectedHandoff={selectedHandoff}
              selectedSessionId={selectedSessionId}
              sessionTitleById={sessionTitleById}
            />
          ) : selectedSessionId ? (
            <SessionDetailBody
              detailSelectedTeam={detailSelectedTeam}
              layerViews={layerViews}
              selectedHandoff={selectedHandoff}
              selectedHandoffReuseBadge={selectedHandoffReuseBadge}
              selectedSessionId={selectedSessionId}
              sessionTitleById={sessionTitleById}
              onSelectSessionId={onSelectSessionId}
            />
          ) : (
            <EmptyState
              emoji="💬"
              title="当前交接尚未绑定层级会话"
              description="可切到跨层线程查看本次交接前后的完整上下文。"
              style={{ flex: 1 }}
            />
          )}
        </div>
      ) : (
        <LayerFlowDetailEmptyState />
      )}
    </div>
  );
}

function ThreadDetailBody({
  effectiveSelectedTeam,
  selectedHandoff,
  selectedSessionId,
  sessionTitleById,
}: {
  effectiveSelectedTeam: AgentTeamsSidebarTeam | null;
  selectedHandoff: HandoffEntry | null;
  selectedSessionId: string | null;
  sessionTitleById: ReadonlyMap<string, string>;
}) {
  return (
    <div style={CONVERSATION_WRAPPER_STYLE}>
      {selectedHandoff ? (
        <LayerFlowHandoffHeader
          entry={selectedHandoff}
          fromSessionTitle={
            selectedHandoff.fromSessionId
              ? (sessionTitleById.get(selectedHandoff.fromSessionId) ?? null)
              : null
          }
          toSessionTitle={
            selectedHandoff.toSessionId
              ? (sessionTitleById.get(selectedHandoff.toSessionId) ?? null)
              : null
          }
        />
      ) : null}
      <CrossLayerConversationView
        embedded
        focusHandoffId={selectedHandoff?.id ?? null}
        focusSessionId={selectedSessionId}
        selectedTeam={effectiveSelectedTeam}
      />
    </div>
  );
}

function SessionDetailBody({
  detailSelectedTeam,
  layerViews,
  selectedHandoff,
  selectedHandoffReuseBadge,
  selectedSessionId,
  sessionTitleById,
  onSelectSessionId,
}: {
  detailSelectedTeam: AgentTeamsSidebarTeam | null;
  layerViews: readonly LayerNodeView[];
  selectedHandoff: HandoffEntry | null;
  selectedHandoffReuseBadge: string | null;
  selectedSessionId: string;
  sessionTitleById: ReadonlyMap<string, string>;
  onSelectSessionId: (sessionId: string) => void;
}) {
  const selectedView = layerViews.find((view) => view.sessionId === selectedSessionId);

  return (
    <div style={CONVERSATION_WRAPPER_STYLE}>
      {selectedHandoff ? (
        <LayerConversationContextHeader
          fromRoleLayer={selectedHandoff.fromRoleLayer}
          fromSessionId={selectedHandoff.fromSessionId}
          fromSessionTitle={
            selectedHandoff.fromSessionId
              ? (sessionTitleById.get(selectedHandoff.fromSessionId) ?? null)
              : null
          }
          modeBadge="单层会话视角"
          reuseBadge={selectedHandoffReuseBadge}
          sessionId={selectedSessionId}
          sessionTitle={sessionTitleById.get(selectedSessionId) ?? null}
          title={sessionTitleById.get(selectedSessionId) ?? detailSelectedTeam?.title}
          toRoleLayer={selectedHandoff.toRoleLayer}
        />
      ) : null}
      {selectedView && selectedView.roleInstances.length > 1 ? (
        <LayerFlowRoleInstanceTabs
          selectedSessionId={selectedSessionId}
          view={selectedView}
          onSelectSessionId={onSelectSessionId}
        />
      ) : null}
      <TeamConversationView
        key={selectedSessionId}
        sessionId={selectedSessionId}
        compact
        topBar={null}
        readOnly
        soloMode
      />
    </div>
  );
}
