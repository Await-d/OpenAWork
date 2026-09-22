import { z } from 'zod';
import { sqliteGet } from '../infra/db.js';
import type { GatewayToolDefinition } from './tool-definitions.js';

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

export function filterPluginControlledToolsForUser(
  tools: readonly GatewayToolDefinition[],
  userId: string,
): GatewayToolDefinition[] {
  const settings = readPluginSettingsForUser(userId);
  return tools.filter((tool) => {
    const toolName = tool.function.name;
    if (toolName === 'generate_image') {
      return settings.imageGeneration?.enabled === true;
    }
    if (toolName === 'desktop_control' || toolName === 'computer_use') {
      // computer_use 与 desktop_control 同属「系统桌面控制」插件（G2）：
      // 若不在此过滤，插件关闭时模型仍能看到该工具，只能靠调用时的沙箱门控拒绝。
      return settings.desktopControl?.enabled === true;
    }
    if (toolName === 'desktop_automation') {
      // desktop_automation 是独立于「系统桌面控制」的浏览器自动化插件：
      // 用户开关关闭时必须让模型完全看不到该工具，与 desktop_control 保持同一范式。
      return settings.desktopAutomation?.enabled === true;
    }
    return true;
  });
}
