/**
 * 知识图谱视图 · 纯辅助函数。
 *
 * 从 `WorkspaceKnowledgeGraphView` 拆出：入库判定 / 默认层级 / 文案标签等不依赖 React 状态，
 * 单独成文件便于复用与测试，也让主组件只保留编排与渲染。
 */

import type {
  GraphMemoryType,
  GraphNode,
  GraphRoleLayer,
} from '../../data/build-knowledge-graph.js';
import type { KnowledgeGraphLabelDensity } from './graph/knowledge-graph-canvas.js';
import {
  MAX_KNOWLEDGE_VALUE_LENGTH,
  ROLE_LAYER_LABELS,
} from './graph/knowledge-graph-constants.js';
import type { LocalGraphDepth } from './workspace-knowledge-graph-toolbar.js';

export function canPersistNode(node: GraphNode): node is GraphNode & {
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

export function knowledgeValueForNode(node: GraphNode): string {
  const persistedValue = node.persistedValue?.trim();
  const value =
    node.persistedMemoryId && persistedValue
      ? persistedValue
      : (node.content ?? node.detail ?? node.label).trim();
  return value.length > MAX_KNOWLEDGE_VALUE_LENGTH
    ? value.slice(0, MAX_KNOWLEDGE_VALUE_LENGTH)
    : value;
}

export function priorityForMemoryType(type: GraphMemoryType): number {
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

export function defaultRoleLayersForNode(
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

export function defaultLocalGraphDepthForNode(node: GraphNode | null): LocalGraphDepth {
  if (!node || node.kind === 'workspace') {
    return 0;
  }
  return node.kind === 'category' ? 1 : 2;
}

export function nextAutoLocalGraphDepth(
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

export function labelDensityLabel(labelDensity: KnowledgeGraphLabelDensity): string {
  switch (labelDensity) {
    case 'all':
      return '全部';
    case 'auto':
      return '自动';
    case 'focus':
      return '焦点';
  }
}

export function roleLayerPreviewLabel(roleLayer: GraphRoleLayer | null): string {
  return roleLayer ? `${ROLE_LAYER_LABELS[roleLayer]}层` : '全部层级';
}

export function persistedCountLabel(
  visibleCount: number,
  totalCount: number,
  truncated: boolean,
): string {
  const totalLabel = truncated ? `${totalCount}+` : `${totalCount}`;
  return visibleCount === totalCount && !truncated
    ? `${visibleCount}`
    : `${visibleCount} / 全图 ${totalLabel}`;
}
