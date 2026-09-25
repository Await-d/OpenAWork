/**
 * Plugin installer — copies a local plugin source (directory or single
 * file) into `<dataDir>/plugins/<installId>/`.
 *
 * Scope notes:
 *   - Directory sources copy recursively; single-file sources become
 *     `<installId>/index.<ext>`.
 *   - Zip archives are not supported in this phase (the gateway has no
 *     archive dependency; `skill-registry` owns that stack).
 *   - npm package installs are a separate decision (require a package
 *     manager at runtime) and remain deferred.
 *
 * Safety:
 *   - Install ids are sanitized (`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`) and
 *     every write target is confined to `<dataDir>/plugins`.
 *   - Staging + rename keeps a half-copied plugin from being discovered.
 *   - Existing installs require `force` to overwrite.
 */

import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { resolveDirectoryEntrypoint, resolveGatewayPluginsDir } from './source.js';

const INSTALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** File extensions accepted for single-file plugin installs. */
export const SUPPORTED_SINGLE_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs'] as const;

export class PluginInstallError extends Error {
  override name = 'PluginInstallError';
}

export interface InstallResult {
  readonly installId: string;
  readonly path: string;
  readonly entrypoint: string;
}

export function sanitizeInstallId(raw: string): string {
  const id = raw.trim();
  if (!INSTALL_ID_PATTERN.test(id)) {
    throw new PluginInstallError(
      `Invalid plugin install id "${raw}": expected [A-Za-z0-9][A-Za-z0-9._-]{0,63}.`,
    );
  }
  return id;
}

export function resolveInstalledPluginDir(installId: string): string {
  return join(resolveGatewayPluginsDir(), sanitizeInstallId(installId));
}

/** True when `path` is inside `<dataDir>/plugins` (removal guard). */
export function isInsidePluginsDir(path: string): boolean {
  const root = resolve(resolveGatewayPluginsDir());
  const target = resolve(path);
  return target === root || target.startsWith(root + sep);
}

export async function installPluginFromPath(
  sourcePath: string,
  options: { force?: boolean } = {},
): Promise<InstallResult> {
  const source = resolve(sourcePath);
  const info = await stat(source).catch(() => null);
  if (!info) {
    throw new PluginInstallError(`Plugin source not found: ${sourcePath}`);
  }
  if (isInsidePluginsDir(source)) {
    throw new PluginInstallError('Source is already inside the plugins directory.');
  }

  // Single-file sources install under a directory named after the file
  // without its extension (`my-plugin.mjs` → `my-plugin/index.mjs`).
  const rawInstallId = info.isDirectory() ? basename(source) : basename(source, extname(source));
  const installId = sanitizeInstallId(rawInstallId);
  const targetDir = resolveInstalledPluginDir(installId);
  const existing = await stat(targetDir).catch(() => null);
  if (existing && options.force !== true) {
    throw new PluginInstallError(
      `Plugin "${installId}" is already installed (pass force to overwrite).`,
    );
  }

  const staging = `${targetDir}.tmp-${Date.now().toString(36)}`;
  await mkdir(resolveGatewayPluginsDir(), { recursive: true });
  await rm(staging, { recursive: true, force: true });
  try {
    if (info.isDirectory()) {
      await cp(source, staging, { recursive: true, errorOnExist: false });
      const entry = await resolveDirectoryEntrypoint(staging);
      if (!entry) {
        throw new PluginInstallError(
          `No plugin entrypoint found in ${sourcePath} (expected index.js / index.mjs / index.cjs / server.js / server.mjs / main.js).`,
        );
      }
    } else {
      const ext = extname(source).toLowerCase();
      if (!(SUPPORTED_SINGLE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new PluginInstallError(
          `Unsupported plugin file type "${ext}" (expected ${SUPPORTED_SINGLE_FILE_EXTENSIONS.join(' / ')}).`,
        );
      }
      await mkdir(staging, { recursive: true });
      await cp(source, join(staging, `index${ext}`));
    }

    if (existing) {
      await rm(targetDir, { recursive: true, force: true });
    }
    await rename(staging, targetDir);
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }

  const entrypoint = await resolveDirectoryEntrypoint(targetDir);
  if (!entrypoint) {
    throw new PluginInstallError('Installed plugin has no entrypoint (internal error).');
  }
  return { installId, path: targetDir, entrypoint };
}

/** Remove an installed plugin directory. Returns false when absent. */
export async function uninstallInstalledPlugin(installId: string): Promise<boolean> {
  const dir = resolveInstalledPluginDir(installId);
  if (!isInsidePluginsDir(dir)) {
    throw new PluginInstallError('Refusing to remove a path outside the plugins directory.');
  }
  const info = await stat(dir).catch(() => null);
  if (!info) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
