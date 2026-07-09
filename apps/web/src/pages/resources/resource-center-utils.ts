import type {
  ResourceAgentCatalogEntry,
  ResourceArea,
  ResourceCatalog,
  ResourceCatalogEntry,
  ResourceCommandCatalogEntry,
  ResourceExtensionCatalogEntry,
  ResourceMcpCatalogEntry,
  ResourceSkillCatalogEntry,
  ResourceTextCatalogEntry,
} from '@openAwork/web-client';

export type ResourceCenterScope = 'catalog' | 'feature';

export interface ResourceCenterItem {
  readonly area: ResourceArea;
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly integration: ResourceCatalogEntry['integration'];
  readonly visibility: ResourceCatalogEntry['visibility'];
  readonly feature: ResourceCatalogEntry['feature'];
  readonly usageKind: ResourceCatalogEntry['usageKind'];
  readonly path: string;
  readonly source?: ResourceCatalogEntry['source'];
  readonly removable: boolean;
  readonly content: string;
  readonly meta: string;
}

export const RESOURCE_AREA_OPTIONS: ReadonlyArray<{
  readonly value: ResourceArea | 'all';
  readonly label: string;
}> = [
  { value: 'all', label: '全部' },
  { value: 'agents', label: 'Agents' },
  { value: 'skills', label: 'Skills' },
  { value: 'mcps', label: 'MCP' },
  { value: 'extensions', label: 'Extensions' },
];

export const FEATURE_RESOURCE_AREA_OPTIONS: ReadonlyArray<{
  readonly value: ResourceArea | 'all';
  readonly label: string;
}> = [
  { value: 'all', label: '全部功能专用' },
  { value: 'souls', label: '通道人设' },
  { value: 'agentTemplates', label: '团队模板' },
  { value: 'commands', label: '命令模板' },
  { value: 'prompts', label: '运行提示词' },
];

export const UPLOAD_RESOURCE_AREAS: ReadonlyArray<{
  readonly value: ResourceArea;
  readonly label: string;
}> = [
  { value: 'agents', label: 'Agents' },
  { value: 'skills', label: 'Skills' },
  { value: 'mcps', label: 'MCP' },
  { value: 'extensions', label: 'Extensions' },
  { value: 'souls', label: '通道人设' },
  { value: 'agentTemplates', label: '团队模板' },
  { value: 'commands', label: '命令模板' },
  { value: 'prompts', label: '运行提示词' },
];

function toBaseItem(
  area: ResourceArea,
  entry: ResourceCatalogEntry,
  title: string,
  content: string,
  meta: string,
): ResourceCenterItem {
  return {
    area,
    id: entry.id,
    name: entry.name,
    title,
    description: entry.description,
    integration: entry.integration,
    visibility: entry.visibility,
    feature: entry.feature,
    usageKind: entry.usageKind,
    path: entry.path,
    source: entry.source,
    removable: entry.removable === true,
    content,
    meta,
  };
}

export function flattenResourceCatalog(resources: ResourceCatalog): readonly ResourceCenterItem[] {
  const skills = resources.skills.map((entry: ResourceSkillCatalogEntry) =>
    toBaseItem('skills', entry, entry.title, entry.content, `${entry.capabilities.length} 个能力`),
  );
  const agents = resources.agents.map((entry: ResourceAgentCatalogEntry) =>
    toBaseItem(
      'agents',
      entry,
      entry.displayName,
      entry.systemPrompt,
      `${entry.allowedTools.length} 个工具`,
    ),
  );
  const agentTemplates = resources.agentTemplates.map((entry: ResourceTextCatalogEntry) =>
    toBaseItem('agentTemplates', entry, entry.title, entry.content, '模板'),
  );
  const commands = resources.commands.map((entry: ResourceCommandCatalogEntry) =>
    toBaseItem('commands', entry, entry.title, entry.content, '参考命令模板 · 不自动执行'),
  );
  const souls = resources.souls.map((entry: ResourceTextCatalogEntry) =>
    toBaseItem('souls', entry, entry.title, entry.content, 'Soul'),
  );
  const prompts = resources.prompts.map((entry: ResourceTextCatalogEntry) =>
    toBaseItem('prompts', entry, entry.title, entry.content, '运行提示词材料 · 按功能显式注入'),
  );
  const extensions = resources.extensions.map((entry: ResourceExtensionCatalogEntry) =>
    toBaseItem(
      'extensions',
      entry,
      entry.title,
      entry.content ?? '',
      `${entry.files.length} 个文件`,
    ),
  );
  const mcps = resources.mcps.map((entry: ResourceMcpCatalogEntry) =>
    toBaseItem(
      'mcps',
      entry,
      entry.title,
      entry.content ?? '',
      `${entry.transport} · ${entry.builtinKind}`,
    ),
  );
  return [
    ...skills,
    ...agents,
    ...agentTemplates,
    ...commands,
    ...souls,
    ...prompts,
    ...extensions,
    ...mcps,
  ];
}

export function splitResourceCenterItems(resources: ResourceCatalog): {
  readonly catalogItems: readonly ResourceCenterItem[];
  readonly featureItems: readonly ResourceCenterItem[];
} {
  const items = flattenResourceCatalog(resources);
  return {
    catalogItems: items.filter((item) => item.visibility === 'catalog'),
    featureItems: items.filter((item) => item.visibility === 'feature'),
  };
}

export function filterResourceItems(
  items: readonly ResourceCenterItem[],
  area: ResourceArea | 'all',
  query: string,
): readonly ResourceCenterItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => {
    if (area !== 'all' && item.area !== area) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [item.name, item.title, item.description, item.path]
      .join('\n')
      .toLowerCase()
      .includes(normalizedQuery);
  });
}
