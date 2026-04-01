import { z } from 'zod';
import { validateWorkspacePath } from './workspace-paths.js';

export const TOOL_SURFACE_PROFILES = [
  'openawork',
  'claude_code_simple',
  'claude_code_default',
] as const;
export type ToolSurfaceProfile = (typeof TOOL_SURFACE_PROFILES)[number];

const sessionMetadataPatchSchema = z
  .object({
    dialogueMode: z.enum(['clarify', 'coding', 'programmer']).optional(),
    editSourceMessageId: z.string().min(1).max(200).optional(),
    modelId: z.string().min(1).max(200).optional(),
    parentSessionId: z.string().min(1).max(200).optional(),
    planMode: z.boolean().optional(),
    providerId: z.string().min(1).max(200).optional(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    thinkingEnabled: z.boolean().optional(),
    toolSurfaceProfile: z.enum(TOOL_SURFACE_PROFILES).optional(),
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

export function extractToolSurfaceProfile(metadata: Record<string, unknown>): ToolSurfaceProfile {
  const raw = metadata['toolSurfaceProfile'];
  if (typeof raw === 'string' && (TOOL_SURFACE_PROFILES as readonly string[]).includes(raw)) {
    return raw as ToolSurfaceProfile;
  }
  return 'openawork';
}
