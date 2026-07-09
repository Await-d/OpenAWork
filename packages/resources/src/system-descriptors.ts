import type { SkillExecutor, SkillManifest } from '@openAwork/skill-types';
import {
  SYSTEM_BUILTIN_AGENT_NAMES,
  SYSTEM_BUILTIN_COMMAND_IDS,
  SYSTEM_BUILTIN_MCP_IDS,
  SYSTEM_BUILTIN_SKILL_NAMES,
  SYSTEM_BUILTIN_SKILL_PROFILES,
  systemBuiltinSkillId,
  type SystemBuiltinAgentName,
  type SystemBuiltinCommandId,
  type SystemBuiltinMcpId,
  type SystemBuiltinSkillName,
} from './system-catalog.js';
import {
  parseCsvList,
  readJsonRecord,
  readMarkdownDocument,
  resourcePath,
} from './resource-files.js';
import {
  copyPermissions,
  type ResourceFeature,
  type ResourceIntegrationMode,
  type ResourceUsageKind,
  type ResourceVisibility,
} from './catalog.js';
import type { ResourceSkillDescriptor } from './resource-skill-descriptors.js';
import type { ResourceTextDescriptor } from './resource-descriptors.js';

export interface SystemBuiltinAgentDescriptor {
  readonly id: SystemBuiltinAgentName;
  readonly name: SystemBuiltinAgentName;
  readonly displayName: string;
  readonly description: string;
  readonly color?: string;
  readonly integration: Extract<ResourceIntegrationMode, 'builtin'>;
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
  readonly path: string;
  readonly systemPrompt: string;
}

export interface SystemBuiltinSkillDef {
  readonly manifest: SkillManifest;
  readonly executor: SkillExecutor;
}

export interface SystemBuiltinCommandDescriptor extends ResourceTextDescriptor<SystemBuiltinCommandId> {
  readonly contexts: readonly string[];
  readonly execution: 'client' | 'server';
}

export interface SystemBuiltinMcpDescriptor {
  readonly id: SystemBuiltinMcpId;
  readonly name: SystemBuiltinMcpId;
  readonly title: string;
  readonly description: string;
  readonly integration: Extract<ResourceIntegrationMode, 'builtin'>;
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
  readonly path: string;
  readonly transport: 'sse' | 'stdio';
  readonly builtinKind: 'system' | 'virtual' | 'adapter';
  readonly enabledByDefault: boolean;
}

export class SystemResourceError extends Error {
  constructor(area: string, name: string, message: string) {
    super(`Invalid system resource ${area}/${name}: ${message}`);
    this.name = 'SystemResourceError';
  }
}

export function createSystemBuiltinAgentDescriptor(
  agentName: SystemBuiltinAgentName,
): SystemBuiltinAgentDescriptor {
  const documentPath = resourcePath('agents', 'builtin', `${agentName}.md`);
  const document = readMarkdownDocument(documentPath);
  const name = document.frontmatter.name;
  const description = document.frontmatter.description;
  if (name !== agentName) {
    throw new SystemResourceError('agents', agentName, `frontmatter name must be "${agentName}"`);
  }
  if (!description) {
    throw new SystemResourceError('agents', agentName, 'missing frontmatter description');
  }
  if (!document.body) {
    throw new SystemResourceError('agents', agentName, 'empty system prompt');
  }

  return {
    id: agentName,
    name: agentName,
    displayName: name,
    description,
    color: document.frontmatter.color,
    integration: 'builtin',
    visibility: 'catalog',
    feature: 'agents',
    usageKind: 'agent',
    path: documentPath,
    systemPrompt: document.body,
  };
}

export function listSystemBuiltinAgentDescriptors(): readonly SystemBuiltinAgentDescriptor[] {
  return SYSTEM_BUILTIN_AGENT_NAMES.map(createSystemBuiltinAgentDescriptor);
}

export function getSystemBuiltinAgentDescriptor(
  agentId: string,
): SystemBuiltinAgentDescriptor | undefined {
  const agentName = SYSTEM_BUILTIN_AGENT_NAMES.find((name) => name === agentId);
  return agentName ? createSystemBuiltinAgentDescriptor(agentName) : undefined;
}

export function createSystemBuiltinSkillManifest(skillName: SystemBuiltinSkillName): SkillManifest {
  const documentPath = resourcePath('skills', 'builtin', `${skillName}.md`);
  const document = readMarkdownDocument(documentPath);
  const name = document.frontmatter.name;
  const description = document.frontmatter.description;
  if (name !== skillName) {
    throw new SystemResourceError('skills', skillName, `frontmatter name must be "${skillName}"`);
  }
  if (!description) {
    throw new SystemResourceError('skills', skillName, 'missing frontmatter description');
  }
  if (!document.body) {
    throw new SystemResourceError('skills', skillName, 'empty model instructions');
  }

  const profile = SYSTEM_BUILTIN_SKILL_PROFILES[skillName];
  return {
    apiVersion: 'agent-skill/v1',
    id: systemBuiltinSkillId(skillName),
    name: skillName,
    displayName: document.frontmatter.displayName ?? skillName,
    version: '1.0.0',
    description,
    descriptionForModel: document.body,
    capabilities: [...profile.capabilities],
    permissions: copyPermissions(profile.permissions),
    lifecycle: { activation: 'on-demand' },
    references: [{ path: documentPath, loadAt: 'activation' }],
  };
}

export function createSystemBuiltinSkillDefs(
  executor: SkillExecutor,
): readonly SystemBuiltinSkillDef[] {
  return SYSTEM_BUILTIN_SKILL_NAMES.map((skillName) => ({
    manifest: createSystemBuiltinSkillManifest(skillName),
    executor,
  }));
}

export function createSystemBuiltinSkillDescriptor(
  skillName: SystemBuiltinSkillName,
): ResourceSkillDescriptor {
  const manifest = createSystemBuiltinSkillManifest(skillName);
  return {
    id: manifest.id,
    name: skillName,
    title: manifest.displayName,
    description: manifest.description,
    integration: 'builtin',
    visibility: 'catalog',
    feature: 'skills',
    usageKind: 'skill',
    path: resourcePath('skills', 'builtin', `${skillName}.md`),
    content: manifest.descriptionForModel ?? '',
    capabilities: manifest.capabilities,
    permissions: manifest.permissions,
  };
}

export function listSystemBuiltinSkillDescriptors(): readonly ResourceSkillDescriptor[] {
  return SYSTEM_BUILTIN_SKILL_NAMES.map(createSystemBuiltinSkillDescriptor);
}

export function createSystemBuiltinCommandDescriptor(
  commandId: SystemBuiltinCommandId,
): SystemBuiltinCommandDescriptor {
  const documentPath = resourcePath('commands', 'builtin', `${commandId}.json`);
  const record = readJsonRecord(documentPath);
  const id = readRequiredString(record, 'id', 'commands', commandId);
  if (id !== commandId) {
    throw new SystemResourceError('commands', commandId, `id must be "${commandId}"`);
  }
  const label = readRequiredString(record, 'label', 'commands', commandId);
  const description = readOptionalString(record, 'description') ?? '命令';
  const execution = readExecution(record, commandId);
  return {
    id: commandId,
    name: commandId,
    title: label,
    description,
    integration: 'builtin',
    visibility: 'catalog',
    feature: 'commands',
    usageKind: 'command-definition',
    path: documentPath,
    content: description,
    contexts: parseCsvList(readOptionalString(record, 'contexts')),
    execution,
  };
}

export function listSystemBuiltinCommandDescriptors(): readonly SystemBuiltinCommandDescriptor[] {
  return SYSTEM_BUILTIN_COMMAND_IDS.map(createSystemBuiltinCommandDescriptor);
}

export function createSystemBuiltinMcpDescriptor(
  mcpId: SystemBuiltinMcpId,
): SystemBuiltinMcpDescriptor {
  const documentPath = resourcePath('mcps', 'builtin', `${mcpId}.json`);
  const record = readJsonRecord(documentPath);
  const id = readRequiredString(record, 'id', 'mcps', mcpId);
  if (id !== mcpId) {
    throw new SystemResourceError('mcps', mcpId, `id must be "${mcpId}"`);
  }
  return {
    id: mcpId,
    name: mcpId,
    title: readOptionalString(record, 'title') ?? mcpId,
    description: readOptionalString(record, 'description') ?? '内置 MCP server',
    integration: 'builtin',
    visibility: 'catalog',
    feature: 'mcps',
    usageKind: 'mcp-server',
    path: documentPath,
    transport: readTransport(record, mcpId),
    builtinKind: readBuiltinKind(record, mcpId),
    enabledByDefault: record.enabledByDefault !== false,
  };
}

export function listSystemBuiltinMcpDescriptors(): readonly SystemBuiltinMcpDescriptor[] {
  return SYSTEM_BUILTIN_MCP_IDS.map(createSystemBuiltinMcpDescriptor);
}

export function getSystemBuiltinMcpDescriptor(
  mcpId: SystemBuiltinMcpId,
): SystemBuiltinMcpDescriptor {
  return createSystemBuiltinMcpDescriptor(mcpId);
}

function readRequiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  area: string,
  name: string,
): string {
  const value = readOptionalString(record, key);
  if (!value) {
    throw new SystemResourceError(area, name, `missing ${key}`);
  }
  return value;
}

function readOptionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readExecution(
  record: Readonly<Record<string, unknown>>,
  commandId: SystemBuiltinCommandId,
): 'client' | 'server' {
  const value = readRequiredString(record, 'execution', 'commands', commandId);
  if (value === 'client' || value === 'server') {
    return value;
  }
  throw new SystemResourceError('commands', commandId, 'execution must be client or server');
}

function readTransport(
  record: Readonly<Record<string, unknown>>,
  mcpId: SystemBuiltinMcpId,
): 'sse' | 'stdio' {
  const value = readRequiredString(record, 'transport', 'mcps', mcpId);
  if (value === 'sse' || value === 'stdio') {
    return value;
  }
  throw new SystemResourceError('mcps', mcpId, 'transport must be sse or stdio');
}

function readBuiltinKind(
  record: Readonly<Record<string, unknown>>,
  mcpId: SystemBuiltinMcpId,
): 'system' | 'virtual' | 'adapter' {
  const value = readRequiredString(record, 'builtinKind', 'mcps', mcpId);
  if (value === 'system' || value === 'virtual' || value === 'adapter') {
    return value;
  }
  throw new SystemResourceError('mcps', mcpId, 'builtinKind must be system, virtual, or adapter');
}
