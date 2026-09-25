/**
 * Plugin market backend (`sources-store` + `github-fetch` + `marketplace`).
 *
 * Pins down:
 *   1. Repo input normalization (`owner/repo`, `owner/repo@tag`, URL).
 *   2. Source CRUD (dedupe by repo, remove).
 *   3. Zip handling: root stripping, subtree extraction, zip-slip guard,
 *      expansion budget.
 *   4. Manifest listing (fetch mocked): entries, query filter, 404
 *      single-plugin fallback, invalid manifest → failedSources.
 *   5. Entry detail with README.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type * as DbModule from '../../infra/db.js';
import type * as GithubFetchModule from '../../plugin/github-fetch.js';
import type * as MarketplaceModule from '../../plugin/marketplace.js';
import type * as SourcesStoreModule from '../../plugin/sources-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let sourcesStore: typeof SourcesStoreModule;
let githubFetch: typeof GithubFetchModule;
let marketplace: typeof MarketplaceModule;

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  sourcesStore = await import('../../plugin/sources-store.js');
  githubFetch = await import('../../plugin/github-fetch.js');
  marketplace = await import('../../plugin/marketplace.js');
}, 60_000);

beforeEach(() => {
  db.sqliteRun('DELETE FROM plugin_sources', []);
  marketplace.clearPluginMarketCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  );
}

describe('plugin sources store', () => {
  it('normalizes supported repo forms and rejects invalid input', () => {
    expect(sourcesStore.normalizePluginRepoInput('acme/plugins')).toEqual({
      repo: 'acme/plugins',
    });
    expect(sourcesStore.normalizePluginRepoInput('acme/plugins@v1')).toEqual({
      repo: 'acme/plugins',
      ref: 'v1',
    });
    expect(sourcesStore.normalizePluginRepoInput('https://github.com/acme/plugins')).toEqual({
      repo: 'acme/plugins',
    });
    expect(() => sourcesStore.normalizePluginRepoInput('not a repo')).toThrow(
      /Invalid GitHub reference/,
    );
  });

  it('adds, dedupes and removes sources', () => {
    const first = sourcesStore.addPluginSource({ repo: 'acme/plugins' });
    expect(first.id).toBe('acme/plugins');
    expect(first.name).toBe('acme/plugins');

    const second = sourcesStore.addPluginSource({ repo: 'acme/plugins', name: 'Acme 插件集' });
    expect(second.id).toBe('acme/plugins');
    expect(second.name).toBe('Acme 插件集');
    expect(sourcesStore.listPluginSources()).toHaveLength(1);

    expect(sourcesStore.removePluginSource('acme/plugins')).toBe(true);
    expect(sourcesStore.removePluginSource('acme/plugins')).toBe(false);
    expect(sourcesStore.listPluginSources()).toHaveLength(0);
  });
});

describe('plugin zip handling', () => {
  const archive = zipSync({
    'acme-plugins-abc123/README.md': strToU8('# Acme'),
    'acme-plugins-abc123/plugins/demo/index.mjs': strToU8('export default {};'),
    'acme-plugins-abc123/plugins/demo/helper.js': strToU8('export const x = 1;'),
    'acme-plugins-abc123/plugins/other/index.mjs': strToU8('export default {};'),
  });

  it('strips the zipball root directory and skips directory entries', () => {
    const entries = githubFetch.unzipPluginArchive(archive);
    expect([...entries.keys()].sort()).toEqual([
      'README.md',
      'plugins/demo/helper.js',
      'plugins/demo/index.mjs',
      'plugins/other/index.mjs',
    ]);
  });

  it('extracts a subtree and rejects path traversal entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openawork-plugin-extract-'));
    try {
      const entries = githubFetch.unzipPluginArchive(
        zipSync({
          'acme-plugins-sha/plugins/demo/index.mjs': strToU8('export default {};'),
          'acme-plugins-sha/plugins/demo/../evil.txt': strToU8('evil'),
        }),
      );
      const written = await githubFetch.extractZipSubtreeToDirectory(entries, 'plugins/demo', dir);
      expect(written).toBe(1);
      expect(await readFile(join(dir, 'index.mjs'), 'utf8')).toContain('export default');
      // The traversal entry must not have escaped the destination.
      await expect(stat(join(dir, '..', 'evil.txt'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects archives that expand beyond the budget', () => {
    expect(() => githubFetch.unzipPluginArchive(archive, 1)).toThrow(/超过上限/);
  });
});

describe('plugin marketplace listing', () => {
  it('lists manifest plugins and filters by query', async () => {
    sourcesStore.addPluginSource({ repo: 'acme/plugins' });
    stubFetch((url) => {
      if (url.endsWith('/openawork-plugins.json')) {
        return jsonResponse({
          name: 'Acme 插件集',
          plugins: [
            { name: 'echo', path: 'plugins/echo', description: '回声插件', version: '1.0.0' },
            { name: 'translate', path: 'plugins/translate', description: '翻译插件' },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    });

    const all = await marketplace.searchMarketPlugins();
    expect(all.entries.map((entry) => entry.name)).toEqual(['echo', 'translate']);
    expect(all.entries[0]).toMatchObject({
      id: 'acme/plugins/echo',
      path: 'plugins/echo',
      sourceId: 'acme/plugins',
      repo: 'acme/plugins',
      fallback: false,
    });

    const filtered = await marketplace.searchMarketPlugins('翻译');
    expect(filtered.entries.map((entry) => entry.name)).toEqual(['translate']);
  });

  it('falls back to a single root plugin when the manifest is missing', async () => {
    sourcesStore.addPluginSource({ repo: 'acme/single-plugin' });
    stubFetch(() => new Response('not found', { status: 404 }));

    const listing = await marketplace.searchMarketPlugins();
    expect(listing.entries).toHaveLength(1);
    expect(listing.entries[0]).toMatchObject({
      name: 'single-plugin',
      path: '',
      fallback: true,
    });
  });

  it('reports a source failure for malformed manifests instead of throwing', async () => {
    sourcesStore.addPluginSource({ repo: 'acme/broken' });
    stubFetch((url) =>
      url.endsWith('/openawork-plugins.json')
        ? jsonResponse({ plugins: [{ name: '' }] })
        : new Response('nope', { status: 404 }),
    );

    const listing = await marketplace.searchMarketPlugins();
    expect(listing.entries).toHaveLength(0);
    expect(listing.failedSources).toHaveLength(1);
    expect(listing.failedSources[0]?.sourceId).toBe('acme/broken');
  });
});

describe('plugin marketplace detail', () => {
  it('returns the entry with README and repo url', async () => {
    sourcesStore.addPluginSource({ repo: 'acme/plugins' });
    stubFetch((url) => {
      if (url.endsWith('/openawork-plugins.json')) {
        return jsonResponse({ plugins: [{ name: 'echo', path: 'plugins/echo' }] });
      }
      if (url.endsWith('/plugins/echo/README.md')) {
        return new Response('# Echo\n用法说明', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const detail = await marketplace.getMarketEntryDetail('acme/plugins', 'echo');
    expect(detail?.entry.name).toBe('echo');
    expect(detail?.readme).toContain('# Echo');
    expect(detail?.repoUrl).toBe('https://github.com/acme/plugins');

    expect(await marketplace.getMarketEntryDetail('acme/plugins', 'missing')).toBeNull();
    expect(await marketplace.getMarketEntryDetail('unknown/source', 'echo')).toBeNull();
  });
});

afterAll(async () => {
  await db.closeDb();
});
