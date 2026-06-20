/**
 * 260530-team-page · Wave 4 · WorkspaceKnowledgeGraphView（F1 知识图谱视图）
 *
 * 把 buildKnowledgeGraph 派生的节点/边用 Canvas + d3-force 渲染成工作区知识资产图：
 *   - 工作区根节点连接架构、规则、记忆、产物分类；
 *   - 指令栈中的 architecture / constitution / memory 片段作为知识节点；
 *   - artifact 作为知识产物节点，并用 parentArtifactId 建立派生关系；
 *   - 支持实时力模拟、缩放、拖拽平移、节点拖拽和局部图裁剪。
 *
 * Canvas 负责图谱绘制，React 保留工具栏、详情面板、可访问标签和入库操作。
 * 节点上限护栏：超过 MAX_NODES 时提示用户图过大。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildKnowledgeGraph,
  type GraphNode,
  type GraphMemoryType,
  type GraphRoleLayer,
  type KnowledgeGraph,
} from '../../data/build-knowledge-graph.js';
import {
  workspaceKnowledgeKeyMatchesSemanticSearch,
  workspaceKnowledgeKeySearchLabel,
  workspaceKnowledgeRoleLayerFromSearchTerm,
  workspaceKnowledgeRoleLayerSearchKind,
  workspaceKnowledgeRoleLayersMatchSearch,
  workspaceKnowledgeSemanticSearchKind,
  type WorkspaceKnowledgeRoleLayerSearchKind,
  type WorkspaceKnowledgeSemanticSearchKind,
} from '../../data/workspace-knowledge-key-classification.js';
import { isWholeWorkspaceKnowledgeSearchTerm } from '../../data/workspace-knowledge-search.js';
import { useTeamWorkspaceKnowledge } from '../../hooks/use-team-workspace-knowledge.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState } from '../../shared/content-kit/index.js';
import { GraphLegend } from './workspace-knowledge-graph-render.js';
import {
  WorkspaceKnowledgeGraphCanvas,
  type KnowledgeGraphColorMode,
  type KnowledgeGraphForceSettings,
  type KnowledgeGraphLabelDensity,
} from './workspace-knowledge-graph-canvas.js';
import { GraphBtn } from './workspace-knowledge-graph-controls.js';
import {
  MAX_KNOWLEDGE_VALUE_LENGTH,
  ROLE_LAYER_LABELS,
  ROLE_LAYER_ORDER,
} from './workspace-knowledge-graph-constants.js';
import { KnowledgeNodeInspector } from './workspace-knowledge-graph-inspector.js';
import {
  GraphForceControls,
  GraphToolbar,
  type LocalGraphDepth,
} from './workspace-knowledge-graph-toolbar.js';

const MAX_NODES = 1200;
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
  const [activeRoleLayer, setActiveRoleLayer] = useState<GraphRoleLayer | null>(null);
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
  const [labelDensity, setLabelDensity] = useState<KnowledgeGraphLabelDensity>('auto');
  const [colorMode, setColorMode] = useState<KnowledgeGraphColorMode>('group');
  const [hideOrphans, setHideOrphans] = useState(false);
  const [localGraphDepth, setLocalGraphDepth] = useState<LocalGraphDepth>(0);
  const [localGraphSelectionMode, setLocalGraphSelectionMode] =
    useState<LocalGraphSelectionMode>('auto');
  const [forceSettings, setForceSettings] = useState<KnowledgeGraphForceSettings>({
    center: 0.08,
    distance: 112,
    link: 0.18,
    repel: 230,
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [selectedRoleLayers, setSelectedRoleLayers] = useState<GraphRoleLayer[] | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const graphBeforeLocalDepth = useMemo(() => {
    const searched = filterGraphByQuery(graph, appliedQuery);
    return hideOrphans ? filterGraphSemanticOrphans(searched) : searched;
  }, [appliedQuery, graph, hideOrphans]);
  const localGraphEnabled = selectedNodeId
    ? graphBeforeLocalDepth.nodes.some((node) => node.id === selectedNodeId)
    : false;
  const effectiveLocalGraphDepth = localGraphEnabled ? localGraphDepth : 0;
  const visibleGraph = useMemo(() => {
    return filterGraphByLocalDepth(graphBeforeLocalDepth, selectedNodeId, effectiveLocalGraphDepth);
  }, [effectiveLocalGraphDepth, graphBeforeLocalDepth, selectedNodeId]);

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
  }, []);

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
      setActiveRoleLayer(inferredRoleLayer);
      setQueryDraft('');
    }
    setAppliedQuery(nextAppliedQuery);
    clearSelectionContext();
  }, [activeRoleLayer, appliedQuery, clearSelectionContext, queryDraft]);

  const handleClearQuery = useCallback(() => {
    if (workspaceKnowledgeRoleLayerFromSearchTerm(appliedQuery) !== undefined) {
      setActiveRoleLayer(null);
    }
    setQueryDraft('');
    setAppliedQuery('');
    clearSelectionContext();
  }, [appliedQuery, clearSelectionContext]);

  const handleHideOrphansChange = useCallback(
    (hide: boolean) => {
      setHideOrphans(hide);
      clearSelectionContext();
    },
    [clearSelectionContext],
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
      setActiveRoleLayer(roleLayer);
      setSelectedRoleLayers(defaultRoleLayersForNode(selectedNode, roleLayer));
      setOperationError(null);
      setOperationMessage(null);
    },
    [activeRoleLayer, selectedNode],
  );

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      const node = visibleGraph.nodes.find((item) => item.id === nodeId) ?? null;
      setSelectedNodeId(nodeId);
      setSelectedRoleLayers(defaultRoleLayersForNode(node, activeRoleLayer));
      if (localGraphSelectionMode === 'auto') {
        setLocalGraphDepth((currentDepth) =>
          nextAutoLocalGraphDepth(currentDepth, defaultLocalGraphDepthForNode(node)),
        );
      }
      setOperationError(null);
      setOperationMessage(null);
    },
    [activeRoleLayer, localGraphSelectionMode, visibleGraph.nodes],
  );

  const handleLocalGraphDepthChange = useCallback((depth: LocalGraphDepth) => {
    setLocalGraphSelectionMode('manual');
    setLocalGraphDepth(depth);
  }, []);

  const handleUseAutoLocalGraph = useCallback(() => {
    setLocalGraphSelectionMode('auto');
    setLocalGraphDepth(defaultLocalGraphDepthForNode(selectedNode));
  }, [selectedNode]);

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

  const knowledgeNodeCount = visibleGraph.nodes.filter(
    (n) => n.kind !== 'workspace' && n.kind !== 'category',
  ).length;
  const visiblePersistedNodeCount = visibleGraph.nodes.filter(
    (node) => node.persistedMemoryId,
  ).length;
  const persistedNodeCount = persistedKnowledge.filter((item) => item.enabled !== false).length;
  const graphSubtitle = '工作区知识、记忆、架构与产物链关系图。';
  const graphFilterActive = Boolean(appliedQuery) || activeRoleLayer !== null || hideOrphans;

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
          activeRoleLayer={activeRoleLayer}
          appliedQuery={appliedQuery}
          colorMode={colorMode}
          graphSubtitle={graphSubtitle}
          hideOrphans={hideOrphans}
          labelDensity={labelDensity}
          localGraphAutoApplied={localGraphSelectionMode === 'auto' && localGraphDepth > 0}
          localGraphEnabled={localGraphEnabled}
          localGraphDepth={localGraphDepth}
          queryDraft={queryDraft}
          workspaceKnowledgeError={workspaceKnowledgeError}
          workspaceKnowledgeLoading={workspaceKnowledgeLoading}
          onApplyQuery={handleApplyQuery}
          onColorModeChange={setColorMode}
          onClearQuery={handleClearQuery}
          onHideOrphansChange={handleHideOrphansChange}
          onLabelDensityChange={setLabelDensity}
          onLocalGraphDepthChange={handleLocalGraphDepthChange}
          onUseAutoLocalGraph={handleUseAutoLocalGraph}
          onSelectRoleLayer={handleSelectRoleLayer}
          onQueryDraftChange={setQueryDraft}
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
        activeRoleLayer={activeRoleLayer}
        appliedQuery={appliedQuery}
        colorMode={colorMode}
        graphSubtitle={graphSubtitle}
        hideOrphans={hideOrphans}
        labelDensity={labelDensity}
        localGraphAutoApplied={localGraphSelectionMode === 'auto' && localGraphDepth > 0}
        localGraphEnabled={localGraphEnabled}
        localGraphDepth={localGraphDepth}
        queryDraft={queryDraft}
        onApplyQuery={handleApplyQuery}
        onColorModeChange={setColorMode}
        onClearQuery={handleClearQuery}
        onHideOrphansChange={handleHideOrphansChange}
        onLabelDensityChange={setLabelDensity}
        onLocalGraphDepthChange={handleLocalGraphDepthChange}
        onUseAutoLocalGraph={handleUseAutoLocalGraph}
        onSelectRoleLayer={handleSelectRoleLayer}
        onQueryDraftChange={setQueryDraft}
        workspaceKnowledgeError={workspaceKnowledgeError}
        workspaceKnowledgeLoading={workspaceKnowledgeLoading}
      />
    );
  }

  if (visibleGraph.nodes.length > MAX_NODES) {
    return (
      <TabContainer title="知识图谱" subtitle={graphSubtitle}>
        <EmptyState
          emoji="🗺️"
          title="图谱过大"
          description={`当前共有 ${visibleGraph.nodes.length} 个节点，超过 ${MAX_NODES} 的渲染上限。请缩小工作区 artifact 范围后再查看。`}
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer title="知识图谱" subtitle={graphSubtitle}>
      <div className="workspace-knowledge-graph-content">
        <GraphToolbar
          activeRoleLayer={activeRoleLayer}
          appliedQuery={appliedQuery}
          colorMode={colorMode}
          hideOrphans={hideOrphans}
          labelDensity={labelDensity}
          localGraphAutoApplied={localGraphSelectionMode === 'auto' && localGraphDepth > 0}
          localGraphEnabled={localGraphEnabled}
          localGraphDepth={localGraphDepth}
          queryDraft={queryDraft}
          onApplyQuery={handleApplyQuery}
          onColorModeChange={setColorMode}
          onClearQuery={handleClearQuery}
          onHideOrphansChange={handleHideOrphansChange}
          onLabelDensityChange={setLabelDensity}
          onLocalGraphDepthChange={handleLocalGraphDepthChange}
          onUseAutoLocalGraph={handleUseAutoLocalGraph}
          onSelectRoleLayer={handleSelectRoleLayer}
          onQueryDraftChange={setQueryDraft}
        />
        {workspaceKnowledgeError ? (
          <span className="workspace-knowledge-graph-inline-alert" role="status">
            图谱数据可能不完整：{workspaceKnowledgeError}
          </span>
        ) : null}
        <div className="workspace-knowledge-graph-layout">
          <div className="workspace-knowledge-graph-canvas-shell">
            <WorkspaceKnowledgeGraphCanvas
              colorMode={colorMode}
              forceSettings={forceSettings}
              graph={visibleGraph}
              labelDensity={labelDensity}
              localGraphDepth={effectiveLocalGraphDepth}
              pan={pan}
              resetVersion={resetVersion}
              selectedNodeId={selectedNodeId}
              zoom={zoom}
              onPanChange={setPan}
              onSelectNode={handleSelectNode}
              onZoomChange={setZoom}
            />
            <div className="workspace-knowledge-graph-canvas-overlay-top-left">
              <div className="workspace-knowledge-graph-zoom-cluster">
                <GraphBtn
                  label="−"
                  title="缩小"
                  onClick={() => setZoom((z) => Math.max(0.35, z - 0.2))}
                />
                <span className="workspace-knowledge-graph-zoom-display">
                  {Math.round(zoom * 100)}%
                </span>
                <GraphBtn
                  label="+"
                  title="放大"
                  onClick={() => setZoom((z) => Math.min(2.8, z + 0.2))}
                />
                <GraphBtn label="复位" onClick={resetView} />
              </div>
            </div>
            <details className="workspace-knowledge-graph-settings-panel">
              <summary>布局</summary>
              <GraphForceControls
                forceSettings={forceSettings}
                onForceSettingsChange={setForceSettings}
              />
            </details>
          </div>
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
            localGraphAutoApplied={localGraphSelectionMode === 'auto' && localGraphDepth > 0}
            localGraphDepth={effectiveLocalGraphDepth}
            persistable={selectedNode ? canPersistNode(selectedNode) : false}
            selectedRoleLayers={selectedRoleLayers}
            saving={savingNodeId === selectedNode?.id}
          />
        </div>
        <div className="workspace-knowledge-graph-footer">
          <GraphLegend />
          <span className="workspace-knowledge-graph-status-strip">
            {knowledgeNodeCount} 节点 · {visibleGraph.edges.length} 关系 · 已入库{' '}
            {persistedCountLabel(
              visiblePersistedNodeCount,
              persistedNodeCount,
              persistedKnowledgeTruncated,
            )}{' '}
            · {roleLayerPreviewLabel(activeRoleLayer)} · 局部图{' '}
            {effectiveLocalGraphDepth === 0 ? '关闭' : `${effectiveLocalGraphDepth} 跳`} · 标签{' '}
            {labelDensityLabel(labelDensity)}
          </span>
        </div>
      </div>
    </TabContainer>
  );
}

function KnowledgeGraphNoMatchView({
  activeRoleLayer,
  appliedQuery,
  colorMode,
  graphSubtitle,
  hideOrphans,
  labelDensity,
  localGraphAutoApplied,
  localGraphEnabled,
  localGraphDepth,
  onApplyQuery,
  onColorModeChange,
  onClearQuery,
  onHideOrphansChange,
  onLabelDensityChange,
  onLocalGraphDepthChange,
  onUseAutoLocalGraph,
  onSelectRoleLayer,
  onQueryDraftChange,
  queryDraft,
  workspaceKnowledgeError,
  workspaceKnowledgeLoading,
}: {
  activeRoleLayer: GraphRoleLayer | null;
  appliedQuery: string;
  colorMode: KnowledgeGraphColorMode;
  graphSubtitle: string;
  hideOrphans: boolean;
  labelDensity: KnowledgeGraphLabelDensity;
  localGraphAutoApplied: boolean;
  localGraphEnabled: boolean;
  localGraphDepth: LocalGraphDepth;
  onApplyQuery: () => void;
  onColorModeChange: (mode: KnowledgeGraphColorMode) => void;
  onClearQuery: () => void;
  onHideOrphansChange: (hide: boolean) => void;
  onLabelDensityChange: (density: KnowledgeGraphLabelDensity) => void;
  onLocalGraphDepthChange: (depth: LocalGraphDepth) => void;
  onUseAutoLocalGraph: () => void;
  onSelectRoleLayer: (roleLayer: GraphRoleLayer | null) => void;
  onQueryDraftChange: (value: string) => void;
  queryDraft: string;
  workspaceKnowledgeError: string | null;
  workspaceKnowledgeLoading: boolean;
}) {
  const emptyTitle = workspaceKnowledgeError
    ? '图谱加载失败'
    : workspaceKnowledgeLoading
      ? '查询工作区知识中…'
      : '未找到匹配知识';
  const emptyDescription = workspaceKnowledgeNoMatchDescription({
    activeRoleLayer,
    appliedQuery,
    hideOrphans,
    workspaceKnowledgeError,
    workspaceKnowledgeLoading,
  });
  return (
    <TabContainer title="知识图谱" subtitle={graphSubtitle}>
      <div className="workspace-knowledge-graph-content">
        <GraphToolbar
          activeRoleLayer={activeRoleLayer}
          appliedQuery={appliedQuery}
          colorMode={colorMode}
          hideOrphans={hideOrphans}
          labelDensity={labelDensity}
          localGraphAutoApplied={localGraphAutoApplied}
          localGraphEnabled={localGraphEnabled}
          localGraphDepth={localGraphDepth}
          queryDraft={queryDraft}
          onApplyQuery={onApplyQuery}
          onColorModeChange={onColorModeChange}
          onClearQuery={onClearQuery}
          onHideOrphansChange={onHideOrphansChange}
          onLabelDensityChange={onLabelDensityChange}
          onLocalGraphDepthChange={onLocalGraphDepthChange}
          onUseAutoLocalGraph={onUseAutoLocalGraph}
          onSelectRoleLayer={onSelectRoleLayer}
          onQueryDraftChange={onQueryDraftChange}
        />
        <EmptyState emoji="🕸️" title={emptyTitle} description={emptyDescription} />
      </div>
    </TabContainer>
  );
}

function workspaceKnowledgeNoMatchDescription({
  activeRoleLayer,
  appliedQuery,
  hideOrphans,
  workspaceKnowledgeError,
  workspaceKnowledgeLoading,
}: {
  activeRoleLayer: GraphRoleLayer | null;
  appliedQuery: string;
  hideOrphans: boolean;
  workspaceKnowledgeError: string | null;
  workspaceKnowledgeLoading: boolean;
}): string {
  if (workspaceKnowledgeError) {
    return workspaceKnowledgeError;
  }
  if (workspaceKnowledgeLoading) {
    return appliedQuery
      ? `正在查询「${appliedQuery}」相关的工作区知识。`
      : '正在加载当前筛选下的工作区知识。';
  }
  if (appliedQuery) {
    return `没有找到与「${appliedQuery}」匹配的工作区知识节点。`;
  }
  if (activeRoleLayer) {
    return `${ROLE_LAYER_LABELS[activeRoleLayer]}层当前没有可读取的工作区知识。可以切回全部层级，或调整知识入库读取范围。`;
  }
  if (hideOrphans) {
    return '隐藏孤点后没有可展示的知识节点。可以关闭隐藏孤点查看完整工作区知识。';
  }
  return '当前筛选下没有可展示的工作区知识节点。';
}

function roleLayerPreviewLabel(roleLayer: GraphRoleLayer | null): string {
  return roleLayer ? `${ROLE_LAYER_LABELS[roleLayer]}层` : '全部层级';
}

function persistedCountLabel(visibleCount: number, totalCount: number, truncated: boolean): string {
  const totalLabel = truncated ? `${totalCount}+` : `${totalCount}`;
  return visibleCount === totalCount && !truncated
    ? `${visibleCount}`
    : `${visibleCount} / 全图 ${totalLabel}`;
}

function defaultRoleLayersForNode(
  node: GraphNode | null,
  activeRoleLayer: GraphRoleLayer | null,
): GraphRoleLayer[] | null {
  if (!node) {
    return null;
  }
  if (node.roleLayers !== null) {
    return node.roleLayers;
  }
  if (node.persistedMemoryId) {
    return null;
  }
  return activeRoleLayer ? [activeRoleLayer] : null;
}

function defaultLocalGraphDepthForNode(node: GraphNode | null): LocalGraphDepth {
  if (!node || node.kind === 'workspace') {
    return 0;
  }
  return node.kind === 'category' ? 1 : 2;
}

function nextAutoLocalGraphDepth(
  currentDepth: LocalGraphDepth,
  nextDefaultDepth: LocalGraphDepth,
): LocalGraphDepth {
  if (nextDefaultDepth === 0) {
    return 0;
  }
  if (currentDepth === 0) {
    return nextDefaultDepth;
  }
  return currentDepth > nextDefaultDepth ? currentDepth : nextDefaultDepth;
}

function labelDensityLabel(labelDensity: KnowledgeGraphLabelDensity): string {
  switch (labelDensity) {
    case 'all':
      return '全部';
    case 'auto':
      return '自动';
    case 'focus':
      return '焦点';
  }
}

function filterGraphByQuery(graph: KnowledgeGraph, query: string): KnowledgeGraph {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return graph;
  }
  if (isWholeWorkspaceKnowledgeSearchTerm(normalized)) {
    return graph;
  }

  const keepNodeIds = new Set<string>();
  const matchedNodeIds = new Set<string>();
  const semanticSearchKind = workspaceKnowledgeSemanticSearchKind(normalized);
  const roleLayerSearchKind = workspaceKnowledgeRoleLayerSearchKind(normalized);

  for (const node of graph.nodes) {
    const matches = roleLayerSearchKind
      ? nodeMatchesRoleLayerSearch(node, roleLayerSearchKind)
      : semanticSearchKind
        ? nodeMatchesSemanticSearch(node, semanticSearchKind)
        : nodeSearchHaystack(node).includes(normalized);
    if (!matches) {
      continue;
    }

    if (node.kind === 'workspace') {
      return graph;
    }

    if (node.kind === 'category') {
      if (node.group === 'knowledge' && semanticSearchKind === 'artifact') {
        continue;
      }
      keepNodeIds.add(node.id);
      matchedNodeIds.add(node.id);
      for (const edge of graph.edges) {
        if (edge.kind === 'contains' && edge.from === node.id) {
          keepNodeIds.add(edge.to);
          matchedNodeIds.add(edge.to);
        }
      }
      continue;
    }

    keepNodeIds.add(node.id);
    matchedNodeIds.add(node.id);
  }

  if (matchedNodeIds.size === 0) {
    return { nodes: [], edges: [] };
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (keepNodeIds.has(edge.to) && !keepNodeIds.has(edge.from)) {
        keepNodeIds.add(edge.from);
        changed = true;
      }
    }
  }

  return {
    nodes: graph.nodes.filter((node) => keepNodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => keepNodeIds.has(edge.from) && keepNodeIds.has(edge.to)),
  };
}

function nodeMatchesRoleLayerSearch(
  node: GraphNode,
  kind: WorkspaceKnowledgeRoleLayerSearchKind,
): boolean {
  if (node.kind === 'workspace' || node.kind === 'category') {
    return false;
  }
  return workspaceKnowledgeRoleLayersMatchSearch(node.roleLayers, kind);
}

function nodeMatchesSemanticSearch(
  node: GraphNode,
  kind: WorkspaceKnowledgeSemanticSearchKind,
): boolean {
  if (kind === 'architecture') {
    return (
      node.group === 'architecture' ||
      node.kind === 'architecture' ||
      (node.sourceRef ? workspaceKnowledgeKeyMatchesSemanticSearch(node.sourceRef, kind) : false)
    );
  }
  if (kind === 'artifact') {
    return (
      node.kind === 'artifact' ||
      (node.sourceRef ? workspaceKnowledgeKeyMatchesSemanticSearch(node.sourceRef, kind) : false)
    );
  }
  if (kind === 'project-memory') {
    if (node.sourceRef) {
      if (
        workspaceKnowledgeKeyMatchesSemanticSearch(node.sourceRef, 'artifact') ||
        workspaceKnowledgeKeyMatchesSemanticSearch(node.sourceRef, 'architecture')
      ) {
        return false;
      }
    }
    if (node.group === 'memory') {
      return node.memoryType === 'project_context';
    }
    return (
      node.group === 'knowledge' &&
      node.kind !== 'artifact' &&
      node.memoryType === 'project_context'
    );
  }
  if (kind === 'memory') {
    if (node.group === 'memory') {
      return true;
    }
    if (node.group !== 'knowledge' || node.kind === 'artifact') {
      return false;
    }
    if (node.sourceRef && workspaceKnowledgeKeyMatchesSemanticSearch(node.sourceRef, 'artifact')) {
      return false;
    }
    return node.memoryType === 'project_context';
  }
  return (
    (kind === 'fact' ? node.memoryType === 'fact' : false) ||
    (kind === 'instruction'
      ? node.group === 'governance' ||
        node.kind === 'constitution' ||
        node.memoryType === 'instruction'
      : false)
  );
}

function nodeSearchHaystack(node: GraphNode): string {
  return [
    node.id,
    node.label,
    node.detail,
    node.content,
    node.searchText,
    node.sourceRef,
    node.sourceRef ? workspaceKnowledgeKeySearchLabel(node.sourceRef) : null,
    node.state,
    node.kind,
    node.kind === 'artifact' ? '知识产物 产物 artifact' : null,
    node.group,
    node.memoryType,
    node.memoryType ? memoryTypeSearchLabel(node.memoryType) : null,
    node.persistedMemoryId ? '已入库 persisted saved' : '未入库 unsaved',
    roleLayerSearchLabel(node.roleLayers),
  ]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join('\n')
    .toLocaleLowerCase();
}

function memoryTypeSearchLabel(type: GraphMemoryType): string {
  switch (type) {
    case 'instruction':
      return '规则 指令 团队宪法 constitution instruction';
    case 'project_context':
      return '项目上下文 项目记忆 知识 project context';
    case 'learned_pattern':
      return '经验 沉淀 记忆 复盘 learned pattern';
    case 'preference':
      return '个人记忆 用户记忆 偏好 记忆 preference';
    case 'fact':
      return '事实 记忆 fact';
  }
}

function roleLayerSearchLabel(roleLayers: GraphRoleLayer[] | null): string {
  if (roleLayers === null || roleLayers.length === 0) {
    return '全部层级 全部可读 all layers';
  }
  return roleLayers.map((roleLayer) => `${roleLayer} ${ROLE_LAYER_LABELS[roleLayer]}`).join('\n');
}

function filterGraphSemanticOrphans(graph: KnowledgeGraph): KnowledgeGraph {
  const linkedContentIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'derives') {
      continue;
    }
    linkedContentIds.add(edge.from);
    linkedContentIds.add(edge.to);
  }

  const keepContentIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind !== 'workspace' &&
          node.kind !== 'category' &&
          (node.kind !== 'artifact' ||
            linkedContentIds.has(node.id) ||
            Boolean(node.persistedMemoryId)),
      )
      .map((node) => node.id),
  );
  if (keepContentIds.size === 0) {
    return { nodes: [], edges: [] };
  }

  const keepNodeIds = addContainsAncestors(graph, keepContentIds);
  return keepGraphNodes(graph, keepNodeIds);
}

function filterGraphByLocalDepth(
  graph: KnowledgeGraph,
  selectedNodeId: string | null,
  depth: LocalGraphDepth,
): KnowledgeGraph {
  if (depth === 0 || !selectedNodeId || !graph.nodes.some((node) => node.id === selectedNodeId)) {
    return graph;
  }

  const keepNodeIds = new Set<string>([selectedNodeId]);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedNodeHasDerivesEdge = graph.edges.some(
    (edge) =>
      edge.kind === 'derives' && (edge.from === selectedNodeId || edge.to === selectedNodeId),
  );
  const queue: Array<{ currentDepth: number; nodeId: string }> = [
    { currentDepth: 0, nodeId: selectedNodeId },
  ];
  const visited = new Set<string>([selectedNodeId]);

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item || item.currentDepth >= depth) {
      continue;
    }
    const currentNode = nodeById.get(item.nodeId);
    if (!currentNode) {
      continue;
    }
    for (const edge of graph.edges) {
      if (
        !canTraverseLocalGraphEdge(edge, currentNode, {
          selectedNodeHasDerivesEdge,
          selectedNodeId,
        })
      ) {
        continue;
      }
      const neighbor =
        edge.from === item.nodeId ? edge.to : edge.to === item.nodeId ? edge.from : null;
      if (!neighbor) {
        continue;
      }
      keepNodeIds.add(neighbor);
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ currentDepth: item.currentDepth + 1, nodeId: neighbor });
      }
    }
  }

  return keepGraphNodes(graph, addContainsAncestors(graph, keepNodeIds));
}

function canTraverseLocalGraphEdge(
  edge: KnowledgeGraph['edges'][number],
  currentNode: GraphNode,
  options: { selectedNodeHasDerivesEdge: boolean; selectedNodeId: string },
): boolean {
  if (edge.kind === 'derives') {
    return true;
  }
  if (edge.kind !== 'contains') {
    return false;
  }
  if (edge.to === currentNode.id) {
    return true;
  }
  if (currentNode.kind === 'category' && edge.from === currentNode.id) {
    return !options.selectedNodeHasDerivesEdge;
  }
  return (
    currentNode.kind === 'workspace' &&
    currentNode.id === options.selectedNodeId &&
    edge.from === currentNode.id
  );
}

function addContainsAncestors(graph: KnowledgeGraph, initialNodeIds: Set<string>): Set<string> {
  const keepNodeIds = new Set(initialNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (edge.kind !== 'contains') {
        continue;
      }
      if (keepNodeIds.has(edge.to) && !keepNodeIds.has(edge.from)) {
        keepNodeIds.add(edge.from);
        changed = true;
      }
    }
  }
  return keepNodeIds;
}

function keepGraphNodes(graph: KnowledgeGraph, keepNodeIds: Set<string>): KnowledgeGraph {
  const keptEdges = graph.edges.filter(
    (edge) => keepNodeIds.has(edge.from) && keepNodeIds.has(edge.to),
  );
  const connectedCategoryIds = new Set<string>();
  for (const edge of keptEdges) {
    connectedCategoryIds.add(edge.from);
    connectedCategoryIds.add(edge.to);
  }
  const nodes = graph.nodes.filter((node) => {
    if (!keepNodeIds.has(node.id)) {
      return false;
    }
    if (node.kind === 'workspace') {
      return true;
    }
    if (node.kind === 'category') {
      return connectedCategoryIds.has(node.id);
    }
    return true;
  });
  const finalNodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: keptEdges.filter((edge) => finalNodeIds.has(edge.from) && finalNodeIds.has(edge.to)),
  };
}

function canPersistNode(node: GraphNode): node is GraphNode & {
  memoryType: GraphMemoryType;
  sourceRef: string;
} {
  return (
    node.kind !== 'workspace' &&
    node.kind !== 'category' &&
    typeof node.memoryType === 'string' &&
    typeof node.sourceRef === 'string' &&
    node.sourceRef.length > 0
  );
}

function knowledgeValueForNode(node: GraphNode): string {
  const persistedValue = node.persistedValue?.trim();
  const value =
    node.persistedMemoryId && persistedValue
      ? persistedValue
      : (node.content ?? node.detail ?? node.label).trim();
  return value.length > MAX_KNOWLEDGE_VALUE_LENGTH
    ? value.slice(0, MAX_KNOWLEDGE_VALUE_LENGTH)
    : value;
}

function priorityForMemoryType(type: GraphMemoryType): number {
  switch (type) {
    case 'instruction':
      return 80;
    case 'project_context':
      return 70;
    case 'learned_pattern':
      return 65;
    case 'preference':
      return 60;
    case 'fact':
      return 55;
  }
}
