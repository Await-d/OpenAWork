import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SkillExecutor, SkillManifest } from '@openAwork/skill-types';
import {
  INTEGRATED_RESOURCE_SKILL_NAMES,
  RESOURCE_SKILL_PROFILES,
  copyPermissions,
  resourceSkillId,
  type ResourceSkillName,
} from './catalog.js';

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

export class ResourceSkillManifestError extends Error {
  readonly skillName: ResourceSkillName;

  constructor(skillName: ResourceSkillName, message: string) {
    super(`Invalid resource skill "${skillName}": ${message}`);
    this.name = 'ResourceSkillManifestError';
    this.skillName = skillName;
  }
}

const resourcesRootUrl = new URL('../resources/', import.meta.url);

export function resourcePath(...segments: readonly string[]): string {
  return fileURLToPath(resourceUrl(...segments));
}

export function resourceUrl(...segments: readonly string[]): URL {
  const relativePath = segments.join('/');
  return new URL(relativePath, resourcesRootUrl);
}

export function createResourceSkillManifest(skillName: ResourceSkillName): SkillManifest {
  const document = readSkillDocument(skillName);
  const profile = RESOURCE_SKILL_PROFILES[skillName];
  const skillPath = resourcePath('skills', skillName, 'SKILL.md');
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

function readSkillDocument(skillName: ResourceSkillName): ParsedSkillDocument {
  const skillDocumentPath = resourcePath('skills', skillName, 'SKILL.md');
  const source = readFileSync(skillDocumentPath, 'utf8');
  return parseSkillDocument(skillName, source);
}

function parseSkillDocument(skillName: ResourceSkillName, source: string): ParsedSkillDocument {
  const normalizedSource = source.replace(/\r\n/g, '\n');
  const lines = normalizedSource.split('\n');

  if (lines[0] !== '---') {
    throw new ResourceSkillManifestError(skillName, 'missing frontmatter');
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingIndex < 0) {
    throw new ResourceSkillManifestError(skillName, 'unterminated frontmatter');
  }

  const fields = parseFrontmatter(lines.slice(1, closingIndex));
  const name = fields.name;
  if (name !== skillName) {
    throw new ResourceSkillManifestError(skillName, `frontmatter name must be "${skillName}"`);
  }

  const description = fields.description;
  if (description === undefined || description.length === 0) {
    throw new ResourceSkillManifestError(skillName, 'missing description');
  }

  const body = lines.slice(closingIndex + 1).join('\n').trim();
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

function parseFrontmatter(lines: readonly string[]): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripYamlScalar(line.slice(separatorIndex + 1));
    fields[key] = value;
  }
  return fields;
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === "'" || first === '"') && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
