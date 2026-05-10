import type { ManagedAgentRecord } from '@openAwork/shared';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { listManagedAgentsForUser } from './agent-catalog.js';
import type { EffectiveSkill } from './skill-selection.js';
import {
  getTaskCategoryDescription,
  getTaskCategoryPromptAppend,
} from './task-category-reference-snapshot.js';
import {
  getReferenceAgentModelCandidates,
  getReferenceAgentModelEntries,
  getReferenceCategoryModelEntries,
  getReferenceCategoryModelCandidates,
  type ReferenceModelEntry,
} from './task-model-reference-snapshot.js';

const CATEGORY_AGENT_ID = 'sisyphus-junior';

interface RawDelegatedTaskInput {
  category?: string;
  load_skills?: string[];
  subagent_type?: string;
}

export interface ResolvedDelegatedAgent {
  agentId: string;
  category?: string;
  modelCandidates: string[];
  modelEntries: ReferenceModelEntry[];
  modelVariant?: string;
  requestedSkills: string[];
  /**
   * Skills the caller requested but that aren't in the parent session's
   * effective skill set (and aren't BUILTIN). Surfaced to caller so it can
   * audit-log the divergence; child session never sees them.
   */
  droppedSkills: string[];
  systemPrompt?: string;
}

export interface ResolveDelegatedAgentOptions {
  /** Effective skill set of the parent session — used to filter `load_skills`. */
  parentEffective?: EffectiveSkill[];
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

/**
 * For requested skills that match oh-my-opencode builtin skills,
 * inject their descriptionForModel content directly into the delegated
 * system prompt so the child session doesn't need to call the skill tool.
 */
function injectBuiltinSkillInstructions(requestedSkills: string[]): string | null {
  const parts: string[] = [];
  for (const skillName of requestedSkills) {
    const normalizedName = skillName.trim().toLowerCase();
    const entry = BUILTIN_SKILLS.find(({ manifest }) =>
      [manifest.id, manifest.name, manifest.displayName]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .some((v) => v.trim().toLowerCase() === normalizedName),
    );
    if (entry?.manifest.descriptionForModel) {
      parts.push(
        `<skill_content name="${entry.manifest.displayName ?? entry.manifest.name ?? skillName}">`,
        entry.manifest.descriptionForModel,
        '</skill_content>',
      );
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
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

function normalizeModelCandidate(value: string): string {
  return value.includes('/') ? (value.split('/').at(-1) ?? value) : value;
}

function getManagedAgentModelCandidates(agent: ManagedAgentRecord | undefined): string[] {
  if (!agent) {
    return [];
  }
  return Array.from(
    new Set(
      [agent.model, ...(agent.fallbackModels ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => normalizeModelCandidate(value.trim())),
    ),
  );
}

function getManagedAgentModelEntries(agent: ManagedAgentRecord | undefined): ReferenceModelEntry[] {
  if (!agent) {
    return [];
  }
  return getManagedAgentModelCandidates(agent).map((modelId) => ({
    modelId,
    providerHints: [],
    variant: agent.variant,
  }));
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
    const skillInstructions = injectBuiltinSkillInstructions(input.requestedSkills);
    sections.push(
      [
        'Requested skills:',
        `- ${input.requestedSkills.join(', ')}`,
        '- Load and use these skills proactively when they are relevant to the delegated task.',
        ...(skillInstructions ? ['', skillInstructions] : []),
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

/**
 * Drop requested skills that aren't allowed by the parent session's effective
 * set. BUILTIN skills bypass the filter so they remain delegate-friendly even
 * when the parent has a narrow workspace selection. Returns the kept list and
 * the dropped names; callers can audit-log the dropped portion.
 */
function filterRequestedSkillsByEffective(
  requested: string[],
  parentEffective: EffectiveSkill[] | undefined,
): { kept: string[]; dropped: string[] } {
  if (!parentEffective || parentEffective.length === 0 || requested.length === 0) {
    return { kept: requested, dropped: [] };
  }
  const allowed = new Set<string>();
  for (const entry of parentEffective) {
    if (!entry.enabled) continue;
    const candidates = [
      entry.skillId,
      entry.manifest?.id,
      entry.manifest?.name,
      entry.manifest?.displayName,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        allowed.add(candidate.trim().toLowerCase());
      }
    }
  }
  // BUILTIN names are always allowed.
  for (const { manifest } of BUILTIN_SKILLS) {
    for (const candidate of [manifest.id, manifest.name, manifest.displayName]) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        allowed.add(candidate.trim().toLowerCase());
      }
    }
  }
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const skill of requested) {
    if (allowed.has(skill.trim().toLowerCase())) {
      kept.push(skill);
    } else {
      dropped.push(skill);
    }
  }
  return { kept, dropped };
}

export function resolveDelegatedAgent(
  userId: string,
  input: RawDelegatedTaskInput,
  options: ResolveDelegatedAgentOptions = {},
): ResolvedDelegatedAgent {
  const allRequested = normalizeSkills(input.load_skills);
  const { kept: requestedSkills, dropped: droppedSkills } = filterRequestedSkillsByEffective(
    allRequested,
    options.parentEffective,
  );
  const category = normalizeOptionalText(input.category);
  const subagentType = normalizeOptionalText(input.subagent_type);

  if (subagentType) {
    const matchedAgent = findManagedAgent(userId, subagentType);
    const agentId = matchedAgent?.id ?? subagentType;
    const managedModelCandidates = getManagedAgentModelCandidates(matchedAgent);
    const managedModelEntries = getManagedAgentModelEntries(matchedAgent);
    const referenceModelEntries = getReferenceAgentModelEntries(agentId);
    return {
      agentId,
      modelCandidates:
        managedModelCandidates.length > 0
          ? managedModelCandidates
          : getReferenceAgentModelCandidates(agentId),
      modelEntries: managedModelEntries.length > 0 ? managedModelEntries : referenceModelEntries,
      modelVariant: matchedAgent?.variant,
      requestedSkills,
      droppedSkills,
      systemPrompt: buildDelegatedSystemPrompt({
        agentPrompt: matchedAgent?.systemPrompt,
        requestedSkills,
      }),
    };
  }

  const categoryAgent = findManagedAgent(userId, CATEGORY_AGENT_ID);
  const categoryManagedEntries = getManagedAgentModelEntries(categoryAgent);
  const categoryReferenceEntries = getReferenceCategoryModelEntries(category);
  return {
    agentId: categoryAgent?.id ?? CATEGORY_AGENT_ID,
    category,
    modelCandidates:
      getManagedAgentModelCandidates(categoryAgent).length > 0
        ? getManagedAgentModelCandidates(categoryAgent)
        : getReferenceCategoryModelCandidates(category),
    modelEntries:
      categoryManagedEntries.length > 0 ? categoryManagedEntries : categoryReferenceEntries,
    modelVariant: categoryAgent?.variant,
    requestedSkills,
    droppedSkills,
    systemPrompt: buildDelegatedSystemPrompt({
      agentPrompt: categoryAgent?.systemPrompt,
      category,
      requestedSkills,
    }),
  };
}
