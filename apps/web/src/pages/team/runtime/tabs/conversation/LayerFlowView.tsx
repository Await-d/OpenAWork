/**
 * 260916-层级可视化重构 · T-03 · 层级流动（泳道轨迹版）
 *
 * 结构：
 *   - 工具条：说明 + 统计胶囊（活跃 / 交接 / 时间跨度）+ 活跃-全部密度切换；
 *   - 主体左：LayerFlowSwimlane（泳道轨迹画布）——层为泳道、handoff 为跨泳道节点 + SVG 连线；
 *   - 主体右：LayerFlowDetailPane（单层会话 / 跨层线程两种详情视角）。
 *
 * 空间策略：未选中任何对象时右栏不占位，把宽度全部让给轨迹画布（选中后才展开详情）。
 *
 * 与旧实现的差异：删除「静态流水线 + 按层交接记录列表」的双份数据排列，
 * 换成分层泳道 + 时间槽轨迹，使打回 / 重试 / 多轮往返可见（见泳道模型注释）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
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
import { LayerFlowSwimlane } from './LayerFlowSwimlane.js';
import { useElementHeight } from './use-element-width.js';
import { useNarrowConversationLayout } from './use-narrow-conversation-layout.js';
import { LayerFlowDetailPane } from './LayerFlowDetailPane.js';
import {
  buildHandoffDetailTeam,
  buildHandoffReuseBadge,
  buildLayerDetailTeam,
  buildLayerViews,
  buildSessionTitleById,
  buildSnapshotNodes,
  mergeLayerNodes,
  type LayerFlowDensityMode,
  type LayerFlowDetailMode,
  type LayerNodeView,
} from './layer-flow-view-model.js';
import { buildLayerSwimlaneModel } from './layer-flow-swimlane-model.js';
import { formatTraceDuration } from './layer-trace-model.js';
import { resolveFlowHandoffSessionId } from './layer-flow-state.js';

export interface LayerFlowViewProps {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}

export function LayerFlowView({ selectedTeam = null }: LayerFlowViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const swimlaneWrapperRef = useRef<HTMLDivElement | null>(null);
  const isNarrowLayout = useNarrowConversationLayout(containerRef, 1220);
  // 泳道区可用高度（实测）：泳道高度据此平摊，避免下方留大片空白
  const swimlaneAvailableHeight = useElementHeight(swimlaneWrapperRef);
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
  const swimlaneModel = useMemo(
    () =>
      buildLayerSwimlaneModel({
        densityMode: flowDensityMode,
        handoffs: scopedHandoffs.values(),
        nodes: scopedNodes.values(),
        selectedHandoffId,
      }),
    [flowDensityMode, scopedHandoffs, scopedNodes, selectedHandoffId],
  );
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
  const activeLinkCount = swimlaneModel.links.filter((link) => link.active).length;
  const firstColumnTimeMs = swimlaneModel.columns[0]?.timeMs ?? 0;
  const lastColumnTimeMs = swimlaneModel.columns[swimlaneModel.columns.length - 1]?.timeMs ?? 0;
  const handoffSpanMs =
    firstColumnTimeMs > 0 && lastColumnTimeMs > firstColumnTimeMs
      ? lastColumnTimeMs - firstColumnTimeMs
      : 0;
  /** 未选中任何对象时不占用右栏，把宽度全部让给轨迹画布。 */
  const showDetailPane = Boolean(selectedHandoffId || selectedSessionId);

  const openDetailForLayerView = (view: LayerNodeView) => {
    if (!view.sessionId) return;
    const detailTeam = buildLayerDetailTeam(view);
    if (!detailTeam) return;
    setDetailMode('thread');
    setDetailSelectedTeam(detailTeam);
    setSelectedSessionId(view.sessionId);
    setSelectedHandoffId(null);
  };

  const handleSelectHandoff = (entry: HandoffEntry) => {
    setSelectedHandoffId(entry.id);
    setDetailMode('thread');
    const threadSessionId =
      resolveFlowHandoffSessionId(entry, scopedNodes) ?? entry.fromSessionId ?? null;
    setDetailSelectedTeam(buildHandoffDetailTeam(entry, threadSessionId));
    if (threadSessionId) setSelectedSessionId(threadSessionId);
  };

  const handleSelectHandoffById = (handoffId: string) => {
    const entry = scopedHandoffs.get(handoffId);
    if (entry) handleSelectHandoff(entry);
  };

  const handleSelectLane = (layer: TeamRoleLayer) => {
    const node = Array.from(scopedNodes.values()).find((item) => item.roleLayer === layer);
    if (!node) return;
    openDetailForLayerView({
      active: false,
      inboundCount: 0,
      layer,
      roleInstances: [
        {
          displayName: node.displayName ?? null,
          personaKey: node.personaKey ?? null,
          sessionId: node.sessionId,
          state: node.state,
        },
      ],
      sessionId: node.sessionId,
      state: node.state,
    });
  };

  if (scopedHandoffs.size === 0 && scopedNodes.size === 0) {
    return (
      <TabContainer
        title="层级流动"
        subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成泳道轨迹。"
      >
        <EmptyState
          emoji="🪜"
          title="还没有跨层流动"
          description="当前会话还停留在接待层直接对话。一旦你提出需要规划/执行的任务，团队会展开 接待 → 规划 → 管控 → 执行 → 评审 的层级协作，过程会在这里实时画成泳道轨迹。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="层级流动"
      subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成泳道轨迹；曲线从来源层指向目标层，打回与重试形成回折。"
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
          padding: '10px 12px',
        }}
      >
        {/* 说明条：固定内容高度——team-conv-panel 自带 flex:1（会被父级拉伸），必须显式 flex:none + 横向排列 */}
        <div
          className="team-conv-panel"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            flex: 'none',
            gap: 12,
            padding: '8px 12px',
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-muted)',
              lineHeight: 1.5,
              minWidth: 0,
              flex: '1 1 240px',
            }}
          >
            每个节点 = 一次层间交接，连线从来源节点指向目标节点（打回 /
            重试会回折）。滚轮横向浏览，点击节点或泳道查看详情。
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="team-conv-stat-pill">
              活跃 <strong>{activeLinkCount}</strong>
            </span>
            <span className="team-conv-stat-pill">
              交接 <strong>{scopedHandoffs.size}</strong>
            </span>
            {handoffSpanMs > 0 ? (
              <span className="team-conv-stat-pill" data-tone="accent">
                跨度 <strong>{formatTraceDuration(handoffSpanMs)}</strong>
              </span>
            ) : null}
            <SegmentedToggle<LayerFlowDensityMode>
              ariaLabel="层级流动密度模式"
              size="sm"
              value={flowDensityMode}
              onChange={setFlowDensityMode}
              options={[
                { value: 'active', label: '活跃', icon: '⚡' },
                { value: 'all', label: '全部', icon: '🗂️' },
              ]}
            />
          </div>
        </div>

        <div
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
              : {
                  flex: 1,
                  minHeight: 0,
                  display: 'grid',
                  gridTemplateColumns: showDetailPane
                    ? 'minmax(0, 1fr) minmax(340px, 420px)'
                    : 'minmax(0, 1fr)',
                  gap: 12,
                  overflow: 'hidden',
                }
          }
        >
          <div
            ref={swimlaneWrapperRef}
            style={
              isNarrowLayout
                ? showDetailPane
                  ? {
                      display: 'flex',
                      flexDirection: 'column',
                      flex: '0 0 auto',
                      height: 320,
                      minHeight: 0,
                      minWidth: 0,
                      overflowY: 'auto',
                    }
                  : {
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      overflowY: 'auto',
                    }
                : {
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    minHeight: 0,
                    overflowY: 'auto',
                  }
            }
          >
            <LayerFlowSwimlane
              availableHeight={swimlaneAvailableHeight}
              model={swimlaneModel}
              onSelectHandoff={handleSelectHandoffById}
              onSelectLane={handleSelectLane}
              selectedHandoffId={selectedHandoffId}
              totalHandoffCount={scopedHandoffs.size}
            />
          </div>

          {showDetailPane ? (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
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
          ) : null}
        </div>
      </div>
    </TabContainer>
  );
}
