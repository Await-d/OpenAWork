import { z } from 'zod';

export const MEMORY_TYPES = [
  'preference',
  'fact',
  'instruction',
  'project_context',
  'learned_pattern',
] as const;

export const MEMORY_SOURCES = ['manual', 'auto_extracted', 'api'] as const;

export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export const memorySourceSchema = z.enum(MEMORY_SOURCES);

export const createMemorySchema = z.object({
  type: memoryTypeSchema,
  key: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(4000),
  source: memorySourceSchema.optional().default('manual'),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  priority: z.number().int().min(0).max(100).optional().default(50),
  workspaceRoot: z.string().trim().max(500).nullable().optional().default(null),
});

export const updateMemorySchema = z.object({
  type: memoryTypeSchema.optional(),
  key: z.string().trim().min(1).max(200).optional(),
  value: z.string().trim().min(1).max(4000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const memoryListQuerySchema = z.object({
  type: memoryTypeSchema.optional(),
  source: memorySourceSchema.optional(),
  workspaceRoot: z.string().trim().max(500).nullable().optional(),
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
});

export const DEFAULT_MEMORY_SETTINGS = {
  enabled: true,
  autoExtract: true,
  maxTokenBudget: 2000,
  minConfidence: 0.3,
} as const;

export const MEMORY_SETTINGS_KEY = 'memory_settings' as const;
