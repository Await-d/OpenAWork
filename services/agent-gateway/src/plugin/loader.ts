/**
 * Plugin loader — resolves the effective plugin set (config file +
 * discovered `<dataDir>/plugins/*` directories + `OPENAWORK_PLUGINS`
 * env), imports each source and activates it through the registry.
 *
 * Hot reload: `startPluginHotReload` watches every local source's
 * entrypoint file. A content change (digest-gated) deactivates the
 * plugin and re-activates it from a cache-busted `import()` URL, so
 * editing a plugin file takes effect without a gateway restart.
 * Failed plugins stay tracked: fixing the file retries activation.
 *
 * Scope note: only the entrypoint file is watched. Changes to a
 * plugin's *dependencies* (other files it imports) do not trigger a
 * reload — matching the "one file per plugin" layout this phase
 * targets. Dependency-graph watching is a possible follow-up.
 */

import { basename, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginInfo } from '@openAwork/plugin-sdk';
import {
  loadPluginConfigFile,
  matchesRemovalSelector,
  resolvePluginConfigPath,
  type ParsedPluginConfig,
} from './config.js';
import { getPluginRegistry, type PluginDefinition, type PluginRegistry } from './registry.js';
import { isPluginDisabled } from './state-store.js';
import {
  discoverPluginDirectories,
  resolveGatewayPluginsDir,
  resolvePluginSpec,
  type ResolvedPluginSource,
} from './source.js';
import type { PluginFactory, V1PluginHooks } from './v1-shim.js';
import { isPluginGuarded } from './supervisor.js';
import { PluginWatcher } from './watcher.js';

function isEffectOrPromisePlugin(value: unknown): value is PluginDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; effect?: unknown; setup?: unknown };
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false;
  return typeof candidate.effect === 'function' || typeof candidate.setup === 'function';
}

/** A plugin source the loader knows about (loaded or failed). */
export interface TrackedPlugin {
  /** Original spec, used as the `source` label and reload selector. */
  readonly spec: string;
  /** Registry id (`definition.id` for V2, `v1:<spec>` for V1). */
  readonly pluginId: string;
  /** Dynamic `import()` target (file URL or package specifier). */
  readonly entrypoint: string;
  readonly options: Readonly<Record<string, unknown>>;
  /** Local entrypoint file to watch for hot reload. */
  readonly watchPath?: string;
  /** Whether activation succeeded. */
  readonly active: boolean;
  /** True when the user disabled the plugin (activation skipped). */
  readonly disabled?: boolean;
  readonly error?: string;
}

export interface SkippedPlugin {
  readonly spec: string;
  readonly reason: string;
}

export interface PluginLoadOutcome {
  readonly tracked: readonly TrackedPlugin[];
  readonly active: readonly TrackedPlugin[];
  readonly skipped: readonly SkippedPlugin[];
}

export interface LoadPluginsOptions {
  /** Override the config file path (tests). */
  readonly configPath?: string;
  /** Override the discovery root (tests). */
  readonly pluginsDir?: string;
  /** Override the env list (tests); defaults to `OPENAWORK_PLUGINS`. */
  readonly envPlugins?: string;
  /** Base directory for relative config entries; defaults to the config file's dir. */
  readonly configBaseDir?: string;
  /** Base directory for relative env entries; defaults to `process.cwd()`. */
  readonly envBaseDir?: string;
}

interface Candidate {
  readonly spec: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly baseDir: string;
}

interface ActivationAttempt {
  readonly tracked: TrackedPlugin;
}

function watchTargetFor(resolved: ResolvedPluginSource): { path: string } | undefined {
  if (resolved.kind === 'package') return undefined;
  if (resolved.kind === 'file') {
    return { path: fileURLToPath(resolved.entrypoint) };
  }
  const entry = fileURLToPath(resolved.entrypoint);
  return { path: entry };
}

function withCacheBust(entrypoint: string): string {
  if (!entrypoint.startsWith('file://')) return entrypoint;
  const url = new URL(entrypoint);
  url.searchParams.set('v', Date.now().toString(36));
  return url.href;
}

async function activateResolvedSource(
  resolved: ResolvedPluginSource,
  options: Readonly<Record<string, unknown>>,
  registry: PluginRegistry,
  cacheBust: boolean,
): Promise<ActivationAttempt | { readonly error: string }> {
  const importTarget = cacheBust ? withCacheBust(resolved.entrypoint) : resolved.entrypoint;

  let mod: { default?: unknown };
  try {
    mod = (await import(importTarget)) as { default?: unknown };
  } catch (err) {
    return { error: `import failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const definition = mod.default;
  const watchPath = watchTargetFor(resolved)?.path;

  if (isEffectOrPromisePlugin(definition)) {
    if (registry.hasActive(definition.id)) {
      // Refresh pass: the plugin is already active — keep tracking it
      // without re-running setup (idempotent disk refresh).
      return {
        tracked: {
          spec: resolved.spec,
          pluginId: definition.id,
          entrypoint: resolved.entrypoint,
          options,
          ...(watchPath === undefined ? {} : { watchPath }),
          active: true,
        },
      };
    }
    if (isPluginDisabled(definition.id)) {
      // User-disabled: stay tracked (hot reload / enable can revive)
      // but do not run setup.
      return {
        tracked: {
          spec: resolved.spec,
          pluginId: definition.id,
          entrypoint: resolved.entrypoint,
          options,
          ...(watchPath === undefined ? {} : { watchPath }),
          active: false,
          disabled: true,
        },
      };
    }
    await registry.activate(definition, { source: resolved.spec, options });
    const failure = registry
      .list()
      .find(
        (entry): entry is PluginInfo & { state: { status: 'failed'; error: string } } =>
          entry.id === definition.id && entry.state.status === 'failed',
      );
    return {
      tracked: {
        spec: resolved.spec,
        pluginId: definition.id,
        entrypoint: resolved.entrypoint,
        options,
        ...(watchPath === undefined ? {} : { watchPath }),
        active: failure === undefined,
        ...(failure === undefined ? {} : { error: failure.state.error }),
      },
    };
  }

  if (typeof definition === 'function') {
    const pluginId = `v1:${resolved.spec}`;
    if (registry.hasActive(pluginId)) {
      return {
        tracked: {
          spec: resolved.spec,
          pluginId,
          entrypoint: resolved.entrypoint,
          options,
          ...(watchPath === undefined ? {} : { watchPath }),
          active: true,
        },
      };
    }
    if (isPluginDisabled(pluginId)) {
      return {
        tracked: {
          spec: resolved.spec,
          pluginId,
          entrypoint: resolved.entrypoint,
          options,
          ...(watchPath === undefined ? {} : { watchPath }),
          active: false,
          disabled: true,
        },
      };
    }
    let hooks: V1PluginHooks;
    try {
      hooks = await (definition as PluginFactory)();
    } catch (err) {
      return { error: `factory threw: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!hooks || typeof hooks !== 'object') {
      return { error: 'factory returned no hooks' };
    }
    registry.activateV1(resolved.spec, hooks);
    return {
      tracked: {
        spec: resolved.spec,
        pluginId,
        entrypoint: resolved.entrypoint,
        options,
        ...(watchPath === undefined ? {} : { watchPath }),
        active: true,
      },
    };
  }

  return { error: 'no default export (expected a V2 definition or a V1 factory)' };
}

/** Labels a removal/enable selector can match: the spec, its basename, and the spec without trailing slashes. */
function candidateLabels(spec: string): string[] {
  return [spec, basename(spec), spec.replace(/\/+$/, '')];
}

function matchesSelectors(selectors: Iterable<string>, labels: readonly string[]): boolean {
  for (const selector of selectors) {
    if (labels.some((label) => matchesRemovalSelector(selector, label))) return true;
  }
  return false;
}

function isPathLikeSpec(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || isAbsolute(spec);
}

/**
 * Load every configured plugin source. Never throws: individual
 * failures become `skipped` entries (or failed-but-tracked plugins for
 * hot reload retries).
 *
 * Removal semantics:
 *   - `-<target>` removals filter **discovered + env** candidates by
 *     spec / basename.
 *   - Config `adds` are always loaded (explicit user intent).
 *   - `*` / `prefix.*` enable selectors (and an exact config string
 *     that names a would-be-removed local candidate) rescue a target
 *     from removal: `["-*", "my-plugin"]` disables everything except
 *     `my-plugin`.
 */
export async function loadPlugins(
  options: LoadPluginsOptions = {},
  registry: PluginRegistry = getPluginRegistry(),
): Promise<PluginLoadOutcome> {
  const skipped: SkippedPlugin[] = [];

  // 1. Declarative config (<dataDir>/openawork.json).
  let config: ParsedPluginConfig | null = null;
  const configPath = options.configPath ?? resolvePluginConfigPath();
  try {
    config = await loadPluginConfigFile(configPath);
  } catch (err) {
    console.warn(
      `[plugin] failed to parse config "${configPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const configBaseDir = options.configBaseDir ?? dirname(configPath);
  const removals = config?.removals ?? [];
  const enables = new Set<string>(config?.enables ?? []);

  // 2. Auto-discovered directories + env list (removal-filtered sources).
  const localCandidates: Candidate[] = [];
  const pluginsDir = options.pluginsDir ?? resolveGatewayPluginsDir();
  const discovered = await discoverPluginDirectories(pluginsDir).catch((err: unknown) => {
    console.warn(
      `[plugin] failed to scan "${pluginsDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return [] as string[];
  });
  for (const dir of discovered) {
    localCandidates.push({ spec: dir, options: {}, baseDir: dirname(dir) });
  }
  const envRaw = options.envPlugins ?? globalThis.process?.env?.['OPENAWORK_PLUGINS'];
  const envBaseDir = options.envBaseDir ?? process.cwd();
  for (const spec of (envRaw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    localCandidates.push({ spec, options: {}, baseDir: envBaseDir });
  }

  // 3. Config adds. A non-path-like entry that names a local candidate
  // which the removals would drop acts as an enable selector instead of
  // a new source (that is how `["-*", "my-plugin"]` is expressed).
  const configCandidates: Candidate[] = [];
  for (const add of config?.adds ?? []) {
    const labels = candidateLabels(add.target);
    const localMatch = localCandidates.find((candidate) =>
      candidateLabels(candidate.spec).some((label) => labels.includes(label)),
    );
    if (
      localMatch &&
      !isPathLikeSpec(add.target) &&
      matchesSelectors(removals, candidateLabels(localMatch.spec))
    ) {
      for (const label of candidateLabels(add.target)) enables.add(label);
      continue;
    }
    configCandidates.push({ spec: add.target, options: add.options, baseDir: configBaseDir });
  }

  // Load, deduping by resolved entrypoint. Config adds first (explicit
  // intent), then local sources.
  const tracked: TrackedPlugin[] = [];
  const seenEntrypoints = new Set<string>();
  const candidates: Candidate[] = [...configCandidates, ...localCandidates];

  for (const candidate of candidates) {
    const labels = candidateLabels(candidate.spec);
    const isLocal = localCandidates.includes(candidate);
    const guarded = labels.some((label) => isPluginGuarded(label));
    if (
      isLocal &&
      !guarded &&
      matchesSelectors(removals, labels) &&
      !matchesSelectors(enables, labels)
    ) {
      skipped.push({ spec: candidate.spec, reason: 'removed by config' });
      continue;
    }

    const resolved = await resolvePluginSpec(candidate.spec, candidate.baseDir);
    if (!resolved) {
      skipped.push({ spec: candidate.spec, reason: 'path not found' });
      continue;
    }
    if (seenEntrypoints.has(resolved.entrypoint)) {
      skipped.push({ spec: candidate.spec, reason: 'duplicate source' });
      continue;
    }
    seenEntrypoints.add(resolved.entrypoint);

    const attempt = await activateResolvedSource(resolved, candidate.options, registry, false);
    if ('error' in attempt) {
      skipped.push({ spec: candidate.spec, reason: attempt.error });
      continue;
    }
    tracked.push(attempt.tracked);
    if (!attempt.tracked.active) {
      console.warn(
        `[plugin] "${candidate.spec}" failed to activate: ${attempt.tracked.error ?? 'unknown error'}`,
      );
    }
  }

  return {
    tracked,
    active: tracked.filter((plugin) => plugin.active),
    skipped,
  };
}

// -----------------------------------------------------------------
// Hot reload
// -----------------------------------------------------------------

export interface HotReloadHandle {
  /** Stop watching (does not unload plugins). */
  stop(): void;
  /** Watcher instance (exposed for tests). */
  readonly watcher: PluginWatcher;
}

/**
 * Watch every tracked plugin's entrypoint file and reload it on change.
 * Failed sources are watched too, so fixing a broken plugin retries it.
 *
 * Async because registering watchers is asynchronous; awaiting the
 * returned handle guarantees every watch is active.
 */
export async function startPluginHotReload(
  outcome: PluginLoadOutcome,
  watcher: PluginWatcher = new PluginWatcher(),
): Promise<HotReloadHandle> {
  for (const plugin of outcome.tracked) {
    if (!plugin.watchPath) continue;
    await watcher.watch({ path: plugin.watchPath, kind: 'file' }, async () => {
      await reloadTrackedPlugin(plugin);
    });
  }
  return { stop: () => watcher.close(), watcher };
}

async function reloadTrackedPlugin(plugin: TrackedPlugin): Promise<void> {
  const registry = getPluginRegistry();
  console.log(`[plugin] hot reload: "${plugin.spec}"`);
  await registry.deactivate(plugin.pluginId);

  const resolved: ResolvedPluginSource = {
    spec: plugin.spec,
    kind: plugin.entrypoint.startsWith('file://') ? 'file' : 'package',
    entrypoint: plugin.entrypoint,
    ...(plugin.watchPath === undefined ? {} : { watchPath: plugin.watchPath }),
  };
  const attempt = await activateResolvedSource(resolved, plugin.options, registry, true);
  if ('error' in attempt) {
    console.warn(`[plugin] hot reload of "${plugin.spec}" failed: ${attempt.error}`);
    return;
  }
  if (!attempt.tracked.active) {
    console.warn(
      `[plugin] hot reload of "${plugin.spec}" did not activate: ${attempt.tracked.error ?? 'unknown error'}`,
    );
  }
}
