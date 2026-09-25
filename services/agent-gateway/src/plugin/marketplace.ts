/**
 * Plugin marketplace — aggregates `openawork-plugins.json` manifests from
 * the configured GitHub sources (`sources-store.ts`).
 *
 * Manifest (repo root; `ref` defaults to the repo default branch):
 *   { "name": "...", "plugins": [{ name, path?, description?, version?, author? }] }
 *
 * A repo without a manifest falls back to a single plugin at the repo root
 * (`fallback: true`), so a plain plugin repository works as a source too.
 *
 * Listings are cached in-memory with a short TTL; the install path always
 * downloads fresh (see `routes/plugins.ts`).
 */

import { z } from 'zod';
import {
  fetchJsonWithLimit,
  fetchTextWithLimit,
  githubRawUrl,
  PluginFetchError,
} from './github-fetch.js';
import { getPluginSource, listPluginSources, type PluginSource } from './sources-store.js';

export const PLUGIN_MARKET_MANIFEST_FILE = 'openawork-plugins.json';

const README_CANDIDATES = ['README.md', 'readme.md', 'README.markdown', 'README'] as const;
const README_MAX_BYTES = 64 * 1024;
const CACHE_TTL_MS = 60_000;

export interface MarketPluginEntry {
  /** `${sourceId}/${name}` */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;
  /** Path within the repo; `''` means the repo root. */
  readonly path: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly repo: string;
  readonly ref?: string;
  /** True when the repo has no manifest and is treated as one root plugin. */
  readonly fallback: boolean;
}

export interface MarketSourceFailure {
  readonly sourceId: string;
  readonly error: string;
}

export interface MarketListing {
  readonly entries: readonly MarketPluginEntry[];
  readonly failedSources: readonly MarketSourceFailure[];
}

export interface MarketEntryDetail {
  readonly entry: MarketPluginEntry;
  readonly readme?: string;
  readonly repoUrl: string;
}

const manifestSchema = z.object({
  name: z.string().optional(),
  plugins: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          path: z.string().trim().max(300).optional(),
          description: z.string().trim().max(500).optional(),
          version: z.string().trim().max(50).optional(),
          author: z.string().trim().max(100).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(200),
});

type ManifestPlugin = z.infer<typeof manifestSchema>['plugins'][number];

const cache = new Map<string, { readonly at: number; readonly entries: MarketPluginEntry[] }>();

/** Test-only: drop the listing cache. */
export function clearPluginMarketCache(): void {
  cache.clear();
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new PluginFetchError(`无效的仓库：${repo}`);
  }
  return { owner, repo: name };
}

function toEntry(
  source: PluginSource,
  plugin: ManifestPlugin,
  fallback: boolean,
): MarketPluginEntry {
  const path = (plugin.path ?? '').replace(/^\/+|\/+$/g, '');
  return {
    id: `${source.id}/${plugin.name}`,
    name: plugin.name,
    description: plugin.description ?? '',
    ...(plugin.version === undefined ? {} : { version: plugin.version }),
    ...(plugin.author === undefined ? {} : { author: plugin.author }),
    path,
    sourceId: source.id,
    sourceName: source.name,
    repo: source.repo,
    ...(source.ref === undefined ? {} : { ref: source.ref }),
    fallback,
  };
}

async function loadSourceEntries(source: PluginSource): Promise<MarketPluginEntry[]> {
  const cacheKey = `${source.repo}@${source.ref ?? 'HEAD'}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.entries;
  }

  const { owner, repo } = splitRepo(source.repo);
  const manifestUrl = githubRawUrl(owner, repo, source.ref, PLUGIN_MARKET_MANIFEST_FILE);

  let entries: MarketPluginEntry[];
  try {
    const raw = await fetchJsonWithLimit<unknown>(manifestUrl);
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PluginFetchError(
        `插件清单格式无效：${manifestUrl}（期望 { plugins: [{ name, path?, ... }] }）`,
      );
    }
    entries = parsed.data.plugins.map((plugin) => toEntry(source, plugin, false));
  } catch (err) {
    // A missing manifest means "this repo is a single plugin at its root".
    if (err instanceof PluginFetchError && /HTTP 404/.test(err.message)) {
      entries = [
        toEntry(
          source,
          {
            name: repo,
            path: '',
            description: '（仓库未提供 openawork-plugins.json，按根目录单插件）',
          },
          true,
        ),
      ];
    } else {
      throw err;
    }
  }

  cache.set(cacheKey, { at: Date.now(), entries });
  return entries;
}

/**
 * Aggregate listings from every enabled source and filter by `query`
 * (case-insensitive substring over name / description / repo / author).
 */
export async function searchMarketPlugins(query?: string): Promise<MarketListing> {
  const sources = listPluginSources().filter((source) => source.enabled);
  const entries: MarketPluginEntry[] = [];
  const failedSources: MarketSourceFailure[] = [];

  for (const source of sources) {
    try {
      entries.push(...(await loadSourceEntries(source)));
    } catch (err) {
      failedSources.push({
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const needle = query?.trim().toLowerCase();
  const filtered =
    needle === undefined || needle.length === 0
      ? entries
      : entries.filter((entry) =>
          `${entry.name} ${entry.description} ${entry.repo} ${entry.author ?? ''}`
            .toLowerCase()
            .includes(needle),
        );

  return { entries: filtered, failedSources };
}

async function fetchReadme(source: PluginSource, subPath: string): Promise<string | undefined> {
  const { owner, repo } = splitRepo(source.repo);
  for (const candidate of README_CANDIDATES) {
    const path = subPath.length === 0 ? candidate : `${subPath}/${candidate}`;
    try {
      return await fetchTextWithLimit(
        githubRawUrl(owner, repo, source.ref, path),
        README_MAX_BYTES,
      );
    } catch {
      // Try the next candidate; a missing README is not an error.
    }
  }
  return undefined;
}

/** Resolve one market entry (with README) or `null` when unknown. */
export async function getMarketEntryDetail(
  sourceId: string,
  name: string,
): Promise<MarketEntryDetail | null> {
  const source = getPluginSource(sourceId);
  if (!source) return null;

  let entries: MarketPluginEntry[];
  try {
    entries = await loadSourceEntries(source);
  } catch {
    return null;
  }
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) return null;

  const readme = await fetchReadme(source, entry.path).catch(() => undefined);
  return {
    entry,
    ...(readme === undefined ? {} : { readme }),
    repoUrl: `https://github.com/${source.repo}`,
  };
}
