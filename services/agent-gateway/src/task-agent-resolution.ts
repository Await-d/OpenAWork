import type { ManagedAgentRecord } from '@openAwork/shared';
import { listManagedAgentsForUser } from './agent-catalog.js';
import {
  getTaskCategoryDescription,
  getTaskCategoryPromptAppend,
} from './task-category-reference-snapshot.js';

const CATEGORY_AGENT_ID = 'sisyphus-junior';

interface RawDelegatedTaskInput {
  category?: string;
  load_skills?: string[];
  subagent_type?: string;
}

export interface ResolvedDelegatedAgent {
  agentId: string;
  category?: string;
  requestedSkills: string[];
  systemPrompt?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeSkills(skills: string[] | undefined): string[] {
  if (!Array.isArray(skills)) {
    return [];
  }

  return Array.from(
    new Set(skills.map((skill) => skill.trim()).filter((skill) => skill.length > 0)),
  );
}

function findManagedAgent(userId: string, identifier: string): ManagedAgentRecord | undefined {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  return listManagedAgentsForUser(userId).find((agent) => {
    if (!agent.enabled) {
      return false;
    }

    if (agent.id.trim().toLowerCase() === normalizedIdentifier) {
      return true;
    }

    if (agent.label.trim().toLowerCase() === normalizedIdentifier) {
      return true;
    }

    return agent.aliases.some((alias) => alias.trim().toLowerCase() === normalizedIdentifier);
  });
}

function buildDelegatedSystemPrompt(input: {
  agentPrompt?: string;
  category?: string;
  requestedSkills: string[];
}): string | undefined {
  const sections: string[] = [];
  const agentPrompt = normalizeOptionalText(input.agentPrompt);
  if (agentPrompt) {
    sections.push(agentPrompt);
  }

  sections.push(
    [
      'Delegation contract:',
      '- You are operating inside a delegated child session created by the task tool.',
      '- Treat the delegated user prompt as the work order for this child session and keep the scope narrow.',
      '- Do not redefine the assignment, broaden it, or hand it back to another child task on your own.',
      '- If you become blocked, explain the blocker with concrete evidence instead of asking the parent to restate the task.',
    ].join('\n'),
  );

  const category = normalizeOptionalText(input.category);
  if (category) {
    const categoryDescription = getTaskCategoryDescription(category);
    const categoryPromptAppend = getTaskCategoryPromptAppend(category);
    sections.push(
      [
        'Execution style:',
        `- Task category: ${category}.`,
        categoryDescription ??
          '- Focus on the requested category and keep the execution style aligned with it.',
        '- Prefer autonomous end-to-end execution over partial handoffs when the delegated goal is achievable inside this child session.',
      ].join(' '),
    );
    if (categoryPromptAppend) {
      sections.push(
        ['Category prompt append (reference-aligned):', categoryPromptAppend].join('\n'),
      );
    }
  }

  if (input.requestedSkills.length > 0) {
    sections.push(
      [
        'Requested skills:',
        `- ${input.requestedSkills.join(', ')}`,
        '- Load and use these skills proactively when they are relevant to the delegated task.',
      ].join('\n'),
    );
  }

  sections.push(
    [
      'Completion requirements:',
      '- Execute the delegated work end-to-end when possible.',
      '- Finish with a concise final summary that states the outcome, the key evidence or files involved, and any remaining blocker or follow-up.',
    ].join('\n'),
  );

  if (sections.length === 0) {
    return undefined;
  }

  return sections.join('\n\n');
}

export function resolveDelegatedAgent(
  userId: string,
  input: RawDelegatedTaskInput,
): ResolvedDelegatedAgent {
  const requestedSkills = normalizeSkills(input.load_skills);
  const category = normalizeOptionalText(input.category);
  const subagentType = normalizeOptionalText(input.subagent_type);

  if (subagentType) {
    const matchedAgent = findManagedAgent(userId, subagentType);
    return {
      agentId: matchedAgent?.id ?? subagentType,
      requestedSkills,
      systemPrompt: buildDelegatedSystemPrompt({
        agentPrompt: matchedAgent?.systemPrompt,
        requestedSkills,
      }),
    };
  }

  const categoryAgent = findManagedAgent(userId, CATEGORY_AGENT_ID);
  return {
    agentId: categoryAgent?.id ?? CATEGORY_AGENT_ID,
    category,
    requestedSkills,
    systemPrompt: buildDelegatedSystemPrompt({
      agentPrompt: categoryAgent?.systemPrompt,
      category,
      requestedSkills,
    }),
  };
}
