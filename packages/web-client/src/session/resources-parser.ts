import {
  RESOURCE_USAGE_DEFAULTS,
  type ResourceCatalog,
  type ResourceCatalogEntry,
  type ResourceFeature,
  type ResourceIntegrationMode,
  type ResourceUsageDefaults,
  type ResourceUsageKind,
  type ResourceVisibility,
} from './resources-types.js';
import {
  isJsonObject,
  readBoolean,
  readNumber,
  readString,
  readStringList,
  type JsonObject,
} from './resources-json.js';

export { EMPTY_RESOURCE_CATALOG } from './resources-types.js';

function readIntegration(record: JsonObject): ResourceIntegrationMode {
  const integration = readString(record, 'integration');
  if (integration === 'reference' || integration === 'user') {
    return integration;
  }
  return 'builtin';
}

function readVisibility(record: JsonObject, fallback: ResourceVisibility): ResourceVisibility {
  const value = readString(record, 'visibility');
  return value === 'catalog' || value === 'feature' ? value : fallback;
}

function readFeature(record: JsonObject, fallback: ResourceFeature): ResourceFeature {
  const value = readString(record, 'feature');
  switch (value) {
    case 'agents':
    case 'channels':
    case 'commands':
    case 'extensions':
    case 'mcps':
    case 'prompts':
    case 'skills':
    case 'team':
      return value;
    default:
      return fallback;
  }
}

function readUsageKind(record: JsonObject, fallback: ResourceUsageKind): ResourceUsageKind {
  const value = readString(record, 'usageKind');
  switch (value) {
    case 'agent':
    case 'agent-template':
    case 'channel-persona':
    case 'command-definition':
    case 'extension-example':
    case 'mcp-server':
    case 'runtime-instruction':
    case 'skill':
      return value;
    default:
      return fallback;
  }
}

function readTransport(record: JsonObject): 'sse' | 'stdio' {
  return readString(record, 'transport') === 'stdio' ? 'stdio' : 'sse';
}

function readBuiltinKind(record: JsonObject): 'system' | 'virtual' | 'adapter' {
  const value = readString(record, 'builtinKind');
  if (value === 'virtual' || value === 'adapter') {
    return value;
  }
  return 'system';
}

function readExecution(record: JsonObject): 'client' | 'server' | undefined {
  const value = readString(record, 'execution');
  if (value === 'client' || value === 'server') {
    return value;
  }
  return undefined;
}

function readBaseEntry(
  record: JsonObject,
  defaults: ResourceUsageDefaults,
): ResourceCatalogEntry | null {
  const id = readString(record, 'id');
  const name = readString(record, 'name');
  if (!id || !name) {
    return null;
  }
  const source = readString(record, 'source');
  const createdAt = readString(record, 'createdAt');
  const updatedAt = readString(record, 'updatedAt');
  return {
    id,
    name,
    description: readString(record, 'description'),
    integration: readIntegration(record),
    visibility: readVisibility(record, defaults.visibility),
    feature: readFeature(record, defaults.feature),
    usageKind: readUsageKind(record, defaults.usageKind),
    path: readString(record, 'path'),
    ...(source === 'system' || source === 'user' ? { source } : {}),
    ...(record['removable'] === true ? { removable: true } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function readRecords(root: JsonObject, key: keyof ResourceCatalog): readonly JsonObject[] {
  const value = root[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isJsonObject);
}

function mapEntry<T extends ResourceCatalogEntry>(
  records: readonly JsonObject[],
  defaults: ResourceUsageDefaults,
  mapper: (record: JsonObject, base: ResourceCatalogEntry) => T,
): readonly T[] {
  return records.flatMap((record) => {
    const base = readBaseEntry(record, defaults);
    return base ? [mapper(record, base)] : [];
  });
}

export function parseResourceCatalog(payload: unknown): ResourceCatalog {
  if (!isJsonObject(payload) || !isJsonObject(payload['resources'])) {
    throw new Error('资源目录响应格式无效。');
  }
  const resources = payload['resources'];

  return {
    skills: mapEntry(readRecords(resources, 'skills'), RESOURCE_USAGE_DEFAULTS.skills, (r, b) => ({
      ...b,
      capabilities: readStringList(r, 'capabilities'),
      content: readString(r, 'content'),
      permissions: Array.isArray(r['permissions']) ? r['permissions'] : [],
      title: readString(r, 'title', b.name),
    })),
    agents: mapEntry(readRecords(resources, 'agents'), RESOURCE_USAGE_DEFAULTS.agents, (r, b) => {
      const color = readString(r, 'color');
      const maxIterations = readNumber(r, 'maxIterations');
      return {
        ...b,
        allowedTools: readStringList(r, 'allowedTools'),
        ...(color ? { color } : {}),
        displayName: readString(r, 'displayName', b.name),
        ...(maxIterations !== undefined ? { maxIterations } : {}),
        systemPrompt: readString(r, 'systemPrompt'),
      };
    }),
    agentTemplates: mapEntry(
      readRecords(resources, 'agentTemplates'),
      RESOURCE_USAGE_DEFAULTS.agentTemplates,
      (r, b) => ({
        ...b,
        content: readString(r, 'content'),
        title: readString(r, 'title', b.name),
      }),
    ),
    commands: mapEntry(
      readRecords(resources, 'commands'),
      RESOURCE_USAGE_DEFAULTS.commands,
      (r, b) => {
        const execution = readExecution(r);
        return {
          ...b,
          content: readString(r, 'content'),
          contexts: readStringList(r, 'contexts'),
          ...(execution ? { execution } : {}),
          title: readString(r, 'title', b.name),
        };
      },
    ),
    souls: mapEntry(readRecords(resources, 'souls'), RESOURCE_USAGE_DEFAULTS.souls, (r, b) => ({
      ...b,
      content: readString(r, 'content'),
      title: readString(r, 'title', b.name),
    })),
    prompts: mapEntry(
      readRecords(resources, 'prompts'),
      RESOURCE_USAGE_DEFAULTS.prompts,
      (r, b) => ({
        ...b,
        content: readString(r, 'content'),
        title: readString(r, 'title', b.name),
      }),
    ),
    extensions: mapEntry(
      readRecords(resources, 'extensions'),
      RESOURCE_USAGE_DEFAULTS.extensions,
      (r, b) => ({
        ...b,
        ...(readString(r, 'content') ? { content: readString(r, 'content') } : {}),
        files: readStringList(r, 'files'),
        title: readString(r, 'title', b.name),
      }),
    ),
    mcps: mapEntry(readRecords(resources, 'mcps'), RESOURCE_USAGE_DEFAULTS.mcps, (r, b) => ({
      ...b,
      builtinKind: readBuiltinKind(r),
      ...(readString(r, 'content') ? { content: readString(r, 'content') } : {}),
      enabledByDefault: readBoolean(r, 'enabledByDefault', true),
      title: readString(r, 'title', b.name),
      transport: readTransport(r),
    })),
  };
}
