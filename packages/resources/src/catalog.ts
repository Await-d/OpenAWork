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

export const RESOURCE_SKILL_NAMES = [
  ...INTEGRATED_RESOURCE_SKILL_NAMES,
  ...REFERENCE_ONLY_SKILL_NAMES,
] as const;

export type ResourceCatalogSkillName = (typeof RESOURCE_SKILL_NAMES)[number];

export const INTEGRATED_RESOURCE_AGENT_NAMES = [
  'api-designer',
  'architect-reviewer',
  'code-reviewer',
  'copywriter',
  'data-analyst',
  'debugger',
  'frontend-developer',
  'fullstack-developer',
  'meeting-summarizer',
  'performance-engineer',
  'refactor-expert',
  'security-auditor',
  'test-automator',
  'translator',
] as const;

export type IntegratedResourceAgentName = (typeof INTEGRATED_RESOURCE_AGENT_NAMES)[number];

export const REFERENCE_ONLY_RESOURCE_AGENT_NAMES = ['cron-agent'] as const;

export type ReferenceOnlyResourceAgentName = (typeof REFERENCE_ONLY_RESOURCE_AGENT_NAMES)[number];

export const RESOURCE_AGENT_TEMPLATE_NAMES = ['AGENTS', 'MEMORY', 'SOUL', 'USER'] as const;

export type ResourceAgentTemplateName = (typeof RESOURCE_AGENT_TEMPLATE_NAMES)[number];

export const RESOURCE_AGENT_NAMES = [
  ...INTEGRATED_RESOURCE_AGENT_NAMES,
  ...REFERENCE_ONLY_RESOURCE_AGENT_NAMES,
] as const;

export type ResourceAgentName = (typeof RESOURCE_AGENT_NAMES)[number];

export const RESOURCE_SOUL_NAMES = [
  'balanced-collaborator',
  'daily-life-assistant',
  'emotionally-attuned-companion',
  'product-strategy-operator',
  'research-writing-strategist',
  'senior-engineering-partner',
] as const;

export type ResourceSoulName = (typeof RESOURCE_SOUL_NAMES)[number];

export const RESOURCE_COMMAND_NAMES = [
  'agents',
  'commit',
  'init',
  'plan',
  'review',
  'security-review',
] as const;

export type ResourceCommandName = (typeof RESOURCE_COMMAND_NAMES)[number];

export const RESOURCE_PROMPT_NAMES = ['codex-instructions'] as const;

export type ResourcePromptName = (typeof RESOURCE_PROMPT_NAMES)[number];

export const RESOURCE_EXTENSION_NAMES = ['my-coffee'] as const;

export type ResourceExtensionName = (typeof RESOURCE_EXTENSION_NAMES)[number];

export type ResourceIntegrationMode = 'builtin' | 'reference';

export type ResourceVisibility = 'catalog' | 'feature';

export const RESOURCE_FEATURES = [
  'agents',
  'channels',
  'commands',
  'extensions',
  'mcps',
  'prompts',
  'skills',
  'team',
] as const satisfies readonly ResourceFeature[];

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

export interface ResourceCommandProfile {
  readonly description: string;
  readonly integration: ResourceIntegrationMode;
}

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

export const RESOURCE_COMMAND_PROFILES = {
  agents: {
    description: '用户自定义 agent 文件模板；系统仅作为参考资源，不直接写用户目录。',
    integration: 'reference',
  },
  commit: {
    description: 'Conventional Commits 分组提交流程；涉及 git 写入，OpenAWork 保持为参考模板。',
    integration: 'reference',
  },
  init: {
    description: '生成仓库 AGENTS.md 指南的模板；OpenAWork 已有 /init-deep，保留为参考。',
    integration: 'reference',
  },
  plan: {
    description: 'Plan Mode 模板；OpenAWork 使用既有规划/工作流入口，保留为参考。',
    integration: 'reference',
  },
  review: {
    description: '未提交改动代码审查模板；OpenAWork 已有 review-work skill，保留为参考。',
    integration: 'reference',
  },
  'security-review': {
    description: '未提交改动安全审查模板；OpenAWork 已有安全审查能力，保留为参考。',
    integration: 'reference',
  },
} satisfies Record<ResourceCommandName, ResourceCommandProfile>;

export function resourceSkillId(skillName: ResourceSkillName): string {
  return `com.openAwork.resource.${skillName}`;
}

export function resourceAgentId(agentName: IntegratedResourceAgentName): string {
  return `resource-${agentName}`;
}

export function copyPermissions(
  permissions: readonly SkillPermission[],
): SkillManifest['permissions'] {
  return permissions.map((permission) => ({ ...permission }));
}
