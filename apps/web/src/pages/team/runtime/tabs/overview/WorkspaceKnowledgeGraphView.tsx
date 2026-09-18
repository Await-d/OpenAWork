/**
 * 260530-team-page · Wave 4 · WorkspaceKnowledgeGraphView（F1 知识图谱视图）
 *
 * 把 buildKnowledgeGraph 派生的节点/边渲染成工作区知识资产图：
 *   - 工作区根节点连接架构、规则、记忆、产物分类；
 *   - 指令栈中的 architecture / constitution / memory 片段作为知识节点；
 *   - artifact 作为知识产物节点，并用 parentArtifactId 建立派生关系；
 *   - 支持实时力模拟、缩放、拖拽平移、节点拖拽和局部图裁剪。
 *
 * 规模化聚合：生产图谱常达 1000+ 节点，全量铺环不可读。视图把结构计算（搜索过滤 / 局部深度）
 * 交给纯模块，再用 `projectVisibleGraph` 投影出**有界**的可见子集：折叠聚合按需展开，
 * 搜索自动展开命中祖先，超过渲染上限时强制收起更深层而不是拒绝渲染。
 * Canvas 负责图谱绘制，React 保留工具栏、详情面板、可访问标签和入库操作。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildKnowledgeGraph, type GraphRoleLayer } from '../../data/build-knowledge-graph.js';
import { workspaceKnowledgeRoleLayerFromSearchTerm } from '../../data/workspace-knowledge-key-classification.js';
import { useTeamWorkspaceKnowledge } from '../../hooks/use-team-workspace-knowledge.js';
import { useTeamTabState } from '../../../hooks/team-session-view-state-context.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState } from '../../shared/content-kit/index.js';
import type {
  KnowledgeGraphColorMode,
  KnowledgeGraphLabelDensity,
} from './graph/knowledge-graph-canvas.js';
import { ROLE_LAYER_ORDER } from './graph/knowledge-graph-constants.js';
import { projectVisibleGraph } from './graph/knowledge-graph-aggregation.js';
import { filterGraphByLocalDepth } from './graph/knowledge-graph-local-graph.js';
import type { GraphViewportSize } from './graph/knowledge-graph-layout.js';
import { filterGraphByQuery, filterGraphSemanticOrphans } from './graph/knowledge-graph-search.js';
import { KnowledgeNodeInspector } from './workspace-knowledge-graph-inspector.js';
import { KnowledgeGraphNoMatchView } from './workspace-knowledge-graph-no-match-view.js';
import { WorkspaceKnowledgeGraphFooter } from './workspace-knowledge-graph-footer.js';
import { WorkspaceKnowledgeGraphStage } from './workspace-knowledge-graph-stage.js';
import {
  GraphToolbar,
  type GraphExpandGroupControl,
  type GraphToolbarProps,
  type LocalGraphDepth,
} from './workspace-knowledge-graph-toolbar.js';
import { useKnowledgeGraphExpansion } from './use-workspace-knowledge-graph-expansion.js';
import {
  canPersistNode,
  defaultLocalGraphDepthForNode,
  defaultRoleLayersForNode,
  knowledgeValueForNode,
  nextAutoLocalGraphDepth,
  priorityForMemoryType,
} from './workspace-knowledge-graph-view-helpers.js';

/**
 * 可见节点渲染上限。聚合投影保证渲染节点恒有界：超过上限时强制收起更深层，
 * 因此这里不再拒绝渲染（旧的「图谱过大」空态已移除）。
 */
const MAX_RENDER_NODES = 1200;
/** 逐组展开控件的上限：每次求值都要投影一次可见集，控件过多会拖慢重渲染。 */
const EXPAND_GROUP_CONTROL_LIMIT = 6;
type LocalGraphSelectionMode = 'auto' | 'manual';

export interface WorkspaceKnowledgeGraphViewProps {
  activeWorkspaceName?: string;
  teamWorkspaceId?: string | null;
}

export function WorkspaceKnowledgeGraphView({
  activeWorkspaceName,
  teamWorkspaceId,
}: WorkspaceKnowledgeGraphViewProps) {
  const [queryDraft, setQueryDraft] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  // 持久化层用 '' 表示「全部层级」（TeamTabStateValue 不支持 null），渲染期映射回 activeRoleLayer。
  const [activeRoleLayerValue, setActiveRoleLayerValue] = useTeamTabState<GraphRoleLayer | ''>(
    'graph.activeRoleLayer',
    '',
  );
  const activeRoleLayer: GraphRoleLayer | null =
    activeRoleLayerValue === '' ? null : activeRoleLayerValue;
  const {
    artifacts: workspaceArtifacts,
    error: workspaceKnowledgeError,
    instructionSegments,
    loading: workspaceKnowledgeLoading,
    persistedKnowledge,
    persistedKnowledgeTruncated,
    saveKnowledge,
    storedKnowledge,
  } = useTeamWorkspaceKnowledge(teamWorkspaceId ?? null, {
    roleLayer: activeRoleLayer ?? undefined,
    search: appliedQuery,
  });

  const graph = useMemo(() => {
    return buildKnowledgeGraph({
      artifacts: workspaceArtifacts.map((a) => ({
        content: a.content,
        id: a.id,
        parentArtifactId: a.parentArtifactId,
        phase: a.phase,
        title: a.title,
        type: a.type,
      })),
      instructionSegments,
      persistedKnowledge: persistedKnowledge.map((item) => ({
        enabled: item.enabled,
        id: item.id,
        key: item.key,
        roleLayers: item.roleLayers,
        source: item.source,
        type: item.type,
        value: item.value,
      })),
      storedKnowledge: storedKnowledge.map((item) => ({
        enabled: item.enabled,
        id: item.id,
        key: item.key,
        roleLayers: item.roleLayers,
        source: item.source,
        type: item.type,
        value: item.value,
      })),
      workspace: {
        id: teamWorkspaceId,
        name: activeWorkspaceName,
      },
    });
  }, [
    activeWorkspaceName,
    instructionSegments,
    persistedKnowledge,
    storedKnowledge,
    teamWorkspaceId,
    workspaceArtifacts,
  ]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [resetVersion, setResetVersion] = useState(0);
  const [labelDensity, setLabelDensity] = useTeamTabState<KnowledgeGraphLabelDensity>(
    'graph.labelDensity',
    'auto',
  );
  const [colorMode, setColorMode] = useTeamTabState<KnowledgeGraphColorMode>(
    'graph.colorMode',
    'group',
  );
  const [hideOrphans, setHideOrphans] = useTeamTabState<boolean>('graph.hideOrphans', false);
  const [localGraphDepth, setLocalGraphDepth] = useTeamTabState<LocalGraphDepth>(
    'graph.localGraphDepth',
    0,
  );
  const [localGraphSelectionMode, setLocalGraphSelectionMode] =
    useTeamTabState<LocalGraphSelectionMode>('graph.localGraphSelectionMode', 'auto');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [selectedRoleLayers, setSelectedRoleLayers] = useState<GraphRoleLayer[] | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<GraphViewportSize | null>(null);

  // 展开不再被容量拒绝（力导向布局密度由斥力与聚合默认值控制）；渲染上限由投影层优雅降级。
  const {
    expandedIds,
    descendantCounts,
    toggleExpand,
    expandAll,
    collapseAll,
    expandAllBlocked,
    forceVisibleIds,
    capacityNotice,
    capacityBlockedIds,
    isExpandBlocked,
  } = useKnowledgeGraphExpansion(graph, appliedQuery, teamWorkspaceId ?? null, { viewportSize });

  const expandAllDisabled = expandAllBlocked;
  const expandAllDisabledReason = '展开全部当前不可用。';
  const handleExpandAll = useCallback(() => {
    if (expandAllDisabled) {
      return;
    }
    expandAll();
  }, [expandAll, expandAllDisabled]);

  const graphBeforeLocalDepth = useMemo(() => {
    const searched = filterGraphByQuery(graph, appliedQuery);
    return hideOrphans ? filterGraphSemanticOrphans(searched) : searched;
  }, [appliedQuery, graph, hideOrphans]);
  const localGraphEnabled = selectedNodeId
    ? graphBeforeLocalDepth.nodes.some((node) => node.id === selectedNodeId)
    : false;
  const effectiveLocalGraphDepth = localGraphEnabled ? localGraphDepth : 0;

  const projection = useMemo(
    () =>
      projectVisibleGraph(
        filterGraphByLocalDepth(graphBeforeLocalDepth, selectedNodeId, effectiveLocalGraphDepth),
        expandedIds,
        {
          counts: descendantCounts,
          expandAll: effectiveLocalGraphDepth > 0,
          forceVisibleIds,
          maxNodes: MAX_RENDER_NODES,
        },
      ),
    [
      descendantCounts,
      effectiveLocalGraphDepth,
      expandedIds,
      forceVisibleIds,
      graphBeforeLocalDepth,
      selectedNodeId,
    ],
  );
  const visibleGraph = projection.graph;
  const collapsedIds = projection.collapsedIds;

  // 逐组展开控件：禁用态由**当前**视口容量决定（`isExpandBlocked`），放大窗口后自动恢复可用。
  const expandGroups = useMemo<readonly GraphExpandGroupControl[]>(
    () =>
      visibleGraph.nodes
        .filter((node) => collapsedIds.has(node.id))
        .slice(0, EXPAND_GROUP_CONTROL_LIMIT)
        .map((node) => ({
          id: node.id,
          label: node.label,
          blocked: isExpandBlocked(node.id),
        })),
    [collapsedIds, isExpandBlocked, visibleGraph.nodes],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setResetVersion((version) => version + 1);
  }, []);

  const selectedNode = useMemo(
    () => visibleGraph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, visibleGraph.nodes],
  );

  const clearSelectionContext = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedRoleLayers(null);
    setLocalGraphDepth(0);
    setLocalGraphSelectionMode('auto');
    setOperationError(null);
    setOperationMessage(null);
  }, [setLocalGraphDepth, setLocalGraphSelectionMode]);

  const handleApplyQuery = useCallback(() => {
    const normalizedQuery = queryDraft.trim();
    const inferredRoleLayer = workspaceKnowledgeRoleLayerFromSearchTerm(normalizedQuery);
    const nextAppliedQuery = inferredRoleLayer === undefined ? normalizedQuery : '';
    const roleLayerUnchanged =
      inferredRoleLayer === undefined || inferredRoleLayer === activeRoleLayer;
    if (nextAppliedQuery === appliedQuery && roleLayerUnchanged) {
      return;
    }
    if (inferredRoleLayer !== undefined) {
      setActiveRoleLayerValue(inferredRoleLayer ?? '');
      setQueryDraft('');
    }
    setAppliedQuery(nextAppliedQuery);
    clearSelectionContext();
  }, [activeRoleLayer, appliedQuery, clearSelectionContext, queryDraft, setActiveRoleLayerValue]);

  const handleClearQuery = useCallback(() => {
    if (workspaceKnowledgeRoleLayerFromSearchTerm(appliedQuery) !== undefined) {
      setActiveRoleLayerValue('');
    }
    setQueryDraft('');
    setAppliedQuery('');
    clearSelectionContext();
  }, [appliedQuery, clearSelectionContext, setActiveRoleLayerValue]);

  const handleHideOrphansChange = useCallback(
    (hide: boolean) => {
      setHideOrphans(hide);
      clearSelectionContext();
    },
    [clearSelectionContext, setHideOrphans],
  );

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }
    const selectedNodeStillVisible = graphBeforeLocalDepth.nodes.some(
      (node) => node.id === selectedNodeId,
    );
    if (!selectedNodeStillVisible) {
      clearSelectionContext();
    }
  }, [clearSelectionContext, graphBeforeLocalDepth.nodes, selectedNodeId]);

  const handleSelectRoleLayer = useCallback(
    (roleLayer: GraphRoleLayer | null) => {
      if (roleLayer === activeRoleLayer) {
        return;
      }
      setActiveRoleLayerValue(roleLayer ?? '');
      setSelectedRoleLayers(defaultRoleLayersForNode(selectedNode, roleLayer));
      setOperationError(null);
      setOperationMessage(null);
    },
    [activeRoleLayer, selectedNode, setActiveRoleLayerValue],
  );

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      const node = visibleGraph.nodes.find((item) => item.id === nodeId) ?? null;
      setSelectedNodeId(nodeId);
      setSelectedRoleLayers(defaultRoleLayersForNode(node, activeRoleLayer));
      if (localGraphSelectionMode === 'auto') {
        setLocalGraphDepth(
          nextAutoLocalGraphDepth(localGraphDepth, defaultLocalGraphDepthForNode(node)),
        );
      }
      setOperationError(null);
      setOperationMessage(null);
    },
    [
      activeRoleLayer,
      localGraphDepth,
      localGraphSelectionMode,
      setLocalGraphDepth,
      visibleGraph.nodes,
    ],
  );

  const handleLocalGraphDepthChange = useCallback(
    (depth: LocalGraphDepth) => {
      setLocalGraphSelectionMode('manual');
      setLocalGraphDepth(depth);
    },
    [setLocalGraphDepth, setLocalGraphSelectionMode],
  );

  const handleUseAutoLocalGraph = useCallback(() => {
    setLocalGraphSelectionMode('auto');
    setLocalGraphDepth(defaultLocalGraphDepthForNode(selectedNode));
  }, [selectedNode, setLocalGraphDepth, setLocalGraphSelectionMode]);

  const handleToggleRoleLayer = useCallback((roleLayer: GraphRoleLayer) => {
    setSelectedRoleLayers((current) => {
      if (current === null) {
        return [roleLayer];
      }
      const base = current;
      if (base.includes(roleLayer)) {
        const next = base.filter((item) => item !== roleLayer);
        return next.length === 0 ? null : next;
      }
      return ROLE_LAYER_ORDER.filter((item) => item === roleLayer || base.includes(item));
    });
  }, []);

  const handleUseAllRoleLayers = useCallback(() => {
    setSelectedRoleLayers(null);
  }, []);

  const handlePersistSelectedNode = useCallback(async () => {
    if (!selectedNode || !canPersistNode(selectedNode)) {
      return;
    }
    const value = knowledgeValueForNode(selectedNode);
    if (!value) {
      setOperationError('该节点没有可入库内容。');
      setOperationMessage(null);
      return;
    }
    setSavingNodeId(selectedNode.id);
    setOperationError(null);
    setOperationMessage(null);
    try {
      const knowledgeInput = {
        key: selectedNode.sourceRef,
        roleLayers: selectedRoleLayers,
        type: selectedNode.memoryType,
        value,
        ...(selectedNode.persistedMemoryId
          ? {}
          : {
              confidence: 1,
              priority: priorityForMemoryType(selectedNode.memoryType),
              source: 'manual' as const,
            }),
      };
      const result = await saveKnowledge(knowledgeInput);
      setOperationMessage(result.created ? '已入库知识。' : '已更新已入库知识。');
      setSelectedNodeId(selectedNode.id);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : '知识入库失败。');
    } finally {
      setSavingNodeId(null);
    }
  }, [saveKnowledge, selectedNode, selectedRoleLayers]);

  const visiblePersistedNodeCount = visibleGraph.nodes.filter(
    (node) => node.persistedMemoryId,
  ).length;
  const persistedNodeCount = persistedKnowledge.filter((item) => item.enabled !== false).length;
  const graphSubtitle = '工作区知识、记忆、架构与产物链关系图。';
  const graphFilterActive = Boolean(appliedQuery) || activeRoleLayer !== null || hideOrphans;
  const localGraphAutoApplied = localGraphSelectionMode === 'auto' && localGraphDepth > 0;
  const toolbarProps: GraphToolbarProps = {
    activeRoleLayer,
    appliedQuery,
    colorMode,
    hideOrphans,
    labelDensity,
    localGraphAutoApplied,
    localGraphEnabled,
    localGraphDepth,
    queryDraft,
    onApplyQuery: handleApplyQuery,
    onCollapseAll: collapseAll,
    onColorModeChange: setColorMode,
    onClearQuery: handleClearQuery,
    onExpandAll: handleExpandAll,
    expandAllDisabled,
    expandAllDisabledReason,
    expandGroups,
    onExpandGroup: toggleExpand,
    onHideOrphansChange: handleHideOrphansChange,
    onLabelDensityChange: setLabelDensity,
    onLocalGraphDepthChange: handleLocalGraphDepthChange,
    onUseAutoLocalGraph: handleUseAutoLocalGraph,
    onSelectRoleLayer: handleSelectRoleLayer,
    onQueryDraftChange: setQueryDraft,
  };

  if (workspaceKnowledgeLoading && graph.nodes.length === 0 && !graphFilterActive) {
    return (
      <TabContainer title="知识图谱" subtitle={graphSubtitle}>
        <EmptyState
          emoji="🕸️"
          title="加载图谱中…"
          description="正在拉取工作区知识、记忆、架构与产物链。"
        />
      </TabContainer>
    );
  }

  if (workspaceKnowledgeError && graph.nodes.length === 0 && !graphFilterActive) {
    return (
      <TabContainer title="知识图谱" subtitle={graphSubtitle}>
        <EmptyState emoji="⚠️" title="图谱加载失败" description={workspaceKnowledgeError} />
      </TabContainer>
    );
  }

  if (graph.nodes.length === 0) {
    if (graphFilterActive) {
      return (
        <KnowledgeGraphNoMatchView
          graphSubtitle={graphSubtitle}
          toolbar={toolbarProps}
          workspaceKnowledgeError={workspaceKnowledgeError}
          workspaceKnowledgeLoading={workspaceKnowledgeLoading}
        />
      );
    }
    return (
      <TabContainer title="知识图谱" subtitle={graphSubtitle}>
        <EmptyState
          emoji="🕸️"
          title="暂无图谱数据"
          description="配置架构说明、项目记忆、团队宪法或产生工作区 artifact 后，这里会展示它们之间的知识关系。"
        />
      </TabContainer>
    );
  }

  if (visibleGraph.nodes.length === 0) {
    return (
      <KnowledgeGraphNoMatchView
        graphSubtitle={graphSubtitle}
        toolbar={toolbarProps}
        workspaceKnowledgeError={workspaceKnowledgeError}
        workspaceKnowledgeLoading={workspaceKnowledgeLoading}
      />
    );
  }

  return (
    <TabContainer title="知识图谱" subtitle={graphSubtitle} scroll={false}>
      <div className="workspace-knowledge-graph-content">
        <GraphToolbar {...toolbarProps} />
        {workspaceKnowledgeError ? (
          <span className="workspace-knowledge-graph-inline-alert" role="status">
            图谱数据可能不完整：{workspaceKnowledgeError}
          </span>
        ) : null}
        {capacityNotice ? (
          <span className="workspace-knowledge-graph-capacity-notice" role="status">
            {capacityNotice}
          </span>
        ) : null}
        <WorkspaceKnowledgeGraphStage
          capacityBlockedIds={capacityBlockedIds}
          collapsedIds={collapsedIds}
          colorMode={colorMode}
          counts={projection.hiddenCounts}
          graph={visibleGraph}
          labelDensity={labelDensity}
          pan={pan}
          resetVersion={resetVersion}
          selectedNodeId={selectedNodeId}
          zoom={zoom}
          inspector={
            <KnowledgeNodeInspector
              error={operationError}
              message={operationMessage}
              node={selectedNode}
              activeRoleLayer={activeRoleLayer}
              onPersist={handlePersistSelectedNode}
              onToggleRoleLayer={handleToggleRoleLayer}
              onUseAllRoleLayers={handleUseAllRoleLayers}
              onLocalGraphDepthChange={handleLocalGraphDepthChange}
              onUseAutoLocalGraph={handleUseAutoLocalGraph}
              localGraphAutoApplied={localGraphAutoApplied}
              localGraphDepth={effectiveLocalGraphDepth}
              persistable={selectedNode ? canPersistNode(selectedNode) : false}
              selectedRoleLayers={selectedRoleLayers}
              saving={savingNodeId === selectedNode?.id}
            />
          }
          onPanChange={setPan}
          onResetView={resetView}
          onSelectNode={handleSelectNode}
          onToggleExpand={toggleExpand}
          onViewportSizeChange={setViewportSize}
          onZoomChange={setZoom}
          onZoomIn={() => setZoom((z) => Math.min(2.8, z + 0.2))}
          onZoomOut={() => setZoom((z) => Math.max(0.35, z - 0.2))}
        />
        <WorkspaceKnowledgeGraphFooter
          activeRoleLayer={activeRoleLayer}
          effectiveLocalGraphDepth={effectiveLocalGraphDepth}
          labelDensity={labelDensity}
          persistedNodeCount={persistedNodeCount}
          persistedTruncated={persistedKnowledgeTruncated}
          persistedVisibleCount={visiblePersistedNodeCount}
          totalNodeCount={graph.nodes.length}
          visibleEdgeCount={visibleGraph.edges.length}
          visibleNodeCount={visibleGraph.nodes.length}
        />
      </div>
    </TabContainer>
  );
}
