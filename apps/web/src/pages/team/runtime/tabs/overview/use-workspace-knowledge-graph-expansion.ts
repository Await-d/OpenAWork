/**
 * 知识图谱 · 展开 / 折叠状态。
 *
 * 把「默认展开策略、搜索祖先自动展开、展开全部 / 收起全部、后代计数」这些状态与派生计算
 * 收进一个 hook，让视图组件只做编排。`descendantCounts`（昂贵）只在数据变化时算一次。
 *
 * 展开**不再被容量拒绝**：力导向布局的密度不再由固定环半径钉死，扩张时由 (1) 聚合默认折叠、
 * (2) 空间哈希斥力、(3) 标签降级共同保证可读，而不是拒绝用户操作。渲染安全的兜底仍在
 * 投影层（`projectVisibleGraph` 的 `maxNodes`）：允许展开后，超出渲染上限的最深层会被
 * 自动收起（优雅降级），永不拒绝渲染、也永不拒绝展开动作。搜索命中由 `forceVisibleIds`
 * 保护，收缩时永不隐藏——搜索仍能定位到折叠分组里的深层命中。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '../../data/build-knowledge-graph.js';
import {
  autoExpansionForSearch,
  collapsedTopLevelExpansion,
  computeDescendantCounts,
  expandAllExpandableIds,
  mergeExpandedIds,
  resolveDefaultExpansion,
  toggleExpandedId,
} from './graph/knowledge-graph-aggregation.js';
import type { GraphViewportSize } from './graph/knowledge-graph-layout.js';
import { collectGraphSearchMatches } from './graph/knowledge-graph-search.js';

export interface KnowledgeGraphExpansionOptions {
  /** 画布实测视口；保留供展开策略与布局共用同一份测量值。 */
  readonly viewportSize: GraphViewportSize | null;
}

export interface KnowledgeGraphExpansionState {
  readonly expandedIds: ReadonlySet<string>;
  readonly descendantCounts: ReadonlyMap<string, number>;
  readonly toggleExpand: (nodeId: string) => void;
  readonly expandAll: () => void;
  readonly collapseAll: () => void;
  /** 力导向布局下不再按容量禁用「展开全部」；保留字段以稳定消费端契约。 */
  readonly expandAllBlocked: boolean;
  /** 搜索命中节点：作为投影的 `forceVisibleIds`，命中永不被折叠吞掉。 */
  readonly forceVisibleIds?: ReadonlySet<string>;
  /** 容量相关的非阻塞解释文案；不再拒绝展开，故恒为 `null`。 */
  readonly capacityNotice: string | null;
  /** 被拒绝展开的节点集合；不再拒绝，故恒为空集。 */
  readonly capacityBlockedIds: ReadonlySet<string>;
  /** 单个节点此刻展开是否会被拒绝；力布局下恒为 false。 */
  readonly isExpandBlocked: (nodeId: string) => boolean;
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();
const NEVER_BLOCKED = (): boolean => false;

export function useKnowledgeGraphExpansion(
  graph: KnowledgeGraph,
  appliedQuery: string,
  workspaceKey: string | null,
  _options: KnowledgeGraphExpansionOptions,
): KnowledgeGraphExpansionState {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() =>
    resolveDefaultExpansion(graph),
  );
  const expandedIdsRef = useRef(expandedIds);
  const initializedRef = useRef(false);
  const lastWorkspaceKeyRef = useRef<string | null>(workspaceKey);

  // 搜索命中的节点：投影收缩时受保护，保证搜索结果永远不会被折叠吞掉。
  const forceVisibleIds = useMemo(() => {
    const matches = collectGraphSearchMatches(graph, appliedQuery);
    return matches.kind === 'matches' ? matches.matchedIds : undefined;
  }, [appliedQuery, graph]);

  const applyExpanded = useCallback((next: ReadonlySet<string>) => {
    expandedIdsRef.current = next;
    setExpandedIds(next);
  }, []);

  useEffect(() => {
    expandedIdsRef.current = expandedIds;
  }, [expandedIds]);

  // 首次拿到数据 / 切换工作区时套用默认展开；着色、层级、标签密度、选中变化都保留现有展开态。
  useEffect(() => {
    const workspaceChanged = lastWorkspaceKeyRef.current !== workspaceKey;
    lastWorkspaceKeyRef.current = workspaceKey;
    if (!initializedRef.current || workspaceChanged) {
      initializedRef.current = graph.nodes.length > 0;
      applyExpanded(resolveDefaultExpansion(graph));
    }
  }, [applyExpanded, graph, workspaceKey]);

  const descendantCounts = useMemo(() => computeDescendantCounts(graph), [graph]);

  // 搜索命中祖先自动展开：搜索仍只做过滤、不做高亮，但结果不能被折叠分组藏起来。
  const searchExpansion = useMemo(
    () => autoExpansionForSearch(graph, appliedQuery),
    [appliedQuery, graph],
  );
  useEffect(() => {
    if (searchExpansion.size === 0) {
      return;
    }
    const merged = mergeExpandedIds(expandedIdsRef.current, searchExpansion);
    if (merged === expandedIdsRef.current) {
      return;
    }
    applyExpanded(merged);
  }, [applyExpanded, searchExpansion]);

  const toggleExpand = useCallback(
    (nodeId: string) => {
      applyExpanded(toggleExpandedId(expandedIdsRef.current, nodeId));
    },
    [applyExpanded],
  );

  const expandAll = useCallback(() => {
    applyExpanded(expandAllExpandableIds(graph));
  }, [applyExpanded, graph]);

  const collapseAll = useCallback(() => {
    applyExpanded(collapsedTopLevelExpansion(graph));
  }, [applyExpanded, graph]);

  return {
    expandedIds,
    descendantCounts,
    toggleExpand,
    expandAll,
    collapseAll,
    expandAllBlocked: false,
    forceVisibleIds,
    capacityNotice: null,
    capacityBlockedIds: EMPTY_ID_SET,
    isExpandBlocked: NEVER_BLOCKED,
  };
}
