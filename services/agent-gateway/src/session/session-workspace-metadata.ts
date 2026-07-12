import { z } from 'zod';
import { TEAM_RUNTIME_LAYER_ORDER, DEFAULT_FIXED_TEAM_MEMBER_SLOTS } from '@openAwork/shared';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { upstreamRetryMaxRetriesSchema } from '../provider/upstream-retry-policy.js';

const specialtyValues = Array.from(
  new Set([...DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty), 'custom']),
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
  // 可选的 per-member 模型绑定（智能分配模型功能写入；老数据无此字段）。
  providerId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(200).optional(),
  variant: z.string().min(1).max(80).optional(),
  thinkingEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  // 自定义角色字段（specialty === 'custom'）。
  custom: z.boolean().optional(),
  systemPrompt: z.string().max(8000).optional(),
  // 模板初始能力绑定（skills / mcp）。
  skillIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  mcpServerIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 路由关键词（让上游派发动态识别该成员擅长什么；自定义角色尤其需要）。
  routingKeywords: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 派发优先级（同分排序权重）。
  dispatchPriority: z.enum(['high', 'normal', 'low']).optional(),
});

const teamDefinitionSchema = z.object({
  createdAt: z.string().optional(),
  defaultProvider: z.string().nullable().optional(),
  memberSlots: z.array(teamMemberSlotSchema).max(40).optional(),
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

// ─── teamInit：团队会话「初始化阶段」标记（与 @openAwork/shared 的 TeamInitState 同构）──
const teamInitStepSchema = z.object({
  key: z.enum([
    'scan-shared-record',
    'read-project-level1',
    'extract-project-memory',
    'understand-architecture',
    'bind-tools-per-layer',
    'scaffold-memory',
  ]),
  title: z.string().min(1).max(200),
  description: z.string().max(500),
  status: z.enum([
    'proposed',
    'confirmed',
    'running',
    'done',
    'skipped',
    'failed',
    'not_applicable',
  ]),
  requiresConfirm: z.boolean(),
  usesLlm: z.boolean(),
  result: z.record(z.unknown()).nullable().optional(),
  error: z.string().max(2000).nullable().optional(),
  confirmedAt: z.string().max(40).nullable().optional(),
  completedAt: z.string().max(40).nullable().optional(),
});

const teamInitLayerBindingSchema = z.object({
  skillIds: z.array(z.string().min(1).max(160)).max(50),
  mcpServerIds: z.array(z.string().min(1).max(160)).max(50),
  rationale: z.string().max(1000).nullable().optional(),
  boundAt: z.string().max(40).nullable().optional(),
});

const teamInitStateSchema = z.object({
  version: z.number().int().min(1),
  phase: z.enum(['proposed', 'in_progress', 'completed', 'skipped']),
  projectKind: z.enum(['empty', 'existing', 'unknown']),
  detectedAt: z.string().max(40).nullable().optional(),
  steps: z.array(teamInitStepSchema).max(20),
  bindings: z.object({
    perLayer: z.record(z.string(), teamInitLayerBindingSchema).optional(),
    architectureSummary: z.string().max(20000).nullable().optional(),
    projectMemoryDigest: z.string().max(20000).nullable().optional(),
  }),
});

const teamRoleInstanceSchema = z.object({
  rootSessionId: z.string().min(1).max(200),
  roleLayer: z.enum(['user', ...TEAM_RUNTIME_LAYER_ORDER]),
  personaKey: z.string().min(1).max(160).nullable().optional(),
  displayName: z.string().min(1).max(200).nullable().optional(),
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
    reasoningEffort: z
      .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
      .optional(),
    teamDefinition: teamDefinitionSchema.optional(),
    teamInit: teamInitStateSchema.optional(),
    teamRoleInstance: teamRoleInstanceSchema.optional(),
    teamWorkspaceId: z.string().min(1).max(200).optional(),
    thinkingEnabled: z.boolean().optional(),
    upstreamRetryMaxRetries: upstreamRetryMaxRetriesSchema.optional(),
    variant: z.string().min(1).max(80).optional(),
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
