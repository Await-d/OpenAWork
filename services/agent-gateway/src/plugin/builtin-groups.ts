/**
 * Built-in plugin groups — the internal plugins that gate the built-in
 * tool groups (image generation / desktop control / desktop automation).
 *
 * Migration note (T-29): group enable/disable used to be a static filter
 * inside `tools/plugin-tool-settings.ts`. The gate chain now lives in the
 * plugin platform, keyed by plugin id, and each group is registered as a
 * **guarded internal plugin** (`guarded: true` in `GET /plugins`, source
 * `internal`) so declarative config can never remove it.
 *
 * Storage (`user_settings.plugin_settings`) and the `/settings/plugins`
 * UI contract are unchanged. Single-user deployments treat the per-user
 * setting as the system-wide switch; the gate reads it per request, so
 * toggling in the UI still takes effect on the next agent turn.
 *
 * Gate semantics: gates can only RESTRICT. A built-in tool is visible
 * when every group that governs it reports enabled for the user; tools
 * no group mentions pass through untouched.
 */

import {
  isDesktopAutomationPluginEnabledForUser,
  isDesktopControlPluginEnabledForUser,
  isImageGenerationPluginEnabledForUser,
} from '../tools/plugin-tool-settings.js';
import { getPluginRegistry, type PluginRegistry } from './registry.js';
import { markPluginGuarded } from './supervisor.js';

export interface BuiltinPluginGroup {
  /** Internal plugin id, reported by `GET /plugins`. */
  readonly pluginId: string;
  /** Built-in tool names this group governs. */
  readonly tools: readonly string[];
  readonly isEnabledForUser: (userId: string) => boolean;
}

export const BUILTIN_PLUGIN_GROUPS: readonly BuiltinPluginGroup[] = [
  {
    pluginId: 'builtin.image-generation',
    tools: ['generate_image'],
    isEnabledForUser: isImageGenerationPluginEnabledForUser,
  },
  {
    pluginId: 'builtin.desktop-control',
    tools: ['desktop_control', 'computer_use'],
    isEnabledForUser: isDesktopControlPluginEnabledForUser,
  },
  {
    pluginId: 'builtin.desktop-automation',
    tools: ['desktop_automation'],
    isEnabledForUser: isDesktopAutomationPluginEnabledForUser,
  },
];

interface NamedTool {
  readonly function: { readonly name: string };
}

/** True when every gate governing `toolName` allows it for the user. */
export function isBuiltinToolAllowedForUser(toolName: string, userId: string): boolean {
  for (const group of BUILTIN_PLUGIN_GROUPS) {
    if (!group.tools.includes(toolName)) continue;
    if (!group.isEnabledForUser(userId)) return false;
  }
  return true;
}

/**
 * Filter the model-visible tool surface through the built-in group
 * gates. Same behavior as the historical
 * `filterPluginControlledToolsForUser`: absent or corrupt settings fail
 * closed (the tool is hidden).
 */
export function filterPluginControlledToolsForUser<T extends NamedTool>(
  tools: readonly T[],
  userId: string,
): T[] {
  return tools.filter((tool) => isBuiltinToolAllowedForUser(tool.function.name, userId));
}

/**
 * Register the built-in groups as internal plugins (idempotent):
 * inventory visibility in `GET /plugins` + `guarded` (config cannot
 * remove them). Gating itself is static and always active — registration
 * only affects the inventory projection.
 */
export async function registerBuiltinPluginGroups(
  registry: PluginRegistry = getPluginRegistry(),
): Promise<void> {
  for (const group of BUILTIN_PLUGIN_GROUPS) {
    markPluginGuarded(group.pluginId);
    if (registry.hasActive(group.pluginId)) continue;
    await registry.activate({ id: group.pluginId, setup: () => undefined }, { source: 'internal' });
  }
}
