import type { ResourceAgentTemplateName, ResourcePromptName, ResourceSoulName } from './catalog.js';
import {
  listResourceSkillDescriptors,
  type ResourceSkillDescriptor,
} from './resource-skill-descriptors.js';
import {
  listSystemBuiltinAgentDescriptors,
  listSystemBuiltinCommandDescriptors,
  listSystemBuiltinMcpDescriptors,
  listSystemBuiltinSkillDescriptors,
  type SystemBuiltinAgentDescriptor,
  type SystemBuiltinMcpDescriptor,
} from './system-descriptors.js';
import {
  listResourceAgentDescriptors,
  listResourceAgentTemplateDescriptors,
  listResourceCommandDescriptors,
  listResourceExtensionDescriptors,
  listResourcePromptDescriptors,
  listResourceSoulDescriptors,
  type ResourceAgentDescriptor,
  type ResourceExtensionDescriptor,
  type ResourceTextDescriptor,
} from './resource-descriptors.js';

export { resourcePath, resourceUrl } from './resource-files.js';
export {
  ResourceSkillManifestError,
  createBuiltinResourceSkillDefs,
  createResourceSkillDescriptor,
  createResourceSkillManifest,
  listResourceSkillDescriptors,
} from './resource-skill-descriptors.js';
export type {
  BuiltinResourceSkillDef,
  ResourceSkillDescriptor,
} from './resource-skill-descriptors.js';
export {
  ResourceDocumentError,
  createResourceAgentDescriptor,
  createResourceAgentTemplateDescriptor,
  createResourceCommandDescriptor,
  createResourceExtensionDescriptor,
  createResourcePromptDescriptor,
  createResourceSoulDescriptor,
  listIntegratedResourceAgents,
  listReferenceOnlyResourceAgents,
  listResourceAgentDescriptors,
  listResourceAgentTemplateDescriptors,
  listResourceCommandDescriptors,
  listResourceExtensionDescriptors,
  listResourcePromptDescriptors,
  listResourceSoulDescriptors,
} from './resource-descriptors.js';
export {
  SystemResourceError,
  createSystemBuiltinAgentDescriptor,
  createSystemBuiltinCommandDescriptor,
  createSystemBuiltinMcpDescriptor,
  createSystemBuiltinSkillDefs,
  createSystemBuiltinSkillDescriptor,
  createSystemBuiltinSkillManifest,
  getSystemBuiltinAgentDescriptor,
  getSystemBuiltinMcpDescriptor,
  listSystemBuiltinAgentDescriptors,
  listSystemBuiltinCommandDescriptors,
  listSystemBuiltinMcpDescriptors,
  listSystemBuiltinSkillDescriptors,
} from './system-descriptors.js';
export type {
  ResourceAgentDescriptor,
  ResourceExtensionDescriptor,
  ResourceTextDescriptor,
} from './resource-descriptors.js';
export type {
  SystemBuiltinAgentDescriptor,
  SystemBuiltinCommandDescriptor,
  SystemBuiltinMcpDescriptor,
  SystemBuiltinSkillDef,
} from './system-descriptors.js';
export type {
  SystemBuiltinAgentName,
  SystemBuiltinCommandId,
  SystemBuiltinMcpId,
  SystemBuiltinSkillName,
} from './system-catalog.js';

export interface ResourceCatalog {
  readonly skills: readonly ResourceSkillDescriptor[];
  readonly agents: readonly (SystemBuiltinAgentDescriptor | ResourceAgentDescriptor)[];
  readonly agentTemplates: readonly ResourceTextDescriptor<ResourceAgentTemplateName>[];
  readonly commands: readonly ResourceTextDescriptor[];
  readonly souls: readonly ResourceTextDescriptor<ResourceSoulName>[];
  readonly prompts: readonly ResourceTextDescriptor<ResourcePromptName>[];
  readonly extensions: readonly ResourceExtensionDescriptor[];
  readonly mcps: readonly SystemBuiltinMcpDescriptor[];
}

export function listResourceCatalog(): ResourceCatalog {
  return {
    skills: [...listSystemBuiltinSkillDescriptors(), ...listResourceSkillDescriptors()],
    agents: [...listSystemBuiltinAgentDescriptors(), ...listResourceAgentDescriptors()],
    agentTemplates: listResourceAgentTemplateDescriptors(),
    commands: [...listSystemBuiltinCommandDescriptors(), ...listResourceCommandDescriptors()],
    souls: listResourceSoulDescriptors(),
    prompts: listResourcePromptDescriptors(),
    extensions: listResourceExtensionDescriptors(),
    mcps: listSystemBuiltinMcpDescriptors(),
  };
}

function isCatalogVisible(entry: { readonly visibility?: string }): boolean {
  return entry.visibility !== 'feature';
}

export function listResourceCenterCatalog(): ResourceCatalog {
  const catalog = listResourceCatalog();
  return {
    skills: catalog.skills.filter(isCatalogVisible),
    agents: catalog.agents.filter(isCatalogVisible),
    agentTemplates: catalog.agentTemplates.filter(isCatalogVisible),
    commands: catalog.commands.filter(isCatalogVisible),
    souls: catalog.souls.filter(isCatalogVisible),
    prompts: catalog.prompts.filter(isCatalogVisible),
    extensions: catalog.extensions.filter(isCatalogVisible),
    mcps: catalog.mcps.filter(isCatalogVisible),
  };
}
