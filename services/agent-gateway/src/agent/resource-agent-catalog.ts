import {
  listIntegratedResourceAgents,
  type ResourceAgentDescriptor,
} from '@openAwork/resources/node';
import type { CanonicalRoleDescriptor } from '@openAwork/shared';

interface ResourceAgentRoleMetadata {
  readonly aliases: readonly string[];
  readonly canonicalRole: CanonicalRoleDescriptor;
}

const RESOURCE_AGENT_ROLE_METADATA: Readonly<Record<string, ResourceAgentRoleMetadata>> = {
  'resource-api-designer': {
    aliases: ['api-designer', 'api-architect'],
    canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
  },
  'resource-architect-reviewer': {
    aliases: ['architect-reviewer', 'architecture-reviewer'],
    canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'high' },
  },
  'resource-code-reviewer': {
    aliases: ['code-reviewer', 'reviewer'],
    canonicalRole: { coreRole: 'reviewer', preset: 'code-review', confidence: 'high' },
  },
  'resource-copywriter': {
    aliases: ['copywriter', 'writer'],
    canonicalRole: {
      coreRole: 'general',
      preset: 'default',
      overlays: ['writer'],
      confidence: 'medium',
    },
  },
  'resource-data-analyst': {
    aliases: ['data-analyst', 'analyst'],
    canonicalRole: { coreRole: 'researcher', preset: 'analyst', confidence: 'high' },
  },
  'resource-debugger': {
    aliases: ['debugger', 'bug-fixer'],
    canonicalRole: { coreRole: 'executor', preset: 'debugger', confidence: 'high' },
  },
  'resource-frontend-developer': {
    aliases: ['frontend-developer', 'frontend'],
    canonicalRole: { coreRole: 'executor', preset: 'default', confidence: 'medium' },
  },
  'resource-fullstack-developer': {
    aliases: ['fullstack-developer', 'fullstack'],
    canonicalRole: { coreRole: 'executor', preset: 'default', confidence: 'medium' },
  },
  'resource-meeting-summarizer': {
    aliases: ['meeting-summarizer', 'minutes-writer'],
    canonicalRole: {
      coreRole: 'general',
      preset: 'default',
      overlays: ['writer'],
      confidence: 'medium',
    },
  },
  'resource-performance-engineer': {
    aliases: ['performance-engineer', 'perf-engineer'],
    canonicalRole: { coreRole: 'reviewer', preset: 'verifier', confidence: 'medium' },
  },
  'resource-refactor-expert': {
    aliases: ['refactor-expert', 'refactorer'],
    canonicalRole: { coreRole: 'executor', preset: 'default', confidence: 'medium' },
  },
  'resource-security-auditor': {
    aliases: ['security-auditor', 'security-reviewer'],
    canonicalRole: { coreRole: 'reviewer', preset: 'code-review', confidence: 'medium' },
  },
  'resource-test-automator': {
    aliases: ['test-automator', 'tester'],
    canonicalRole: { coreRole: 'reviewer', preset: 'test', confidence: 'high' },
  },
  'resource-translator': {
    aliases: ['translator', 'localizer'],
    canonicalRole: {
      coreRole: 'general',
      preset: 'default',
      overlays: ['writer'],
      confidence: 'medium',
    },
  },
};

export const RESOURCE_BUILTIN_AGENTS = listIntegratedResourceAgents();

export const RESOURCE_BUILTIN_AGENT_MAP: ReadonlyMap<string, ResourceAgentDescriptor> = new Map(
  RESOURCE_BUILTIN_AGENTS.map((agent) => [agent.id, agent]),
);

export function getResourceAgentRoleMetadata(
  agentId: string,
): ResourceAgentRoleMetadata | undefined {
  return RESOURCE_AGENT_ROLE_METADATA[agentId];
}
