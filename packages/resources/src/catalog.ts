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
  'algorithmic-art',
  'brand-guidelines',
  'canvas-design',
  'csv-pipeline',
  'doc-coauthoring',
  'docx',
  'email-drafter',
  'excel-processor',
  'frontend-design',
  'image-ocr',
  'pdf',
  'pptx',
  'product-design',
  'skill-creator',
  'slack-gif-creator',
  'theme-factory',
  'web-artifacts-builder',
  'web-scraper',
  'webapp-testing',
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

export interface ResourceSoulProfile {
  readonly title: string;
  readonly description: string;
}

export const RESOURCE_SOUL_PROFILES = {
  'balanced-collaborator': {
    title: '稳健协作者',
    description: '适合日常工作、混合咨询和通道自动回复的稳健默认人格。',
  },
  'daily-life-assistant': {
    title: '日常生活助手',
    description: '适合计划、提醒、生活决策、学习和个人组织的实用助手人格。',
  },
  'emotionally-attuned-companion': {
    title: '情绪陪伴者',
    description: '适合反思对话、关系措辞和困难时刻支持的细腻陪伴人格。',
  },
  'product-strategy-operator': {
    title: '产品策略操盘手',
    description: '适合优先级、用户体验取舍、上线规划和运营判断的产品人格。',
  },
  'research-writing-strategist': {
    title: '研究写作策略师',
    description: '适合资料综合、写作计划、编辑润色和论证质量把关的研究人格。',
  },
  'senior-engineering-partner': {
    title: '资深工程伙伴',
    description: '适合读代码、改代码、调试、评审和技术决策的工程协作人格。',
  },
} satisfies Record<ResourceSoulName, ResourceSoulProfile>;

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
  'algorithmic-art': {
    capabilities: ['creative.algorithmic-art', 'creative.p5js', 'creative.generative'],
    permissions: filesystemOptional,
  },
  'brand-guidelines': {
    capabilities: ['design.brand', 'design.typography', 'design.colors'],
    permissions: filesystemOptional,
  },
  'canvas-design': {
    capabilities: ['design.canvas', 'design.philosophy', 'creative.visual'],
    permissions: filesystemOptional,
  },
  'csv-pipeline': {
    capabilities: ['data.csv', 'data.json', 'data.transform', 'data.reporting'],
    permissions: filesystemOptional,
  },
  'doc-coauthoring': {
    capabilities: ['writing.coauthoring', 'writing.documentation', 'writing.specs'],
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
  'frontend-design': {
    capabilities: ['design.frontend', 'design.ui', 'design.typography'],
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
  pptx: {
    capabilities: ['document.pptx', 'document.presentation', 'document.edit'],
    permissions: filesystemOptional,
  },
  'product-design': {
    capabilities: ['product.design', 'design.audit', 'prototype.workflow', 'research.synthesis'],
    permissions: filesystemAndNetworkOptional,
  },
  'skill-creator': {
    capabilities: ['meta.skill-creator', 'meta.evaluation', 'meta.benchmarking'],
    permissions: filesystemOptional,
  },
  'slack-gif-creator': {
    capabilities: ['creative.gif', 'creative.animation', 'creative.slack'],
    permissions: filesystemOptional,
  },
  'theme-factory': {
    capabilities: ['design.theme', 'design.styling', 'design.color-palette'],
    permissions: filesystemOptional,
  },
  'web-artifacts-builder': {
    capabilities: ['frontend.artifacts', 'frontend.react', 'frontend.bundling'],
    permissions: filesystemOptional,
  },
  'web-scraper': {
    capabilities: ['web.fetch', 'web.search', 'web.scrape', 'web.extract'],
    permissions: filesystemAndNetworkOptional,
  },
  'webapp-testing': {
    capabilities: ['qa.webapp', 'qa.playwright', 'qa.automation'],
    permissions: filesystemOptional,
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
