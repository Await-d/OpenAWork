import { z } from 'zod';
import { sqliteGet } from '../infra/db.js';

export const PLUGIN_SETTINGS_KEY = 'plugin_settings';

const imageGenerationPluginSettingsSchema = z
  .object({
    enabled: z.boolean(),
    modelSource: z.enum(['global', 'dedicated']).optional(),
    dedicatedProviderId: z.string().optional(),
    dedicatedModelId: z.string().optional(),
  })
  .strict();

const desktopControlPluginSettingsSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const desktopAutomationPluginSettingsSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const pluginSettingsSchema = z
  .object({
    imageGeneration: imageGenerationPluginSettingsSchema.optional(),
    desktopControl: desktopControlPluginSettingsSchema.optional(),
    desktopAutomation: desktopAutomationPluginSettingsSchema.optional(),
  })
  .strict();

export type PluginSettings = z.infer<typeof pluginSettingsSchema>;

interface UserSettingRow {
  readonly value: string | null;
}

function parseStoredJson(value: string | null | undefined): unknown {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return undefined;
  }
}

export function readPluginSettingsForUser(userId: string): PluginSettings {
  const row = sqliteGet<UserSettingRow>(
    'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
    [userId, PLUGIN_SETTINGS_KEY],
  );
  const parsed = pluginSettingsSchema.safeParse(parseStoredJson(row?.value));
  return parsed.success ? parsed.data : {};
}

export function isImageGenerationPluginEnabledForUser(userId: string): boolean {
  return readPluginSettingsForUser(userId).imageGeneration?.enabled === true;
}

export function isDesktopControlPluginEnabledForUser(userId: string): boolean {
  return readPluginSettingsForUser(userId).desktopControl?.enabled === true;
}

export function isDesktopAutomationPluginEnabledForUser(userId: string): boolean {
  return readPluginSettingsForUser(userId).desktopAutomation?.enabled === true;
}

// Tool-surface filtering moved to the plugin platform
// (`src/plugin/builtin-groups.ts`): the built-in groups are now internal
// plugins whose gates key on the plugin id, while this module stays the
// storage/reader for `/settings/plugins`.
