import { z } from 'zod';

export const MEMORY_TYPES = [
  'preference',
  'fact',
  'instruction',
  'project_context',
  'learned_pattern',
] as const;

export const MEMORY_SOURCES = ['manual', 'auto_extracted', 'api'] as const;
export const MEMORY_ROLE_LAYERS = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'] as const;

export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export const memorySourceSchema = z.enum(MEMORY_SOURCES);
export const memoryRoleLayerSchema = z.enum(MEMORY_ROLE_LAYERS);
export const memoryRoleLayersSchema = z.array(memoryRoleLayerSchema).max(5);

export const createMemorySchema = z.object({
  type: memoryTypeSchema,
  key: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(4000),
  source: memorySourceSchema.optional().default('manual'),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  priority: z.number().int().min(0).max(100).optional().default(50),
  workspaceRoot: z.string().trim().max(500).nullable().optional().default(null),
  teamWorkspaceId: z.string().trim().max(200).nullable().optional().default(null),
  roleLayers: memoryRoleLayersSchema.nullable().optional().default(null),
});

export const updateMemorySchema = z.object({
  type: memoryTypeSchema.optional(),
  key: z.string().trim().min(1).max(200).optional(),
  value: z.string().trim().min(1).max(4000).optional(),
  source: memorySourceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  workspaceRoot: z.string().trim().max(500).nullable().optional(),
  teamWorkspaceId: z.string().trim().max(200).nullable().optional(),
  roleLayers: memoryRoleLayersSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});

export const memoryListQuerySchema = z.object({
  type: memoryTypeSchema.optional(),
  source: memorySourceSchema.optional(),
  workspaceRoot: z.string().trim().max(500).nullable().optional(),
  teamWorkspaceId: z.string().trim().max(200).nullable().optional(),
  roleLayer: memoryRoleLayerSchema.optional(),
  enabled: z
    .preprocess((v) => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return v;
    }, z.boolean())
    .optional(),
  search: z.string().trim().max(200).optional(),
  limit: z
    .preprocess((v) => {
      if (typeof v === 'string') return Number(v);
      return v;
    }, z.number().int().min(1).max(200))
    .optional()
    .default(100),
  offset: z
    .preprocess((v) => {
      if (typeof v === 'string') return Number(v);
      return v;
    }, z.number().int().min(0))
    .optional()
    .default(0),
});

export const memorySettingsSchema = z.object({
  enabled: z.boolean(),
  autoExtract: z.boolean(),
  maxTokenBudget: z.number().int().min(100).max(10000),
  minConfidence: z.number().min(0).max(1),
  autoWriteMinConfidence: z.number().min(0).max(1),
  reviewLowConfidence: z.boolean(),
  semanticMaintenance: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// 记忆治理 schema（261101-记忆确认写入与周期整理）
// ---------------------------------------------------------------------------

export const MEMORY_SCOPE_TYPES = ['user', 'workspace', 'team', 'channel_chat'] as const;
export const MEMORY_PROPOSAL_ACTIONS = [
  'create',
  'update',
  'archive',
  'restore',
  'merge',
  'rule',
] as const;
export const MEMORY_PROPOSAL_STATUSES = [
  'pending',
  'applied',
  'rejected',
  'expired',
  'conflicted',
  'cancelled',
] as const;
export const MEMORY_PROPOSAL_ORIGINS = [
  'auto_extract',
  'manual_extract',
  'tool',
  'team_init',
  'maintenance',
  'channel',
  'api',
] as const;

export const memoryScopeTypeSchema = z.enum(MEMORY_SCOPE_TYPES);

export const memoryScopeSchema = z.object({
  type: memoryScopeTypeSchema,
  id: z.string().trim().min(1).max(500),
});

export const memoryProposalActionSchema = z.enum(MEMORY_PROPOSAL_ACTIONS);

export const memoryProposalPayloadSchema = z
  .object({
    type: memoryTypeSchema.optional(),
    key: z.string().trim().min(1).max(200).optional(),
    value: z.string().trim().min(1).max(4000).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    confidence: z.number().min(0).max(1).optional(),
    roleLayers: memoryRoleLayersSchema.nullable().optional(),
    workspaceRoot: z.string().trim().max(500).nullable().optional(),
    teamWorkspaceId: z.string().trim().max(200).nullable().optional(),
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(8000).optional(),
    ruleId: z.string().trim().min(1).max(200).optional(),
    ruleRevision: z.number().int().min(0).optional(),
    mergeIntoId: z.string().trim().min(1).max(200).optional(),
    dependencies: z
      .array(
        z
          .object({ memoryId: z.string().min(1).max(200), revision: z.number().int().min(1) })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export const memorySourceProvenanceSchema = z
  .object({
    platform: z.string().trim().min(1).max(64),
    channelInstanceId: z.string().trim().min(1).max(200),
    chatId: z.string().trim().min(1).max(200),
    chatType: z.enum(['private', 'group', 'unknown']),
    senderId: z.string().trim().max(200).nullable().default(null),
    senderName: z.string().trim().max(200).nullable().default(null),
    platformMessageId: z.string().trim().max(200).nullable().default(null),
  })
  .strict();

/**
 * 提议创建 schema。
 *
 * `origin` 由服务端按调用路径决定，客户端不得自报；因此这里不接收该字段。
 * `payload` 的内容合法性（安全扫描、临时语义过滤）在服务端统一判定。
 */
export const createMemoryProposalSchema = z
  .object({
    action: memoryProposalActionSchema,
    scope: memoryScopeSchema,
    targetMemoryId: z.string().trim().min(1).max(200).optional(),
    expectedRevision: z.number().int().min(1).optional(),
    payload: memoryProposalPayloadSchema,
    reason: z.string().trim().max(500).optional(),
    provenance: memorySourceProvenanceSchema.optional(),
  })
  .strict();

export const memoryProposalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    /** 「修改后保存」：覆盖载荷后重新生成版本与摘要，确认的是新内容。 */
    payload: memoryProposalPayloadSchema.optional(),
    note: z.string().trim().max(500).optional(),
    expectedRevision: z.number().int().min(1).optional(),
    /** 「保留原状」：记录决定并抑制同内容重复建议。 */
    keepOriginal: z.boolean().optional(),
  })
  .strict();

export const memoryRuleDraftSchema = z
  .object({
    scope: memoryScopeSchema,
    name: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(8000),
    expectedRevision: z.number().int().min(0).optional(),
  })
  .strict();

export const DEFAULT_MEMORY_SETTINGS = {
  enabled: true,
  autoExtract: true,
  maxTokenBudget: 2000,
  minConfidence: 0.3,
  autoWriteMinConfidence: 0.65,
  reviewLowConfidence: true,
  semanticMaintenance: false,
} as const;

export const MEMORY_SETTINGS_KEY = 'memory_settings' as const;
