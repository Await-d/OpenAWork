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
});

export const DEFAULT_MEMORY_SETTINGS = {
  enabled: true,
  autoExtract: true,
  maxTokenBudget: 2000,
  minConfidence: 0.3,
  autoWriteMinConfidence: 0.65,
  reviewLowConfidence: true,
} as const;

export const MEMORY_SETTINGS_KEY = 'memory_settings' as const;
