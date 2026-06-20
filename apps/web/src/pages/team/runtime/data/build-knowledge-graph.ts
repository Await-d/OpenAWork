/**
 * 260530-team-page · Wave 4 · build-knowledge-graph（工作区知识资产图谱 · 纯派生）
 *
 * 图谱展示的是工作区长期上下文与知识资产，而不是运行时会话拓扑：
 *   - 架构说明、团队宪法、项目记忆、经验沉淀、个人记忆来自指令栈 stableBlock；
 *   - spec / plan / tasks / implementation / review_report 等来自工作区 artifacts；
 *   - artifact 之间通过 parentArtifactId 建立派生关系。
 */

import type { InstructionStackSegment } from './parse-instruction-stack.js';
import { instructionSegmentLabel } from './parse-instruction-stack.js';
import {
  isArchitectureKnowledgeKey,
  isArtifactKnowledgeKey,
  normalizeWorkspaceKnowledgeKey,
} from './workspace-knowledge-key-classification.js';

export type GraphNodeKind =
  | 'workspace'
  | 'category'
  | 'architecture'
  | 'constitution'
  | 'memory'
  | 'knowledge'
  | 'artifact';

export type GraphNodeGroup = 'workspace' | 'architecture' | 'governance' | 'memory' | 'knowledge';

export type GraphMemoryType =
  | 'preference'
  | 'fact'
  | 'instruction'
  | 'project_context'
  | 'learned_pattern';

export type GraphRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  group: GraphNodeGroup;
  content: string | null;
  detail: string | null;
  memoryType: GraphMemoryType | null;
  persistedMemoryId: string | null;
  /** 已入库记录的原始正文；用于更新读取范围时避免覆盖人工整理内容。 */
  persistedValue?: string | null;
  roleLayers: GraphRoleLayer[] | null;
  searchText: string | null;
  sourceRef: string | null;
  /** artifact 节点使用 phase；其它节点使用片段 kind/category。 */
  state: string | null;
}

export type GraphEdgeKind = 'contains' | 'derives';

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  state: string | null;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface KnowledgeGraphWorkspaceInput {
  id?: string | null;
  name?: string | null;
  description?: string | null;
}

export interface KnowledgeGraphArtifactInput {
  id: string;
  content?: string | null;
  parentArtifactId?: string | null;
  phase: string | null;
  title: string;
  type?: string | null;
}

export interface KnowledgeGraphStoredInput {
  id: string;
  key: string;
  type: GraphMemoryType;
  value: string;
  roleLayers?: GraphRoleLayer[] | null;
  enabled?: boolean;
  source?: string | null;
}

export interface BuildKnowledgeGraphInput {
  artifacts?: KnowledgeGraphArtifactInput[];
  instructionSegments?: InstructionStackSegment[];
  persistedKnowledge?: KnowledgeGraphStoredInput[];
  storedKnowledge?: KnowledgeGraphStoredInput[];
  workspace?: KnowledgeGraphWorkspaceInput | null;
}

type CategoryKey = Exclude<GraphNodeGroup, 'workspace'>;

const CATEGORY_ORDER: CategoryKey[] = ['architecture', 'governance', 'memory', 'knowledge'];
const CATEGORY_RANK = new Map<CategoryKey, number>(
  CATEGORY_ORDER.map((category, index) => [category, index]),
);

const CATEGORY_META: Record<CategoryKey, { label: string; detail: string }> = {
  architecture: {
    label: '架构上下文',
    detail: '项目架构、边界和长期设计约束',
  },
  governance: {
    label: '团队规则',
    detail: '团队宪法和执行约束',
  },
  memory: {
    label: '记忆与经验',
    detail: '项目记忆、个人记忆和经验沉淀',
  },
  knowledge: {
    label: '知识产物',
    detail: '规格、计划、任务、实现和评审产物',
  },
};

const PHASE_LABELS: Record<string, string> = {
  spec: '规格',
  plan: '计划',
  tasks: '任务',
  implementation: '实现',
  patch: '补丁',
  review: '评审',
  review_report: '评审报告',
};

const PHASE_RANK: Record<string, number> = {
  spec: 0,
  plan: 1,
  tasks: 2,
  implementation: 3,
  patch: 4,
  review: 5,
  review_report: 6,
};

function graphWorkspaceNodeId(workspaceId: string | null | undefined): string {
  const normalized = workspaceId?.trim() || 'current';
  return `workspace:${normalized}`;
}

function graphCategoryNodeId(category: CategoryKey): string {
  return `category:${category}`;
}

function graphSegmentNodeId(segment: InstructionStackSegment, occurrenceIndex: number): string {
  return `knowledge:${segment.kind}:${segment.layer}:${occurrenceIndex}`;
}

function graphArtifactNodeId(artifactId: string): string {
  return `artifact:${artifactId}`;
}

function graphStoredKnowledgeNodeId(memoryId: string): string {
  return `stored-knowledge:${memoryId}`;
}

function graphSegmentSourceRef(segment: InstructionStackSegment, occurrenceIndex: number): string {
  const suffix = occurrenceIndex > 0 ? `:${occurrenceIndex}` : '';
  return `instruction-stack:${segment.kind}:${segment.layer}${suffix}`;
}

function graphArtifactSourceRef(artifactId: string): string {
  return `artifact:${artifactId}`;
}

function summarizeText(input: string | null | undefined): string | null {
  const text = input?.trim();
  if (!text) {
    return null;
  }
  const firstMeaningfulLine =
    text
      .split('\n')
      .map((line) =>
        line
          .trim()
          .replace(/^#{1,6}\s*/, '')
          .replace(/^[-*]\s*/, ''),
      )
      .find((line) => line.length > 0) ?? text;
  return firstMeaningfulLine.length > 72
    ? `${firstMeaningfulLine.slice(0, 72)}...`
    : firstMeaningfulLine;
}

function classifySegment(
  segment: InstructionStackSegment,
): { category: CategoryKey; kind: GraphNodeKind; memoryType: GraphMemoryType } | null {
  switch (segment.kind) {
    case 'architecture-md':
      return { category: 'architecture', kind: 'architecture', memoryType: 'project_context' };
    case 'constitution':
      return { category: 'governance', kind: 'constitution', memoryType: 'instruction' };
    case 'project-memory':
      return { category: 'memory', kind: 'memory', memoryType: 'project_context' };
    case 'lessons-learned':
      return { category: 'memory', kind: 'memory', memoryType: 'learned_pattern' };
    case 'user-memory':
      return { category: 'memory', kind: 'memory', memoryType: 'preference' };
    case 'raw':
    case 'cache-breaker':
    case 'oversize-warning':
    case 'soul':
    case 'workspace-knowledge':
      return null;
  }
}

function artifactPhaseLabel(phase: string | null): string {
  if (!phase) {
    return '产物';
  }
  return PHASE_LABELS[phase] ?? phase;
}

function sortArtifacts(artifacts: KnowledgeGraphArtifactInput[]): KnowledgeGraphArtifactInput[] {
  return [...artifacts].sort((left, right) => {
    const leftRank = PHASE_RANK[left.phase ?? ''] ?? 99;
    const rightRank = PHASE_RANK[right.phase ?? ''] ?? 99;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const titleOrder = left.title.localeCompare(right.title, 'zh-CN');
    if (titleOrder !== 0) {
      return titleOrder;
    }
    return left.id.localeCompare(right.id, 'zh-CN');
  });
}

function sortStoredKnowledge(
  storedKnowledge: KnowledgeGraphStoredInput[],
): KnowledgeGraphStoredInput[] {
  return [...storedKnowledge].sort((left, right) => {
    const leftClassified = classifyStoredKnowledge(left);
    const rightClassified = classifyStoredKnowledge(right);
    const leftCategoryRank = CATEGORY_RANK.get(leftClassified.category) ?? 99;
    const rightCategoryRank = CATEGORY_RANK.get(rightClassified.category) ?? 99;
    if (leftCategoryRank !== rightCategoryRank) {
      return leftCategoryRank - rightCategoryRank;
    }
    const keyOrder = normalizeWorkspaceKnowledgeKey(left.key).localeCompare(
      normalizeWorkspaceKnowledgeKey(right.key),
      'zh-CN',
    );
    if (keyOrder !== 0) {
      return keyOrder;
    }
    return left.id.localeCompare(right.id, 'zh-CN');
  });
}

function classifyStoredKnowledge(input: KnowledgeGraphStoredInput): {
  category: CategoryKey;
  kind: GraphNodeKind;
} {
  const normalizedKey = normalizeWorkspaceKnowledgeKey(input.key);
  if (normalizedKey.startsWith('instruction-stack:architecture-md:')) {
    return { category: 'architecture', kind: 'architecture' };
  }
  if (normalizedKey.startsWith('instruction-stack:constitution:')) {
    return { category: 'governance', kind: 'constitution' };
  }
  if (
    normalizedKey.startsWith('instruction-stack:project-memory:') ||
    normalizedKey.startsWith('instruction-stack:lessons-learned:') ||
    normalizedKey.startsWith('instruction-stack:user-memory:')
  ) {
    return { category: 'memory', kind: 'memory' };
  }
  if (isArtifactKnowledgeKey(normalizedKey)) {
    return { category: 'knowledge', kind: 'knowledge' };
  }
  if (isArchitectureKnowledgeKey(normalizedKey)) {
    return { category: 'architecture', kind: 'architecture' };
  }
  switch (input.type) {
    case 'instruction':
      return { category: 'governance', kind: 'constitution' };
    case 'project_context':
      return { category: 'knowledge', kind: 'knowledge' };
    case 'learned_pattern':
    case 'preference':
    case 'fact':
      return { category: 'memory', kind: 'memory' };
  }
}

export function buildKnowledgeGraph(input: BuildKnowledgeGraphInput): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const categoryNodes = new Set<CategoryKey>();
  const segmentOccurrenceCounts = new Map<string, number>();

  const addNode = (node: GraphNode): void => {
    nodes.set(node.id, node);
    if (node.group !== 'workspace') {
      categoryNodes.add(node.group);
    }
  };

  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.kind}:${edge.from}->${edge.to}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push(edge);
  };

  const updatePersistedNodeState = (
    nodeId: string,
    stored: KnowledgeGraphStoredInput,
    includeSearchText: boolean,
  ): void => {
    const existing = nodes.get(nodeId);
    if (!existing) {
      return;
    }
    const storedValue = stored.value.trim();
    const searchText =
      includeSearchText && storedValue.length > 0
        ? [existing.searchText, storedValue]
            .filter((item): item is string => typeof item === 'string' && item.length > 0)
            .join('\n\n')
        : existing.searchText;
    nodes.set(nodeId, {
      ...existing,
      persistedMemoryId: stored.id,
      persistedValue: storedValue || null,
      roleLayers: stored.roleLayers ?? null,
      searchText,
    });
  };

  for (const segment of input.instructionSegments ?? []) {
    const classified = classifySegment(segment);
    const body = segment.body.trim();
    if (!classified || body.length === 0) {
      continue;
    }
    const segmentSourceKey = `${segment.kind}:${segment.layer}`;
    const occurrenceIndex = segmentOccurrenceCounts.get(segmentSourceKey) ?? 0;
    segmentOccurrenceCounts.set(segmentSourceKey, occurrenceIndex + 1);
    addNode({
      id: graphSegmentNodeId(segment, occurrenceIndex),
      kind: classified.kind,
      label: instructionSegmentLabel(segment.kind),
      group: classified.category,
      content: body,
      detail: summarizeText(body),
      memoryType: classified.memoryType,
      persistedMemoryId: null,
      roleLayers: null,
      searchText: body,
      sourceRef: graphSegmentSourceRef(segment, occurrenceIndex),
      state: segment.kind,
    });
  }

  const sortedArtifacts = sortArtifacts(input.artifacts ?? []);
  for (const artifact of sortedArtifacts) {
    addNode({
      id: graphArtifactNodeId(artifact.id),
      kind: 'artifact',
      label: artifact.title || artifactPhaseLabel(artifact.phase),
      group: 'knowledge',
      content: artifact.content?.trim() || null,
      detail: summarizeText(artifact.content) ?? artifactPhaseLabel(artifact.phase),
      memoryType: 'project_context',
      persistedMemoryId: null,
      roleLayers: null,
      searchText: artifact.content?.trim() || null,
      sourceRef: graphArtifactSourceRef(artifact.id),
      state: artifact.phase,
    });
  }

  const nodeIdsBySourceRef = new Map<string, string>();
  for (const node of nodes.values()) {
    if (node.sourceRef) {
      nodeIdsBySourceRef.set(node.sourceRef, node.id);
    }
  }

  const unmatchedStoredKnowledge: KnowledgeGraphStoredInput[] = [];
  for (const stored of input.storedKnowledge ?? []) {
    if (stored.enabled === false) {
      continue;
    }
    const matchedNodeId = nodeIdsBySourceRef.get(stored.key);
    if (matchedNodeId) {
      updatePersistedNodeState(matchedNodeId, stored, true);
      continue;
    }
    unmatchedStoredKnowledge.push(stored);
  }

  for (const stored of sortStoredKnowledge(unmatchedStoredKnowledge)) {
    const matchedNodeId = nodeIdsBySourceRef.get(stored.key);
    if (matchedNodeId) {
      updatePersistedNodeState(matchedNodeId, stored, true);
      continue;
    }

    const classified = classifyStoredKnowledge(stored);
    const node: GraphNode = {
      id: graphStoredKnowledgeNodeId(stored.id),
      kind: classified.kind,
      label: stored.key,
      group: classified.category,
      content: stored.value.trim(),
      detail: summarizeText(stored.value) ?? stored.source ?? '已入库知识',
      memoryType: stored.type,
      persistedMemoryId: stored.id,
      persistedValue: stored.value.trim() || null,
      roleLayers: stored.roleLayers ?? null,
      searchText: stored.value.trim(),
      sourceRef: stored.key,
      state: stored.type,
    };
    addNode(node);
    nodeIdsBySourceRef.set(stored.key, node.id);
  }

  for (const stored of input.persistedKnowledge ?? []) {
    if (stored.enabled === false) {
      continue;
    }
    const matchedNodeId = nodeIdsBySourceRef.get(stored.key);
    if (!matchedNodeId) {
      continue;
    }
    updatePersistedNodeState(matchedNodeId, stored, false);
  }

  if (nodes.size === 0) {
    return { nodes: [], edges: [] };
  }

  const contentNodes = Array.from(nodes.values());
  nodes.clear();

  const workspaceNodeId = graphWorkspaceNodeId(input.workspace?.id);
  nodes.set(workspaceNodeId, {
    id: workspaceNodeId,
    kind: 'workspace',
    label: input.workspace?.name?.trim() || '当前工作区',
    group: 'workspace',
    detail: summarizeText(input.workspace?.description) ?? '工作区知识资产根节点',
    content: input.workspace?.description?.trim() || null,
    memoryType: null,
    persistedMemoryId: null,
    roleLayers: null,
    searchText: input.workspace?.description?.trim() || null,
    sourceRef: null,
    state: null,
  });

  for (const category of CATEGORY_ORDER) {
    if (!categoryNodes.has(category)) {
      continue;
    }
    const meta = CATEGORY_META[category];
    const categoryId = graphCategoryNodeId(category);
    nodes.set(categoryId, {
      id: categoryId,
      kind: 'category',
      label: meta.label,
      group: category,
      content: meta.detail,
      detail: meta.detail,
      memoryType: null,
      persistedMemoryId: null,
      roleLayers: null,
      searchText: meta.detail,
      sourceRef: null,
      state: category,
    });
    addEdge({
      id: `contains:${workspaceNodeId}->${categoryId}`,
      from: workspaceNodeId,
      to: categoryId,
      kind: 'contains',
      state: null,
    });

    for (const node of contentNodes) {
      if (node.group !== category) {
        continue;
      }
      nodes.set(node.id, node);
      addEdge({
        id: `contains:${categoryId}->${node.id}`,
        from: categoryId,
        to: node.id,
        kind: 'contains',
        state: null,
      });
    }
  }

  for (const artifact of sortedArtifacts) {
    if (!artifact.parentArtifactId) {
      continue;
    }
    const from = graphArtifactNodeId(artifact.parentArtifactId);
    const to = graphArtifactNodeId(artifact.id);
    if (!nodes.has(from) || !nodes.has(to)) {
      continue;
    }
    addEdge({
      id: `derives:${from}->${to}`,
      from,
      to,
      kind: 'derives',
      state: artifact.phase,
    });
  }

  return { nodes: Array.from(nodes.values()), edges };
}
