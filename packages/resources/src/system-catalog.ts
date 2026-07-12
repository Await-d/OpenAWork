import type { SkillPermission } from '@openAwork/skill-types';

export const SYSTEM_BUILTIN_AGENT_NAMES = [
  'build',
  'plan',
  'general',
  'explore',
  'sisyphus',
  'hephaestus',
  'prometheus',
  'oracle',
  'zeus',
  'librarian',
  'metis',
  'momus',
  'atlas',
  'multimodal-looker',
  'sisyphus-junior',
  'scout',
] as const;

export type SystemBuiltinAgentName = (typeof SYSTEM_BUILTIN_AGENT_NAMES)[number];

export const SYSTEM_BUILTIN_SKILL_NAMES = [
  'git-master',
  'review-work',
  'programming',
  'frontend',
  'visual-qa',
  'lsp',
  'ast-grep',
  'rules',
] as const;

export type SystemBuiltinSkillName = (typeof SYSTEM_BUILTIN_SKILL_NAMES)[number];

export const SYSTEM_BUILTIN_COMMAND_IDS = [
  'slash-compact',
  'slash-summarize',
  'slash-handoff',
  'slash-buddy',
  'nav-chat',
  'nav-sessions',
  'nav-settings',
  'toggle-theme',
  'slash-init-deep',
  'slash-ralph-loop',
  'slash-ulw-loop',
  'slash-ulw-verify',
  'slash-cancel-ralph',
  'slash-stop-continuation',
  'slash-refactor',
  'slash-remove-deadcode',
  'slash-start-work',
  'slash-start-work-done',
  'slash-start-work-review',
] as const;

export type SystemBuiltinCommandId = (typeof SYSTEM_BUILTIN_COMMAND_IDS)[number];

export const SYSTEM_BUILTIN_MCP_IDS = [
  'open_websearch',
  'websearch',
  'grep_app',
  'codegraph',
  'git_bash',
  'lsp',
  'omo',
] as const;

export type SystemBuiltinMcpId = (typeof SYSTEM_BUILTIN_MCP_IDS)[number];

export interface SystemBuiltinSkillProfile {
  readonly capabilities: readonly string[];
  readonly permissions: readonly SkillPermission[];
}

const filesystemRequired = [
  { type: 'filesystem', scope: '**', required: true },
] satisfies readonly SkillPermission[];

const filesystemOptional = [
  { type: 'filesystem', scope: '**', required: false },
] satisfies readonly SkillPermission[];

export const SYSTEM_BUILTIN_SKILL_PROFILES = {
  'git-master': {
    capabilities: ['git.commit', 'git.rebase', 'git.history', 'git.bisect', 'git.blame'],
    permissions: filesystemRequired,
  },
  'review-work': {
    capabilities: ['review.goal', 'review.code-quality', 'review.security', 'review.qa'],
    permissions: filesystemOptional,
  },
  programming: {
    capabilities: ['code.implementation', 'code.type-safety', 'code.testing'],
    permissions: filesystemOptional,
  },
  frontend: {
    capabilities: ['frontend.react', 'frontend.design-system', 'frontend.accessibility'],
    permissions: filesystemOptional,
  },
  'visual-qa': {
    capabilities: ['qa.visual', 'qa.responsive', 'qa.accessibility'],
    permissions: filesystemOptional,
  },
  lsp: {
    capabilities: ['lsp.diagnostics', 'lsp.references', 'lsp.rename'],
    permissions: filesystemOptional,
  },
  'ast-grep': {
    capabilities: ['code.ast-search', 'code.codemod'],
    permissions: filesystemOptional,
  },
  rules: {
    capabilities: ['rules.discovery', 'rules.compliance'],
    permissions: filesystemOptional,
  },
} satisfies Record<SystemBuiltinSkillName, SystemBuiltinSkillProfile>;

export function systemBuiltinSkillId(skillName: SystemBuiltinSkillName): string {
  return `com.openAwork.builtin.${skillName}`;
}
