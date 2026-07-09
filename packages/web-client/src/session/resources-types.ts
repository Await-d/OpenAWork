export type ResourceIntegrationMode = 'builtin' | 'reference' | 'user';
export type ResourceVisibility = 'catalog' | 'feature';
export type ResourceFeature =
  'agents' | 'channels' | 'commands' | 'extensions' | 'mcps' | 'prompts' | 'skills' | 'team';
export type ResourceUsageKind =
  | 'agent'
  | 'agent-template'
  | 'channel-persona'
  | 'command-definition'
  | 'extension-example'
  | 'mcp-server'
  | 'runtime-instruction'
  | 'skill';
export type ResourceArea =
  'skills' | 'agents' | 'agentTemplates' | 'commands' | 'souls' | 'prompts' | 'extensions' | 'mcps';

export interface ResourceCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly integration: ResourceIntegrationMode;
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
  readonly path: string;
  readonly source?: 'system' | 'user';
  readonly removable?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface ResourceSkillCatalogEntry extends ResourceCatalogEntry {
  readonly capabilities: readonly string[];
  readonly content: string;
  readonly permissions: readonly unknown[];
  readonly title: string;
}

export interface ResourceAgentCatalogEntry extends ResourceCatalogEntry {
  readonly allowedTools: readonly string[];
  readonly color?: string;
  readonly displayName: string;
  readonly maxIterations?: number;
  readonly systemPrompt: string;
}

export interface ResourceTextCatalogEntry extends ResourceCatalogEntry {
  readonly content: string;
  readonly title: string;
}

export interface ResourceCommandCatalogEntry extends ResourceTextCatalogEntry {
  readonly contexts?: readonly string[];
  readonly execution?: 'client' | 'server';
}

export interface ResourceExtensionCatalogEntry extends ResourceCatalogEntry {
  readonly content?: string;
  readonly files: readonly string[];
  readonly title: string;
}

export interface ResourceMcpCatalogEntry extends ResourceCatalogEntry {
  readonly builtinKind: 'system' | 'virtual' | 'adapter';
  readonly content?: string;
  readonly enabledByDefault: boolean;
  readonly title: string;
  readonly transport: 'sse' | 'stdio';
}

export interface ResourceCatalog {
  readonly skills: readonly ResourceSkillCatalogEntry[];
  readonly agents: readonly ResourceAgentCatalogEntry[];
  readonly agentTemplates: readonly ResourceTextCatalogEntry[];
  readonly commands: readonly ResourceCommandCatalogEntry[];
  readonly souls: readonly ResourceTextCatalogEntry[];
  readonly prompts: readonly ResourceTextCatalogEntry[];
  readonly extensions: readonly ResourceExtensionCatalogEntry[];
  readonly mcps: readonly ResourceMcpCatalogEntry[];
}

export interface ResourcesListResult {
  readonly resources: ResourceCatalog;
  readonly errorMessage?: string;
  readonly ok: boolean;
  readonly retryable: boolean;
  readonly status?: number;
}

export interface UploadResourceInput {
  readonly area: ResourceArea;
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  readonly content: string;
}

export interface ResourcesClient {
  list(token: string): Promise<ResourceCatalog>;
  listResult(token: string): Promise<ResourcesListResult>;
  upload(token: string, input: UploadResourceInput): Promise<ResourceCatalog>;
  remove(token: string, resourceId: string): Promise<ResourceCatalog>;
}

export interface ResourceUsageDefaults {
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
}

export const RESOURCE_USAGE_DEFAULTS = {
  skills: { visibility: 'catalog', feature: 'skills', usageKind: 'skill' },
  agents: { visibility: 'catalog', feature: 'agents', usageKind: 'agent' },
  agentTemplates: { visibility: 'feature', feature: 'team', usageKind: 'agent-template' },
  commands: { visibility: 'feature', feature: 'commands', usageKind: 'command-definition' },
  souls: { visibility: 'feature', feature: 'channels', usageKind: 'channel-persona' },
  prompts: { visibility: 'feature', feature: 'prompts', usageKind: 'runtime-instruction' },
  extensions: { visibility: 'catalog', feature: 'extensions', usageKind: 'extension-example' },
  mcps: { visibility: 'catalog', feature: 'mcps', usageKind: 'mcp-server' },
} as const satisfies Record<keyof ResourceCatalog, ResourceUsageDefaults>;

export const EMPTY_RESOURCE_CATALOG: ResourceCatalog = {
  skills: [],
  agents: [],
  agentTemplates: [],
  commands: [],
  souls: [],
  prompts: [],
  extensions: [],
  mcps: [],
};
