/**
 * Shared plugin lifecycle operations — the management route and the
 * `plugin_manage` tool call the same implementation so validation,
 * storage cleanup and hot-reload refresh never drift.
 *
 * Results use a small discriminator (`not-found` / `guarded` /
 * `invalid` / `failed`) that callers map to HTTP status codes or
 * user-facing text.
 */

import { relative, resolve, sep } from 'node:path';
import { getTrackedPlugins, refreshPluginsFromDisk } from '../runtime/plugin-host.js';
import type { TrackedPlugin } from './loader.js';
import { getPluginRegistry } from './registry.js';
import {
  isInsidePluginsDir,
  resolveInstalledPluginDir,
  sanitizeInstallId,
  uninstallInstalledPlugin,
} from './installer.js';
import { resolveGatewayPluginsDir } from './source.js';
import { setPluginDisabled } from './state-store.js';
import { deletePluginStorage } from './storage.js';
import { isPluginGuarded } from './supervisor.js';

export type PluginOpFailureCode = 'not-found' | 'guarded' | 'invalid' | 'failed';

export type PluginOpResult =
  | {
      readonly ok: true;
      readonly detail: string;
      /** Post-op activation state, when meaningful (enable/reload). */
      readonly active?: boolean;
      readonly error?: string;
    }
  | { readonly ok: false; readonly code: PluginOpFailureCode; readonly error: string };

function failure(code: PluginOpFailureCode, error: string): Extract<PluginOpResult, { ok: false }> {
  return { ok: false, code, error };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Install id for a tracked source, when the source lives inside
 * `<dataDir>/plugins` (the first path segment under the plugins root).
 */
export function installIdForSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const root = resolve(resolveGatewayPluginsDir());
  const target = resolve(source);
  if (target !== root && !target.startsWith(root + sep)) return undefined;
  const first = relative(root, target).split(sep)[0];
  return first && first.length > 0 ? first : undefined;
}

export function findTrackedByInstallId(installId: string): TrackedPlugin | undefined {
  const dir = resolve(resolveInstalledPluginDir(installId));
  return getTrackedPlugins().find((plugin) => {
    if (!plugin.watchPath) return false;
    if (!isInsidePluginsDir(plugin.watchPath)) return false;
    return resolve(plugin.watchPath).startsWith(dir + sep);
  });
}

/** Uninstall (remove directory + storage); guarded plugins refuse. */
export async function uninstallPluginByInstallId(installId: string): Promise<PluginOpResult> {
  let safeId: string;
  try {
    safeId = sanitizeInstallId(installId);
  } catch (err) {
    return failure('invalid', messageOf(err));
  }

  const tracked = findTrackedByInstallId(safeId);
  if (tracked && isPluginGuarded(tracked.pluginId)) {
    return failure('guarded', `Plugin "${tracked.pluginId}" is guarded and cannot be removed.`);
  }
  if (tracked) {
    await getPluginRegistry().deactivate(tracked.pluginId);
    deletePluginStorage(tracked.pluginId);
  }

  let removed: boolean;
  try {
    removed = await uninstallInstalledPlugin(safeId);
  } catch (err) {
    return failure('invalid', messageOf(err));
  }
  if (!removed && !tracked) {
    return failure('not-found', `Plugin "${safeId}" is not installed.`);
  }

  await refreshPluginsFromDisk();
  return { ok: true, detail: `已卸载 ${safeId}（目录与存储数据已清理）。` };
}

/**
 * Enable / disable a plugin by id. Enable is idempotent and also retries
 * activation for previously failed plugins; disable refuses guarded
 * plugins.
 */
export async function setPluginEnabledById(
  pluginId: string,
  enabled: boolean,
): Promise<PluginOpResult> {
  const tracked = getTrackedPlugins().find((plugin) => plugin.pluginId === pluginId);
  if (!tracked) {
    return failure('not-found', `Plugin "${pluginId}" is not loaded.`);
  }

  if (!enabled) {
    if (isPluginGuarded(pluginId)) {
      return failure('guarded', `Plugin "${pluginId}" is guarded and cannot be disabled.`);
    }
    await getPluginRegistry().deactivate(pluginId);
    setPluginDisabled(pluginId, true);
    await refreshPluginsFromDisk();
    return { ok: true, detail: `已停用 ${pluginId}，可随时启用恢复。` };
  }

  setPluginDisabled(pluginId, false);
  const outcome = await refreshPluginsFromDisk();
  const reloaded = outcome.tracked.find((plugin) => plugin.pluginId === pluginId);
  if (!reloaded) {
    return failure('not-found', `Plugin "${pluginId}" is not loaded.`);
  }
  return {
    ok: true,
    detail: reloaded.active
      ? `已启用 ${pluginId}。`
      : `已启用 ${pluginId}，但激活失败：${reloaded.error ?? '未知错误'}`,
    active: reloaded.active,
    ...(reloaded.error === undefined ? {} : { error: reloaded.error }),
  };
}

/** Reload an installed plugin from disk (deactivate + re-activate). */
export async function reloadPluginByInstallId(installId: string): Promise<PluginOpResult> {
  let safeId: string;
  try {
    safeId = sanitizeInstallId(installId);
  } catch (err) {
    return failure('invalid', messageOf(err));
  }

  const tracked = findTrackedByInstallId(safeId);
  if (!tracked) {
    return failure('not-found', `Plugin "${safeId}" is not installed.`);
  }

  await getPluginRegistry().deactivate(tracked.pluginId);
  const outcome = await refreshPluginsFromDisk();
  const reloaded = outcome.tracked.find((plugin) => installIdForSource(plugin.spec) === safeId);
  return {
    ok: true,
    detail:
      reloaded?.active === true
        ? `已重载 ${safeId}。`
        : `重载 ${safeId} 未激活：${reloaded?.error ?? '未知错误'}`,
    active: reloaded?.active === true,
    ...(reloaded?.error === undefined ? {} : { error: reloaded.error }),
  };
}
