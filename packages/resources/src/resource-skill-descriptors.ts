import type { SkillExecutor, SkillManifest } from '@openAwork/skill-types';
import {
  INTEGRATED_RESOURCE_SKILL_NAMES,
  RESOURCE_SKILL_NAMES,
  RESOURCE_SKILL_PROFILES,
  copyPermissions,
  resourceSkillId,
  type ResourceFeature,
  type ResourceCatalogSkillName,
  type ResourceUsageKind,
  type ResourceSkillName,
  type ResourceVisibility,
} from './catalog.js';
import { parseFrontmatter, readTextResource, resourcePath } from './resource-files.js';

export interface BuiltinResourceSkillDef {
  readonly manifest: SkillManifest;
  readonly executor: SkillExecutor;
}

interface ParsedSkillDocument {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly license?: string;
  readonly compatibility?: string;
}

export interface ResourceSkillDescriptor {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly integration: 'builtin' | 'reference';
  readonly visibility: ResourceVisibility;
  readonly feature: ResourceFeature;
  readonly usageKind: ResourceUsageKind;
  readonly path: string;
  readonly content: string;
  readonly capabilities: readonly string[];
  readonly permissions: SkillManifest['permissions'];
}

export class ResourceSkillManifestError extends Error {
  readonly skillName: ResourceCatalogSkillName;

  constructor(skillName: ResourceCatalogSkillName, message: string) {
    super(`Invalid resource skill "${skillName}": ${message}`);
    this.name = 'ResourceSkillManifestError';
    this.skillName = skillName;
  }
}

export function createResourceSkillManifest(skillName: ResourceSkillName): SkillManifest {
  const document = readSkillDocument(skillName, true);
  const profile = RESOURCE_SKILL_PROFILES[skillName];
  const skillPath = resourcePath('skills', 'reference', skillName, 'SKILL.md');
  const description = document.compatibility
    ? `${document.description}\n\nCompatibility: ${document.compatibility}`
    : document.description;
  const manifest: SkillManifest = {
    apiVersion: 'agent-skill/v1',
    id: resourceSkillId(skillName),
    name: skillName,
    displayName: skillName,
    version: '1.0.0',
    description,
    descriptionForModel: document.body,
    capabilities: [...profile.capabilities],
    permissions: copyPermissions(profile.permissions),
    lifecycle: { activation: 'on-demand' },
    references: [{ path: skillPath, loadAt: 'activation' }],
  };

  if (document.license !== undefined) {
    manifest.license = document.license;
  }

  return manifest;
}

export function createBuiltinResourceSkillDefs(
  executor: SkillExecutor,
): readonly BuiltinResourceSkillDef[] {
  return INTEGRATED_RESOURCE_SKILL_NAMES.map((skillName) => ({
    manifest: createResourceSkillManifest(skillName),
    executor,
  }));
}

export function createResourceSkillDescriptor(
  skillName: ResourceCatalogSkillName,
): ResourceSkillDescriptor {
  const document = readSkillDocument(skillName);
  const skillPath = resourcePath('skills', 'reference', skillName, 'SKILL.md');
  if (isIntegratedResourceSkillName(skillName)) {
    const profile = RESOURCE_SKILL_PROFILES[skillName];
    return {
      id: resourceSkillId(skillName),
      name: skillName,
      title: skillName,
      description: document.description,
      integration: 'builtin',
      visibility: 'catalog',
      feature: 'skills',
      usageKind: 'skill',
      path: skillPath,
      content: document.body,
      capabilities: [...profile.capabilities],
      permissions: copyPermissions(profile.permissions),
    };
  }

  return {
    id: `resource-reference-skill-${skillName}`,
    name: skillName,
    title: skillName,
    description: document.description,
    integration: 'reference',
    visibility: 'catalog',
    feature: 'skills',
    usageKind: 'skill',
    path: skillPath,
    content: document.body,
    capabilities: [],
    permissions: [],
  };
}

export function listResourceSkillDescriptors(): readonly ResourceSkillDescriptor[] {
  return RESOURCE_SKILL_NAMES.map(createResourceSkillDescriptor);
}

function readSkillDocument(
  skillName: ResourceCatalogSkillName,
  requireMatchingName = false,
): ParsedSkillDocument {
  const source = readTextResource('skills', 'reference', skillName, 'SKILL.md');
  return parseSkillDocument(skillName, source, requireMatchingName);
}

function parseSkillDocument(
  skillName: ResourceCatalogSkillName,
  source: string,
  requireMatchingName: boolean,
): ParsedSkillDocument {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') {
    throw new ResourceSkillManifestError(skillName, 'missing frontmatter');
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingIndex < 0) {
    throw new ResourceSkillManifestError(skillName, 'unterminated frontmatter');
  }

  const fields = parseFrontmatter(lines.slice(1, closingIndex));
  const name = fields.name ?? skillName;
  if (requireMatchingName && name !== skillName) {
    throw new ResourceSkillManifestError(skillName, `frontmatter name must be "${skillName}"`);
  }

  const description = fields.description;
  if (description === undefined || description.length === 0) {
    throw new ResourceSkillManifestError(skillName, 'missing description');
  }

  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .trim();
  if (body.length === 0) {
    throw new ResourceSkillManifestError(skillName, 'empty model instructions');
  }

  return {
    name,
    description,
    body,
    license: fields.license,
    compatibility: fields.compatibility,
  };
}

function isIntegratedResourceSkillName(
  skillName: ResourceCatalogSkillName,
): skillName is ResourceSkillName {
  return INTEGRATED_RESOURCE_SKILL_NAMES.some((integratedName) => integratedName === skillName);
}
