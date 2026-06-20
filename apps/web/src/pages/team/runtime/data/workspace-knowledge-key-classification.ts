export function normalizeWorkspaceKnowledgeKey(key: string): string {
  return key.trim().toLocaleLowerCase();
}

export function isArtifactKnowledgeKey(key: string): boolean {
  const normalizedKey = normalizeWorkspaceKnowledgeKey(key);
  return (
    normalizedKey.startsWith('artifact:') ||
    normalizedKey.startsWith('manual:artifact') ||
    normalizedKey.includes(':artifact-') ||
    normalizedKey.includes(':artifact_')
  );
}

export function isArchitectureKnowledgeKey(key: string): boolean {
  const normalizedKey = normalizeWorkspaceKnowledgeKey(key);
  return (
    normalizedKey.startsWith('architecture:') ||
    normalizedKey.startsWith('arch:') ||
    normalizedKey.startsWith('manual:architecture') ||
    normalizedKey.startsWith('manual:arch:') ||
    normalizedKey.startsWith('manual:arch-') ||
    normalizedKey.startsWith('manual:arch_') ||
    normalizedKey.includes(':architecture-') ||
    normalizedKey.includes(':architecture_') ||
    normalizedKey.includes(':架构')
  );
}

export type WorkspaceKnowledgeSemanticSearchKind =
  | 'architecture'
  | 'artifact'
  | 'fact'
  | 'instruction'
  | 'memory'
  | 'project-memory';

export type WorkspaceKnowledgeRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

export type WorkspaceKnowledgeRoleLayerSearchKind = WorkspaceKnowledgeRoleLayer | 'all';

export function workspaceKnowledgeSemanticSearchKind(
  search: string,
): WorkspaceKnowledgeSemanticSearchKind | null {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  switch (normalizedSearch) {
    case '架构':
    case 'architecture':
    case 'arch':
      return 'architecture';
    case '产物':
    case 'artifact':
      return 'artifact';
    case '事实':
    case 'fact':
      return 'fact';
    case '规则':
    case '指令':
    case '团队宪法':
    case 'constitution':
    case 'instruction':
      return 'instruction';
    case '记忆':
    case 'memory':
    case '工作区记忆':
      return 'memory';
    case '项目记忆':
    case 'project memory':
      return 'project-memory';
    default:
      return null;
  }
}

export function workspaceKnowledgeRoleLayerSearchKind(
  search: string,
): WorkspaceKnowledgeRoleLayerSearchKind | null {
  const normalizedSearch = search.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  switch (normalizedSearch) {
    case '接待':
    case '接待层':
    case 'reception':
    case 'reception layer':
      return 'reception';
    case 'pm1':
    case 'pm 1':
    case 'pm1层':
    case 'pm1 layer':
      return 'pm1';
    case 'pm2':
    case 'pm 2':
    case 'pm2层':
    case 'pm2 layer':
      return 'pm2';
    case '执行':
    case '执行层':
    case 'executor':
    case 'executor layer':
      return 'executor';
    case '评审':
    case '评审层':
    case 'reviewer':
    case 'reviewer layer':
      return 'reviewer';
    case '全部层级':
    case '全部可读':
    case '全部层级可读':
    case '全层级':
    case '全层级可读':
    case 'all layer':
    case 'all layers':
      return 'all';
    default:
      return null;
  }
}

export function workspaceKnowledgeRoleLayerFromSearchTerm(
  search: string,
): WorkspaceKnowledgeRoleLayer | null | undefined {
  const kind = workspaceKnowledgeRoleLayerSearchKind(search);
  if (!kind) {
    return undefined;
  }
  return kind === 'all' ? null : kind;
}

export function workspaceKnowledgeRoleLayersMatchSearch(
  roleLayers: readonly WorkspaceKnowledgeRoleLayer[] | null,
  kind: WorkspaceKnowledgeRoleLayerSearchKind,
): boolean {
  if (kind === 'all') {
    return roleLayers === null || roleLayers.length === 0;
  }
  if (roleLayers === null || roleLayers.length === 0) {
    return false;
  }
  return roleLayers.includes(kind);
}

export function workspaceKnowledgeKeyMatchesSemanticSearch(
  key: string,
  kind: WorkspaceKnowledgeSemanticSearchKind,
): boolean {
  switch (kind) {
    case 'architecture':
      return isArchitectureKnowledgeKey(key);
    case 'artifact':
      return isArtifactKnowledgeKey(key);
    case 'fact':
    case 'instruction':
    case 'memory':
    case 'project-memory':
      return false;
  }
}

export function workspaceKnowledgeKeySearchLabel(key: string): string {
  if (isArtifactKnowledgeKey(key)) {
    return '产物 artifact';
  }
  if (isArchitectureKnowledgeKey(key)) {
    return '架构 architecture';
  }
  return '';
}
