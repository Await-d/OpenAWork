import type { SkillManifest, SkillPermission } from '@openAwork/skill-types';

export const RESOURCE_AREAS = [
  'skills',
  'agents',
  'souls',
  'commands',
  'prompts',
  'workflows',
  'extensions',
] as const;

export type ResourceArea = (typeof RESOURCE_AREAS)[number];

export const INTEGRATED_RESOURCE_SKILL_NAMES = [
  'csv-pipeline',
  'docx',
  'email-drafter',
  'excel-processor',
  'image-ocr',
  'pdf',
  'product-design',
  'web-scraper',
  'xlsx',
] as const;

export type ResourceSkillName = (typeof INTEGRATED_RESOURCE_SKILL_NAMES)[number];

export const REFERENCE_ONLY_SKILL_NAMES = [
  'create-extension',
  'frontend-skill',
  'post-to-x',
] as const;

export type ReferenceOnlySkillName = (typeof REFERENCE_ONLY_SKILL_NAMES)[number];

export interface ResourceSkillProfile {
  readonly capabilities: readonly string[];
  readonly permissions: readonly SkillPermission[];
}

const filesystemOptional = [
  { type: 'filesystem', scope: '**', required: false },
] satisfies readonly SkillPermission[];

const networkOptional = [
  { type: 'network', scope: '*', required: false },
] satisfies readonly SkillPermission[];

const filesystemAndNetworkOptional = [
  ...filesystemOptional,
  ...networkOptional,
] satisfies readonly SkillPermission[];

export const RESOURCE_SKILL_PROFILES = {
  'csv-pipeline': {
    capabilities: ['data.csv', 'data.json', 'data.transform', 'data.reporting'],
    permissions: filesystemOptional,
  },
  docx: {
    capabilities: ['document.docx', 'document.extract', 'document.edit', 'document.format'],
    permissions: filesystemOptional,
  },
  'email-drafter': {
    capabilities: ['writing.email', 'writing.business', 'template.generation'],
    permissions: filesystemOptional,
  },
  'excel-processor': {
    capabilities: ['spreadsheet.xlsx', 'spreadsheet.analysis', 'spreadsheet.formatting'],
    permissions: filesystemOptional,
  },
  'image-ocr': {
    capabilities: ['image.ocr', 'document.extract', 'vision.text'],
    permissions: filesystemOptional,
  },
  pdf: {
    capabilities: ['document.pdf', 'document.extract', 'document.forms', 'document.generate'],
    permissions: filesystemOptional,
  },
  'product-design': {
    capabilities: ['product.design', 'design.audit', 'prototype.workflow', 'research.synthesis'],
    permissions: filesystemAndNetworkOptional,
  },
  'web-scraper': {
    capabilities: ['web.fetch', 'web.search', 'web.scrape', 'web.extract'],
    permissions: filesystemAndNetworkOptional,
  },
  xlsx: {
    capabilities: ['spreadsheet.xlsx', 'spreadsheet.formulas', 'spreadsheet.visualization'],
    permissions: filesystemOptional,
  },
} satisfies Record<ResourceSkillName, ResourceSkillProfile>;

export function resourceSkillId(skillName: ResourceSkillName): string {
  return `com.openAwork.resource.${skillName}`;
}

export function copyPermissions(
  permissions: readonly SkillPermission[],
): SkillManifest['permissions'] {
  return permissions.map((permission) => ({ ...permission }));
}
