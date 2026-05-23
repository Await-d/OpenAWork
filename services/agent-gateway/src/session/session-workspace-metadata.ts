import { z } from 'zod';
import { TEAM_RUNTIME_LAYER_ORDER, DEFAULT_FIXED_TEAM_MEMBER_SLOTS } from '@openAwork/shared';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { upstreamRetryMaxRetriesSchema } from '../provider/upstream-retry-policy.js';

const specialtyValues = Array.from(
  new Set(DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty)),
) as [string, ...string[]];

const teamMemberSlotSchema = z.object({
  agentId: z.string().min(1).max(200).optional(),
  agentLabel: z.string().min(1).max(200).optional(),
  displayName: z.string().min(1).max(200),
  id: z.string().min(1).max(120),
  layer: z.enum(TEAM_RUNTIME_LAYER_ORDER),
  personaKey: z.string().min(1).max(160),
  required: z.boolean(),
  specialty: z.enum(specialtyValues),
  toolsets: z.array(z.string().min(1).max(80)).max(20),
});

const teamDefinitionSchema = z.object({
  createdAt: z.string().optional(),
  defaultProvider: z.string().nullable().optional(),
  memberSlots: z.array(teamMemberSlotSchema).optional(),
  optionalMembers: z
    .array(
      z.object({
        agentId: z.string().min(1).max(200),
        agentLabel: z.string().min(1).max(200),
        canonicalRole: z.string().min(1).max(120).nullable().optional(),
      }),
    )
    .optional(),
  requiredRoleBindings: z.array(
    z.object({
      agentId: z.string().min(1).max(200),
      agentLabel: z.string().min(1).max(200),
      modelId: z.string().min(1).max(200).optional(),
      providerId: z.string().min(1).max(200).optional(),
      role: z.enum(['leader', 'planner', 'researcher', 'executor', 'reviewer']),
      variant: z.string().min(1).max(80).optional(),
    }),
  ),
  source: z.object({
    kind: z.enum(['blank', 'builtin-template', 'saved-template']),
    templateId: z.string().min(1).max(200).optional(),
    templateName: z.string().min(1).max(200).optional(),
  }),
  /**
   * 起始快捷建议（D 项）：模板内置，向 reception session metadata 透传，
   * 前端 ReceptionStarterCard 渲染为 chip。
   */
  starterSuggestions: z.array(z.string().min(1).max(200)).max(8).optional(),
  version: z.number().int().min(1).optional(),
});

const sessionMetadataPatchSchema = z
  .object({
    agentId: z.string().min(1).max(120).optional(),
    dialogueMode: z.enum(['clarify', 'coding', 'programmer']).optional(),
    editSourceMessageId: z.string().min(1).max(200).optional(),
    imageWorkbench: z.boolean().optional(),
    modelId: z.string().min(1).max(200).optional(),
    parentSessionId: z.string().min(1).max(200).optional(),
    planMode: z.boolean().optional(),
    providerId: z.string().min(1).max(200).optional(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    teamDefinition: teamDefinitionSchema.optional(),
    teamWorkspaceId: z.string().min(1).max(200).optional(),
    thinkingEnabled: z.boolean().optional(),
    upstreamRetryMaxRetries: upstreamRetryMaxRetriesSchema.optional(),
    webSearchEnabled: z.boolean().optional(),
    workingDirectory: z.string().optional(),
    yoloMode: z.boolean().optional(),
  })
  .strict();

export function validateSessionMetadataPatch(metadata: Record<string, unknown>) {
  return sessionMetadataPatchSchema.safeParse(metadata);
}

export function normalizePersistedSessionMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const workingDirectory = metadata['workingDirectory'];
  if (typeof workingDirectory !== 'string') {
    return metadata;
  }

  const safeWorkingDirectory = validateWorkspacePath(workingDirectory);
  if (safeWorkingDirectory === workingDirectory) {
    return metadata;
  }

  const nextMetadata = { ...metadata };
  if (!safeWorkingDirectory) {
    delete nextMetadata['workingDirectory'];
    return nextMetadata;
  }

  nextMetadata['workingDirectory'] = safeWorkingDirectory;
  return nextMetadata;
}

export function sanitizeSessionMetadataJson(metadataJson: string): string {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const normalizedMetadata = normalizePersistedSessionMetadata(metadata);
    return normalizedMetadata === metadata ? metadataJson : JSON.stringify(normalizedMetadata);
  } catch {
    return metadataJson;
  }
}

export function parseSessionMetadataJson(metadataJson: string): Record<string, unknown> {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return normalizePersistedSessionMetadata(metadata);
  } catch {
    return {};
  }
}

export function normalizeIncomingSessionMetadata(metadata: Record<string, unknown>): {
  metadata: Record<string, unknown>;
  workingDirectory?: string | null;
} {
  const workingDirectory = metadata['workingDirectory'];
  if (typeof workingDirectory !== 'string') {
    return { metadata };
  }

  const safeWorkingDirectory = validateWorkspacePath(workingDirectory);
  if (!safeWorkingDirectory) {
    return { metadata, workingDirectory: null };
  }

  if (safeWorkingDirectory === workingDirectory) {
    return { metadata, workingDirectory: safeWorkingDirectory };
  }

  return {
    metadata: { ...metadata, workingDirectory: safeWorkingDirectory },
    workingDirectory: safeWorkingDirectory,
  };
}

export function mergeSessionMetadataForUpdate(
  currentMetadata: Record<string, unknown>,
  patchMetadata: Record<string, unknown>,
): { metadata: Record<string, unknown>; workingDirectory?: string | null } {
  const sanitizedCurrentMetadata = normalizePersistedSessionMetadata(currentMetadata);
  const mergedMetadata = { ...sanitizedCurrentMetadata, ...patchMetadata };
  return normalizeIncomingSessionMetadata(mergedMetadata);
}

export function extractSessionWorkingDirectory(metadata: Record<string, unknown>): string | null {
  const sanitizedMetadata = normalizePersistedSessionMetadata(metadata);
  const workingDirectory = sanitizedMetadata['workingDirectory'];
  return typeof workingDirectory === 'string' ? workingDirectory : null;
}

export function isSessionWorkspaceRebindingAttempt(
  currentMetadata: Record<string, unknown>,
  nextWorkingDirectory: string | null | undefined,
): boolean {
  const currentWorkingDirectory = extractSessionWorkingDirectory(currentMetadata);
  if (!currentWorkingDirectory || nextWorkingDirectory === undefined) {
    return false;
  }

  return currentWorkingDirectory !== nextWorkingDirectory;
}
