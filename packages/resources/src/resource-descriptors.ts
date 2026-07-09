import {
  INTEGRATED_RESOURCE_AGENT_NAMES,
  REFERENCE_ONLY_RESOURCE_AGENT_NAMES,
  RESOURCE_AGENT_NAMES,
  RESOURCE_AGENT_TEMPLATE_NAMES,
  RESOURCE_COMMAND_NAMES,
  RESOURCE_COMMAND_PROFILES,
  RESOURCE_EXTENSION_NAMES,
  RESOURCE_PROMPT_NAMES,
  RESOURCE_SOUL_NAMES,
  resourceAgentId,
  type IntegratedResourceAgentName,
  type ResourceAgentName,
  type ResourceAgentTemplateName,
  type ResourceCommandName,
  type ResourceFeature,
  type ResourceExtensionName,
  type ResourceIntegrationMode,
  type ResourcePromptName,
  type ResourceSoulName,
  type ResourceUsageKind,
  type ResourceVisibility,
} from './catalog.js';
import {
  listFilesRecursive,
  parseCsvList,
  parseInteger,
  readJsonRecord,
  readMarkdownDocument,
  readTextResource,
  resourcePath,
  toTitle,
} from './resource-files.js';

export interface ResourceAgentDescriptor {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly icon?: string;
  readonly allowedTools: readonly string[];
  readonly maxIterations: number;
  readonly integration: ResourceIntegrationMode;
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
  readonly path: string;
  readonly systemPrompt: string;
}

export interface ResourceTextDescriptor<Name extends string = string> {
  readonly id: string;
  readonly name: Name;
  readonly title: string;
  readonly description: string;
  readonly integration: ResourceIntegrationMode;
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
  readonly path: string;
  readonly content: string;
}

export interface ResourceExtensionDescriptor {
  readonly id: string;
  readonly name: ResourceExtensionName;
  readonly title: string;
  readonly description: string;
  readonly integration: ResourceIntegrationMode;
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
  readonly path: string;
  readonly files: readonly string[];
}

export class ResourceDocumentError extends Error {
  constructor(area: string, name: string, message: string) {
    super(`Invalid resource ${area}/${name}: ${message}`);
    this.name = 'ResourceDocumentError';
  }
}

export function createResourceAgentDescriptor(
  agentName: ResourceAgentName,
): ResourceAgentDescriptor {
  const documentPath = resourcePath('agents', 'reference', `${agentName}.md`);
  const document = readMarkdownDocument(documentPath);
  const frontmatterName = document.frontmatter.name;
  const description = document.frontmatter.description;
  if (!frontmatterName) {
    throw new ResourceDocumentError('agents', agentName, 'missing frontmatter name');
  }
  if (!description) {
    throw new ResourceDocumentError('agents', agentName, 'missing frontmatter description');
  }
  if (!document.body) {
    throw new ResourceDocumentError('agents', agentName, 'empty agent prompt');
  }

  return {
    id: isIntegratedResourceAgentName(agentName)
      ? resourceAgentId(agentName)
      : `resource-reference-${agentName}`,
    name: agentName,
    displayName: frontmatterName,
    description,
    icon: document.frontmatter.icon,
    allowedTools: parseCsvList(document.frontmatter.allowedTools),
    maxIterations: parseInteger(document.frontmatter.maxIterations) ?? 0,
    integration: isIntegratedResourceAgentName(agentName) ? 'builtin' : 'reference',
    visibility: 'catalog',
    feature: 'agents',
    usageKind: 'agent',
    path: documentPath,
    systemPrompt: document.body,
  };
}

export function listResourceAgentDescriptors(): readonly ResourceAgentDescriptor[] {
  return RESOURCE_AGENT_NAMES.map(createResourceAgentDescriptor);
}

export function listIntegratedResourceAgents(): readonly ResourceAgentDescriptor[] {
  return INTEGRATED_RESOURCE_AGENT_NAMES.map(createResourceAgentDescriptor);
}

export function listReferenceOnlyResourceAgents(): readonly ResourceAgentDescriptor[] {
  return REFERENCE_ONLY_RESOURCE_AGENT_NAMES.map(createResourceAgentDescriptor);
}

export function createResourceAgentTemplateDescriptor(
  templateName: ResourceAgentTemplateName,
): ResourceTextDescriptor<ResourceAgentTemplateName> {
  const documentPath = resourcePath('agents', 'reference', 'templates', `${templateName}.md`);
  return {
    id: `resource-agent-template-${templateName.toLowerCase()}`,
    name: templateName,
    title: `${templateName}.md`,
    description: `参考 workspace memory 模板：${templateName}.md`,
    integration: 'reference',
    visibility: 'feature',
    feature: 'team',
    usageKind: 'agent-template',
    path: documentPath,
    content: readTextResource('agents', 'reference', 'templates', `${templateName}.md`),
  };
}

export function listResourceAgentTemplateDescriptors(): readonly ResourceTextDescriptor<ResourceAgentTemplateName>[] {
  return RESOURCE_AGENT_TEMPLATE_NAMES.map(createResourceAgentTemplateDescriptor);
}

export function createResourceCommandDescriptor(
  commandName: ResourceCommandName,
): ResourceTextDescriptor<ResourceCommandName> {
  const profile = RESOURCE_COMMAND_PROFILES[commandName];
  return {
    id: `resource-command-${commandName}`,
    name: commandName,
    title: `/${commandName}`,
    description: profile.description,
    integration: profile.integration,
    visibility: 'feature',
    feature: 'commands',
    usageKind: 'command-definition',
    path: resourcePath('commands', 'reference', `${commandName}.md`),
    content: readTextResource('commands', 'reference', `${commandName}.md`),
  };
}

export function listResourceCommandDescriptors(): readonly ResourceTextDescriptor<ResourceCommandName>[] {
  return RESOURCE_COMMAND_NAMES.map(createResourceCommandDescriptor);
}

export function createResourceSoulDescriptor(
  soulName: ResourceSoulName,
): ResourceTextDescriptor<ResourceSoulName> {
  return {
    id: `resource-soul-${soulName}`,
    name: soulName,
    title: toTitle(soulName),
    description: `通道与个人会话人设模板：${toTitle(soulName)}`,
    integration: 'reference',
    visibility: 'feature',
    feature: 'channels',
    usageKind: 'channel-persona',
    path: resourcePath('souls', 'reference', `${soulName}.md`),
    content: readTextResource('souls', 'reference', `${soulName}.md`),
  };
}

export function listResourceSoulDescriptors(): readonly ResourceTextDescriptor<ResourceSoulName>[] {
  return RESOURCE_SOUL_NAMES.map(createResourceSoulDescriptor);
}

export function createResourcePromptDescriptor(
  promptName: ResourcePromptName,
): ResourceTextDescriptor<ResourcePromptName> {
  return {
    id: `resource-prompt-${promptName}`,
    name: promptName,
    title: toTitle(promptName),
    description: `参考 prompt resource：${toTitle(promptName)}`,
    integration: 'reference',
    visibility: 'feature',
    feature: 'prompts',
    usageKind: 'runtime-instruction',
    path: resourcePath('prompts', 'reference', `${promptName}.md`),
    content: readTextResource('prompts', 'reference', `${promptName}.md`),
  };
}

export function listResourcePromptDescriptors(): readonly ResourceTextDescriptor<ResourcePromptName>[] {
  return RESOURCE_PROMPT_NAMES.map(createResourcePromptDescriptor);
}

export function createResourceExtensionDescriptor(
  extensionName: ResourceExtensionName,
): ResourceExtensionDescriptor {
  const extensionPath = resourcePath('extensions', 'reference', extensionName);
  const manifest = readJsonRecord(
    resourcePath('extensions', 'reference', extensionName, 'extension.json'),
  );
  const title = typeof manifest['name'] === 'string' ? manifest['name'] : extensionName;
  const description =
    typeof manifest['description'] === 'string'
      ? manifest['description']
      : `参考 extension example：${extensionName}`;
  return {
    id: `resource-extension-${extensionName}`,
    name: extensionName,
    title,
    description,
    integration: 'reference',
    visibility: 'catalog',
    feature: 'extensions',
    usageKind: 'extension-example',
    path: extensionPath,
    files: listFilesRecursive(extensionPath),
  };
}

export function listResourceExtensionDescriptors(): readonly ResourceExtensionDescriptor[] {
  return RESOURCE_EXTENSION_NAMES.map(createResourceExtensionDescriptor);
}

function isIntegratedResourceAgentName(
  agentName: ResourceAgentName,
): agentName is IntegratedResourceAgentName {
  return INTEGRATED_RESOURCE_AGENT_NAMES.some((integratedName) => integratedName === agentName);
}
