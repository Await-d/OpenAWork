/**
 * Plugin configuration — the declarative `plugins` array
 * (`<dataDir>/openawork.json`), aligned with opencode v2's config
 * grammar:
 *
 *   "pkg"                  → add `pkg`
 *   { package, options }   → add with per-plugin options
 *   "-pkg"                 → remove matching entries (also `-*`, `-scope.*`)
 *   "*" / "pkg"            → re-enable a previously removed target
 *
 * The file is optional; a missing or unparsable file is treated as
 * "no declarative config" (env `OPENAWORK_PLUGINS` and directory
 * discovery still apply).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';

export interface PluginConfigEntry {
  readonly target: string;
  readonly options: Readonly<Record<string, unknown>>;
}

export interface ParsedPluginConfig {
  /** Entries to load (in declaration order). */
  readonly adds: readonly PluginConfigEntry[];
  /** Removal selectors (`target`, `*`, `scope.*`) from `-target` entries. */
  readonly removals: readonly string[];
  /**
   * Enable selectors (`*`, `scope.*`, exact target) that re-enable a
   * target disabled by a removal — e.g. `["-*", "my-plugin"]` disables
   * everything except `my-plugin`.
   */
  readonly enables: readonly string[];
}

export const EMPTY_PLUGIN_CONFIG: ParsedPluginConfig = { adds: [], removals: [], enables: [] };

/** `<dataDir>/openawork.json` — the gateway-level plugin config file. */
export function resolvePluginConfigPath(): string {
  return join(resolveGatewayDataDir(), 'openawork.json');
}

type ParsedItem =
  | { readonly kind: 'add'; readonly entry: PluginConfigEntry }
  | { readonly kind: 'remove'; readonly selector: string }
  | { readonly kind: 'enable'; readonly selector: string };

function parseEntry(value: unknown, index: number): ParsedItem {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`plugins[${index}] must not be an empty string`);
    }
    if (trimmed.startsWith('-')) {
      const target = trimmed.slice(1).trim();
      if (target.length === 0) {
        throw new Error(`plugins[${index}] removal requires a target ("-<target>")`);
      }
      return { kind: 'remove', selector: target };
    }
    // `*` and `prefix.*` are enable selectors (re-enable a removed
    // target), not package names — aligned with opencode v2.
    if (trimmed === '*' || trimmed.endsWith('.*')) {
      return { kind: 'enable', selector: trimmed };
    }
    return { kind: 'add', entry: { target: trimmed, options: {} } };
  }

  if (value !== null && typeof value === 'object') {
    const record = value as { package?: unknown; options?: unknown };
    if (typeof record.package !== 'string' || record.package.trim().length === 0) {
      throw new Error(`plugins[${index}] object form requires a non-empty "package" string`);
    }
    const options =
      record.options !== null && typeof record.options === 'object'
        ? (record.options as Record<string, unknown>)
        : {};
    return { kind: 'add', entry: { target: record.package.trim(), options } };
  }

  throw new Error(`plugins[${index}] must be a string or { package, options }`);
}

/** Parse the raw `plugins` array value into add / remove / enable operations. */
export function parsePluginConfig(raw: unknown): ParsedPluginConfig {
  if (raw === undefined || raw === null) return EMPTY_PLUGIN_CONFIG;
  if (!Array.isArray(raw)) {
    throw new Error('"plugins" must be an array');
  }

  const adds: PluginConfigEntry[] = [];
  const removals: string[] = [];
  const enables: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = parseEntry(raw[index], index);
    if (item.kind === 'add') {
      adds.push(item.entry);
    } else if (item.kind === 'remove') {
      removals.push(item.selector);
    } else {
      enables.push(item.selector);
    }
  }
  return { adds, removals, enables };
}

/**
 * Does a removal selector match a loaded plugin's id or source?
 * Supports exact match, `*` (everything) and `prefix.*`.
 */
export function matchesRemovalSelector(selector: string, candidate: string): boolean {
  if (selector === '*') return true;
  if (selector.endsWith('.*')) return candidate.startsWith(selector.slice(0, -1));
  return selector === candidate;
}

/**
 * Load `<dataDir>/openawork.json`. Returns `null` when the file is
 * absent; throws with context when the file exists but is malformed
 * (the caller decides whether to warn-and-continue).
 */
export async function loadPluginConfigFile(
  filePath: string = resolvePluginConfigPath(),
): Promise<ParsedPluginConfig | null> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  const parsed = JSON.parse(text) as { plugins?: unknown };
  return parsePluginConfig(parsed.plugins);
}
