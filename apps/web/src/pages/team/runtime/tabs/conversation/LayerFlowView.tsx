import { useEffect, useMemo, useRef, useState } from 'react';
import { useHandoffStore, useLayerStore } from '../../../../../stores/team/team-events.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState, SegmentedToggle } from '../../shared/content-kit/index.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
  isSessionInScope,
} from '../../data/team-runtime-session-scope.js';
import { resolveLayerConversationRootId } from './layered-conversation-model.js';
import { LayerFlowPipeline, type LayerNodeView } from './LayerFlowPipeline.js';
import { LayerFlowTimelinePanel } from './LayerFlowTimelinePanel.js';
import { useNarrowConversationLayout } from './use-narrow-conversation-layout.js';
import { LayerFlowDetailPane } from './LayerFlowDetailPane.js';
import {
  buildHandoffDetailTeam,
  buildHandoffReuseBadge,
  buildLayerDetailTeam,
  buildLayerEdges,
  buildLayerViews,
  buildSessionTitleById,
  buildSnapshotNodes,
  mergeLayerNodes,
  type LayerFlowDensityMode,
  type LayerFlowDetailMode,
} from './layer-flow-view-model.js';
import { resolveFlowHandoffSessionId } from './layer-flow-state.js';
import { buildLayerTimeline, buildLayerTimelineSections } from './layer-flow-timeline-model.js';

export interface LayerFlowViewProps {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}

export function LayerFlowView({ selectedTeam = null }: LayerFlowViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isNarrowLayout = useNarrowConversationLayout(containerRef, 1220);
  const handoffs = useHandoffStore((state) => state.handoffs);
  const nodes = useLayerStore((state) => state.nodes);
  const { sessions } = useTeamRuntimeReferenceViewData();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<LayerFlowDetailMode>('session');
  const [flowDensityMode, setFlowDensityMode] = useState<LayerFlowDensityMode>('active');
  const [detailSelectedTeam, setDetailSelectedTeam] = useState<AgentTeamsSidebarTeam | null>(null);
  const selectedScope = selectedTeam;
  const selectedDetailTeam = detailSelectedTeam ?? selectedTeam;

  const snapshotNodes = useMemo(() => buildSnapshotNodes(sessions), [sessions]);
  const mergedNodes = useMemo(() => mergeLayerNodes(snapshotNodes, nodes), [nodes, snapshotNodes]);

  const scopedSessionIds = useMemo(() => {
    if (!selectedScope || selectedScope.isSharedSession) {
      return null;
    }
    const nodeList = Array.from(mergedNodes.values());
    const rootSessionId = resolveLayerConversationRootId({
      nodes: nodeList,
      selectedSessionId: selectedScope.id,
      sessions,
    });
    return rootSessionId
      ? collectSessionScope(rootSessionId, [...sessions, ...nodeList])
      : new Set<string>();
  }, [mergedNodes, selectedScope, sessions]);

  const scopedHandoffs = useMemo(() => {
    if (!scopedSessionIds) {
      return handoffs;
    }
    return new Map(
      Array.from(handoffs.entries()).filter(([, handoff]) =>
        isHandoffInSessionScope(handoff, scopedSessionIds),
      ),
    );
  }, [handoffs, scopedSessionIds]);

  const scopedNodes = useMemo(() => {
    if (!scopedSessionIds) {
      return mergedNodes;
    }
    return new Map(
      Array.from(mergedNodes.entries()).filter(([sessionId]) =>
        isSessionInScope(sessionId, scopedSessionIds),
      ),
    );
  }, [mergedNodes, scopedSessionIds]);

  useEffect(() => {
    setSelectedSessionId(null);
    setSelectedHandoffId(null);
    setDetailSelectedTeam(null);
    setDetailMode('thread');
  }, [selectedTeam?.id, selectedTeam?.isSharedSession]);

  const layerViews = useMemo(
    () => buildLayerViews(scopedHandoffs, scopedNodes, flowDensityMode, selectedSessionId),
    [flowDensityMode, scopedHandoffs, scopedNodes, selectedSessionId],
  );
  const edges = useMemo(() => buildLayerEdges(scopedHandoffs), [scopedHandoffs]);
  const timeline = useMemo(() => buildLayerTimeline(scopedHandoffs), [scopedHandoffs]);
  const timelineSections = useMemo(() => buildLayerTimelineSections(timeline), [timeline]);
  const sessionTitleById = useMemo(
    () => buildSessionTitleById(sessions, scopedNodes),
    [scopedNodes, sessions],
  );

  const selectedHandoff = selectedHandoffId
    ? (scopedHandoffs.get(selectedHandoffId) ?? null)
    : null;
  const selectedHandoffReuseBadge = buildHandoffReuseBadge(
    selectedHandoff,
    selectedSessionId,
    scopedHandoffs,
    scopedNodes,
  );

  const handleSelectLayer = (view: LayerNodeView) => {
    if (!view.sessionId) return;
    const detailTeam = buildLayerDetailTeam(view);
    if (!detailTeam) return;
    setDetailMode('thread');
    setDetailSelectedTeam(detailTeam);
    setSelectedSessionId(view.sessionId);
    setSelectedHandoffId(null);
  };

  const handleSelectHandoff = (entry: NonNullable<typeof selectedHandoff>) => {
    setSelectedHandoffId(entry.id);
    setDetailMode('thread');
    const threadSessionId =
      resolveFlowHandoffSessionId(entry, scopedNodes) ?? entry.fromSessionId ?? null;
    setDetailSelectedTeam(buildHandoffDetailTeam(entry, threadSessionId));
    if (threadSessionId) setSelectedSessionId(threadSessionId);
  };

  if (scopedHandoffs.size === 0 && scopedNodes.size === 0) {
    return (
      <TabContainer
        title="层级流动"
        subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成流水线。"
      >
        <EmptyState
          emoji="🪜"
          title="还没有跨层流动"
          description="当前会话还停留在接待层直接对话。一旦你提出需要规划/执行的任务，团队会展开 接待 → 规划 → 管控 → 执行 → 评审 的层级协作，过程会在这里实时画成流水线。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="层级流动"
      subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成流水线。点左侧记录切换，右侧面板只显示对话。"
      scroll={false}
    >
      <div
        ref={containerRef}
        className="team-conv-root"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {/* 流水线 + 密度切换 */}
        <div
          className="team-conv-panel"
          style={{
            display: 'grid',
            gridTemplateColumns: isNarrowLayout ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto',
            alignItems: 'flex-start',
            gap: 12,
            padding: '12px 16px',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 2 }}>
            <LayerFlowPipeline
              edges={edges}
              layerViews={layerViews}
              selectedSessionId={selectedSessionId}
              onSelectHandoff={handleSelectHandoff}
              onSelectLayer={handleSelectLayer}
            />
          </div>
          <SegmentedToggle<LayerFlowDensityMode>
            ariaLabel="层级流动密度模式"
            size="sm"
            style={{
              alignSelf: 'start',
              justifySelf: isNarrowLayout ? 'end' : 'start',
            }}
            value={flowDensityMode}
            onChange={setFlowDensityMode}
            options={[
              { value: 'active', label: '活跃', icon: '⚡' },
              { value: 'all', label: '全部', icon: '🗂️' },
            ]}
          />
        </div>

        {/* 时间线 + 详情面板 */}
        <div
          className={isNarrowLayout ? '' : 'team-conv-split'}
          style={
            isNarrowLayout
              ? {
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  overflow: 'hidden',
                }
              : undefined
          }
        >
          <div
            className={isNarrowLayout ? 'team-conv-panel' : 'team-conv-split__sidebar'}
            style={isNarrowLayout ? { maxHeight: 280, minHeight: 0, flex: '0 0 auto' } : undefined}
          >
            <LayerFlowTimelinePanel
              sections={timelineSections}
              selectedHandoffId={selectedHandoffId}
              onSelectHandoff={handleSelectHandoff}
              nodes={scopedNodes}
            />
          </div>

          <div className={isNarrowLayout ? 'team-conv-panel' : 'team-conv-split__main'}>
            <LayerFlowDetailPane
              detailMode={detailMode}
              detailSelectedTeam={detailSelectedTeam}
              effectiveSelectedTeam={selectedDetailTeam}
              layerViews={layerViews}
              selectedHandoff={selectedHandoff}
              selectedHandoffReuseBadge={selectedHandoffReuseBadge}
              selectedSessionId={selectedSessionId}
              sessionTitleById={sessionTitleById}
              onDetailModeChange={setDetailMode}
              onSelectSessionId={setSelectedSessionId}
            />
          </div>
        </div>
      </div>
    </TabContainer>
  );
}
