/**
 * 知识图谱 · 搜索匹配与按查询过滤（纯函数）。
 *
 * 从 `WorkspaceKnowledgeGraphView` 拆出：搜索的「匹配语义」必须只有一份事实来源，
 * 否则视图过滤与聚合视图的「搜索自动展开祖先」会各写一套判定而互相矛盾。
 *
 * 过滤语义与拆分前逐字保持一致：
 *   - 空查询 / 整工作区语义词 → 返回原图；
 *   - 命中 workspace → 返回原图；
 *   - 命中 category → 保留该分类与其直接子节点；
 *   - 其余命中 → 保留命中节点；
 *   - 再补上所有命中节点的 `contains` 祖先（不额外裁剪 workspace / 分类）。
 */

import type {
  GraphMemoryType,
  GraphNode,
  KnowledgeGraph,
} from '../../../data/build-knowledge-graph.js';
import { ROLE_LAYER_LABELS } from './knowledge-graph-constants.js';
import { addContainsAncestors, keepGraphNodes } from './knowledge-graph-structure.js';
import {
  workspaceKnowledgeKeyMatchesSemanticSearch,
  workspaceKnowledgeKeySearchLabel,
  workspaceKnowledgeRoleLayerSearchKind,
  workspaceKnowledgeRoleLayersMatchSearch,
  workspaceKnowledgeSemanticSearchKind,
  type WorkspaceKnowledgeRoleLayerSearchKind,
  type WorkspaceKnowledgeSemanticSearchKind,
} from '../../../data/workspace-knowledge-key-classification.js';
import { isWholeWorkspaceKnowledgeSearchTerm } from '../../../data/workspace-knowledge-search.js';

/** 搜索命中集合：`all` 表示整图（整工作区语义），`none` 表示无命中，`matches` 为命中节点 id。 */
export type GraphSearchMatches =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'matches'; readonly matchedIds: ReadonlySet<string> };

export function memoryTypeSearchLabel(type: GraphMemoryType): string {
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

export function roleLayerSearchLabel(roleLayers: GraphNode['roleLayers']): string {
  if (roleLayers === null || roleLayers.length === 0) {
    return '全部层级 全部可读 all layers';
  }
  return roleLayers.map((roleLayer) => `${roleLayer} ${ROLE_LAYER_LABELS[roleLayer]}`).join('\n');
}

export function nodeSearchHaystack(node: GraphNode): string {
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

/**
 * 收集查询命中的节点 id（与过滤保持同一套判定）。视图过滤与聚合的祖先自动展开共用本函数。
 */
export function collectGraphSearchMatches(
  graph: KnowledgeGraph,
  query: string,
): GraphSearchMatches {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return { kind: 'all' };
  }
  if (isWholeWorkspaceKnowledgeSearchTerm(normalized)) {
    return { kind: 'all' };
  }

  const matched = new Set<string>();
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
      return { kind: 'all' };
    }
    if (node.kind === 'category') {
      if (node.group === 'knowledge' && semanticSearchKind === 'artifact') {
        continue;
      }
      matched.add(node.id);
      for (const edge of graph.edges) {
        if (edge.kind === 'contains' && edge.from === node.id) {
          matched.add(edge.to);
        }
      }
      continue;
    }
    matched.add(node.id);
  }

  if (matched.size === 0) {
    return { kind: 'none' };
  }
  return { kind: 'matches', matchedIds: matched };
}

/** 按查询过滤图谱；语义与拆分前视图内的 `filterGraphByQuery` 完全一致。 */
export function filterGraphByQuery(graph: KnowledgeGraph, query: string): KnowledgeGraph {
  const matches = collectGraphSearchMatches(graph, query);
  if (matches.kind === 'all') {
    return graph;
  }
  if (matches.kind === 'none') {
    return { nodes: [], edges: [] };
  }
  const keepNodeIds = addContainsAncestors(graph, matches.matchedIds);
  return {
    nodes: graph.nodes.filter((node) => keepNodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => keepNodeIds.has(edge.from) && keepNodeIds.has(edge.to)),
  };
}

/** 隐藏孤点：仅保留有 derives 关系或已入库的 artifact，以及它们向上到根的祖先链。 */
export function filterGraphSemanticOrphans(graph: KnowledgeGraph): KnowledgeGraph {
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
