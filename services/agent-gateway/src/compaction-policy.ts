import { z } from 'zod';

export const COMPACTION_SETTINGS_KEY = 'compaction_policy_v1';

export const compactionSettingsSchema = z.object({
  auto: z.boolean().default(true),
  prune: z.boolean().default(true),
  reserved: z.number().int().min(0).optional(),
});

export type CompactionSettings = z.infer<typeof compactionSettingsSchema>;

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  prune: true,
};

export function readCompactionSettings(value: unknown): CompactionSettings {
  const parsed = compactionSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_COMPACTION_SETTINGS;
}
