const WHOLE_WORKSPACE_KNOWLEDGE_SEARCH_TERMS = new Set([
  '知识',
  '工作区知识',
  '知识库',
  '知识资产',
  '知识图谱',
  '全部知识',
  '全量知识',
  '完整图谱',
  'workspace knowledge',
  'knowledge base',
  'knowledge graph',
  'all knowledge',
  'full graph',
]);

export function isWholeWorkspaceKnowledgeSearchTerm(normalizedSearch: string): boolean {
  return WHOLE_WORKSPACE_KNOWLEDGE_SEARCH_TERMS.has(normalizedSearch);
}
