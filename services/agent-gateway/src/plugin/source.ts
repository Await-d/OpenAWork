/**
 * Plugin source resolution & directory discovery.
 *
 * Local plugin layout: `<dataDir>/plugins/<name>/` with one of the
 * entrypoint candidates (`index.js` / `index.mjs` / `server.js` / ...).
 * Config / env entries may also point at a file or a bare package
 * specifier.
 *
 * The returned `watchPath` (file or directory) is what the hot-reload
 * watcher subscribes to for local sources; package sources are not
 * watched.
 */

import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';

export type PluginSourceKind = 'file' | 'directory' | 'package';

export interface ResolvedPluginSource {
  /** Original spec (used as the plugin `source` label). */
  readonly spec: string;
  readonly kind: PluginSourceKind;
  /** Value passed to dynamic `import()`. */
  readonly entrypoint: string;
  /** Local file/directory to watch for hot reload. */
  readonly watchPath?: string;
}

/** Entrypoint candidates checked inside a plugin directory, in order. */
export const PLUGIN_ENTRYPOINT_CANDIDATES = [
  'index.js',
  'index.mjs',
  'index.cjs',
  'server.js',
  'server.mjs',
  'main.js',
] as const;

/** `<dataDir>/plugins` — root of auto-discovered plugin directories. */
export function resolveGatewayPluginsDir(): string {
  return join(resolveGatewayDataDir(), 'plugins');
}

/** Discover `<dir>/*` directories (each is a plugin candidate), sorted. */
export async function discoverPluginDirectories(
  dir: string = resolveGatewayPluginsDir(),
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => join(dir, entry.name))
    .sort();
}

/** Find a plugin entrypoint inside a directory; `null` when none exists. */
export async function resolveDirectoryEntrypoint(dir: string): Promise<string | null> {
  for (const candidate of PLUGIN_ENTRYPOINT_CANDIDATES) {
    const file = join(dir, candidate);
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return file;
  }
  return null;
}

/**
 * Resolve a config/env spec into an import target.
 *
 *   - `./x` / `../x` / absolute paths → resolved against `baseDir`
 *     (directories look for a known entrypoint file).
 *   - bare specifiers → package imports, resolved by the runtime.
 *
 * Returns `null` when a path-like spec does not exist or a directory
 * has no entrypoint.
 */
export async function resolvePluginSpec(
  spec: string,
  baseDir: string,
): Promise<ResolvedPluginSource | null> {
  const isPathLike = spec.startsWith('./') || spec.startsWith('../') || isAbsolute(spec);
  if (!isPathLike) {
    return { spec, kind: 'package', entrypoint: spec };
  }

  const absolute = isAbsolute(spec) ? spec : resolve(baseDir, spec);
  const info = await stat(absolute).catch(() => null);
  if (!info) return null;

  if (info.isDirectory()) {
    const entry = await resolveDirectoryEntrypoint(absolute);
    if (!entry) return null;
    return {
      spec,
      kind: 'directory',
      entrypoint: pathToFileURL(entry).href,
      watchPath: absolute,
    };
  }

  return { spec, kind: 'file', entrypoint: pathToFileURL(absolute).href, watchPath: absolute };
}
