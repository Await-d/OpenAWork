/**
 * `GET /plugins` — plugin status projection.
 *
 * Pins down:
 *   1. The route requires authentication.
 *   2. Active and failed plugins are projected with runtime state.
 *   3. Guarded (internal) plugins carry the `guarded` flag.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { define as definePromise } from '@openAwork/plugin-sdk';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as PluginsRoutesModule from '../../routes/plugins.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'plugins-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

// Isolate the plugin root from the developer's real gateway data dir.
const ORIGINAL_DATA_DIR = process.env['OPENAWORK_DATA_DIR'];
process.env['OPENAWORK_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'openawork-plugins-routes-'));

afterAll(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env['OPENAWORK_DATA_DIR'];
  else process.env['OPENAWORK_DATA_DIR'] = ORIGINAL_DATA_DIR;
});

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let pluginsRoutes: typeof PluginsRoutesModule.pluginsRoutes;

const USER_ID = 'u-plugins-routes';

interface PluginProjection {
  readonly id: string;
  readonly source?: string;
  readonly state: { readonly status: string; readonly error?: string };
  readonly guarded: boolean;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(pluginsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'plugins@example.com' })}`;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  pluginsRoutes = (await import('../../routes/plugins.js')).pluginsRoutes;
});

beforeEach(async () => {
  const { _resetPluginsForTest } = await import('../../runtime/plugin-host.js');
  const { clearPluginMarketCache } = await import('../../plugin/marketplace.js');
  _resetPluginsForTest();
  clearPluginMarketCache();
  delete process.env['OPENAWORK_PLUGINS'];
  dbModule.sqliteRun('DELETE FROM plugin_state', []);
  dbModule.sqliteRun('DELETE FROM plugin_sources', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /plugins', () => {
  it('requires authentication', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/plugins' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('projects active and failed plugins with guarded flags', async () => {
    const { getPluginRegistry } = await import('../../plugin/registry.js');
    const { markPluginGuarded } = await import('../../plugin/supervisor.js');
    const registry = getPluginRegistry();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await registry.activate(definePromise({ id: 'ok-plugin', setup: () => undefined }), {
        source: 'test-ok',
      });
      await registry.activate(
        definePromise({
          id: 'bad-plugin',
          setup() {
            throw new Error('setup exploded');
          },
        }),
        { source: 'test-bad' },
      );
      markPluginGuarded('ok-plugin');
    } finally {
      warnSpy.mockRestore();
    }

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/plugins',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);

      const body = response.json() as { plugins: PluginProjection[] };
      const ok = body.plugins.find((entry) => entry.id === 'ok-plugin');
      expect(ok?.state.status).toBe('active');
      expect(ok?.source).toBe('test-ok');
      expect(ok?.guarded).toBe(true);

      const bad = body.plugins.find((entry) => entry.id === 'bad-plugin');
      expect(bad?.state.status).toBe('failed');
      expect(bad?.state.error).toContain('setup exploded');
      expect(bad?.guarded).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('plugin management endpoints', () => {
  const INSTALLED_PLUGIN_SOURCE = `
export default {
  id: 'route-installed-plugin',
  setup() {},
};
`;

  it('installs, lists, reloads and uninstalls a plugin', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sourceDir = await mkdtemp(join(tmpdir(), 'openawork-plugins-admin-src-'));
    const app = await buildApp();
    try {
      await writeFile(join(sourceDir, 'index.mjs'), INSTALLED_PLUGIN_SOURCE, 'utf8');
      const installId = sourceDir.split('/').pop() ?? '';

      // Install → active.
      const installResponse = await app.inject({
        method: 'POST',
        url: '/plugins/install',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { path: sourceDir },
      });
      expect(installResponse.statusCode).toBe(200);
      const installBody = installResponse.json() as {
        install: { installId: string };
        plugin: { id: string; state: { status: string } } | null;
      };
      expect(installBody.install.installId).toBe(installId);
      expect(installBody.plugin?.id).toBe('route-installed-plugin');
      expect(installBody.plugin?.state.status).toBe('active');

      // The list projection exposes the install id.
      const listResponse = await app.inject({
        method: 'GET',
        url: '/plugins',
        headers: { authorization: bearer(app) },
      });
      const listed = (
        listResponse.json() as { plugins: (PluginProjection & { installId?: string })[] }
      ).plugins.find((entry) => entry.installId === installId);
      expect(listed?.id).toBe('route-installed-plugin');

      // Manual reload keeps it active.
      const reloadResponse = await app.inject({
        method: 'POST',
        url: `/plugins/${encodeURIComponent(installId)}/reload`,
        headers: { authorization: bearer(app) },
      });
      expect(reloadResponse.statusCode).toBe(200);
      expect((reloadResponse.json() as { reloaded: boolean }).reloaded).toBe(true);

      // Uninstall removes it from the list.
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/plugins/${encodeURIComponent(installId)}`,
        headers: { authorization: bearer(app) },
      });
      expect(deleteResponse.statusCode).toBe(200);

      const afterResponse = await app.inject({
        method: 'GET',
        url: '/plugins',
        headers: { authorization: bearer(app) },
      });
      const remaining = (
        afterResponse.json() as { plugins: (PluginProjection & { installId?: string })[] }
      ).plugins.find((entry) => entry.installId === installId);
      expect(remaining).toBeUndefined();
    } finally {
      await app.close();
      await rm(sourceDir, { recursive: true, force: true });
      warningSpy.mockRestore();
    }
  });

  it('disables and re-enables an installed plugin', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sourceDir = await mkdtemp(join(tmpdir(), 'openawork-plugins-toggle-src-'));
    const app = await buildApp();
    try {
      await writeFile(join(sourceDir, 'index.mjs'), INSTALLED_PLUGIN_SOURCE, 'utf8');

      const installResponse = await app.inject({
        method: 'POST',
        url: '/plugins/install',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { path: sourceDir },
      });
      expect(installResponse.statusCode).toBe(200);
      const pluginId = (installResponse.json() as { plugin: { id: string } }).plugin.id;

      // Disable → GET projects `disabled`.
      const disableResponse = await app.inject({
        method: 'POST',
        url: `/plugins/${encodeURIComponent(pluginId)}/disable`,
        headers: { authorization: bearer(app) },
      });
      expect(disableResponse.statusCode).toBe(200);

      const afterDisable = await app.inject({
        method: 'GET',
        url: '/plugins',
        headers: { authorization: bearer(app) },
      });
      const disabledEntry = (afterDisable.json() as { plugins: PluginProjection[] }).plugins.find(
        (entry) => entry.id === pluginId,
      );
      expect(disabledEntry?.state.status).toBe('disabled');

      // Enable → back to active.
      const enableResponse = await app.inject({
        method: 'POST',
        url: `/plugins/${encodeURIComponent(pluginId)}/enable`,
        headers: { authorization: bearer(app) },
      });
      expect(enableResponse.statusCode).toBe(200);
      expect((enableResponse.json() as { enabled: boolean }).enabled).toBe(true);

      const afterEnable = await app.inject({
        method: 'GET',
        url: '/plugins',
        headers: { authorization: bearer(app) },
      });
      const enabledEntry = (afterEnable.json() as { plugins: PluginProjection[] }).plugins.find(
        (entry) => entry.id === pluginId,
      );
      expect(enabledEntry?.state.status).toBe('active');
    } finally {
      await app.close();
      await rm(sourceDir, { recursive: true, force: true });
      warningSpy.mockRestore();
    }
  });

  it('returns 404 for reload/uninstall of an unknown plugin and 400 for a missing source', async () => {
    const app = await buildApp();
    try {
      const reloadResponse = await app.inject({
        method: 'POST',
        url: '/plugins/unknown-plugin/reload',
        headers: { authorization: bearer(app) },
      });
      expect(reloadResponse.statusCode).toBe(404);

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: '/plugins/unknown-plugin',
        headers: { authorization: bearer(app) },
      });
      expect(deleteResponse.statusCode).toBe(404);

      const installResponse = await app.inject({
        method: 'POST',
        url: '/plugins/install',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { path: '/definitely/not/a/plugin/path' },
      });
      expect(installResponse.statusCode).toBe(400);

      const disableResponse = await app.inject({
        method: 'POST',
        url: '/plugins/unknown-plugin/disable',
        headers: { authorization: bearer(app) },
      });
      expect(disableResponse.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('plugin market endpoints', () => {
  it('manages market sources, lists entries and returns entry detail', async () => {
    const app = await buildApp();
    try {
      const addResponse = await app.inject({
        method: 'POST',
        url: '/plugins/market/sources',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { repo: 'acme/plugins' },
      });
      expect(addResponse.statusCode).toBe(200);
      expect((addResponse.json() as { source: { id: string } }).source.id).toBe('acme/plugins');

      const listResponse = await app.inject({
        method: 'GET',
        url: '/plugins/market/sources',
        headers: { authorization: bearer(app) },
      });
      expect((listResponse.json() as { sources: unknown[] }).sources).toHaveLength(1);

      const badResponse = await app.inject({
        method: 'POST',
        url: '/plugins/market/sources',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { repo: 'not a repo' },
      });
      expect(badResponse.statusCode).toBe(400);

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith('/openawork-plugins.json')) {
            return new Response(
              JSON.stringify({ plugins: [{ name: 'echo', path: 'plugins/echo' }] }),
              { status: 200 },
            );
          }
          if (url.endsWith('/plugins/echo/README.md')) {
            return new Response('# Echo', { status: 200 });
          }
          return new Response('not found', { status: 404 });
        }),
      );

      const marketResponse = await app.inject({
        method: 'GET',
        url: '/plugins/market',
        headers: { authorization: bearer(app) },
      });
      expect(marketResponse.statusCode).toBe(200);
      const listing = marketResponse.json() as { entries: Array<{ name: string; path: string }> };
      expect(listing.entries.map((entry) => entry.name)).toEqual(['echo']);

      const detailResponse = await app.inject({
        method: 'GET',
        url: '/plugins/market/entry?sourceId=acme%2Fplugins&name=echo',
        headers: { authorization: bearer(app) },
      });
      expect(detailResponse.statusCode).toBe(200);
      const detail = detailResponse.json() as { readme?: string; repoUrl: string };
      expect(detail.readme).toContain('# Echo');
      expect(detail.repoUrl).toBe('https://github.com/acme/plugins');

      const missingDetail = await app.inject({
        method: 'GET',
        url: '/plugins/market/entry?sourceId=acme%2Fplugins&name=missing',
        headers: { authorization: bearer(app) },
      });
      expect(missingDetail.statusCode).toBe(404);

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/plugins/market/sources/${encodeURIComponent('acme/plugins')}`,
        headers: { authorization: bearer(app) },
      });
      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toEqual({ removed: true });
    } finally {
      await app.close();
    }
  });

  it('installs a plugin from a GitHub zipball and activates it', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const archive = zipSync({
      'acme-plugins-sha123/plugins/route-github/index.mjs': strToU8(
        "export default { id: 'route-github-plugin', setup() {} };\n",
      ),
      'acme-plugins-sha123/plugins/route-github/extra.txt': strToU8('extra'),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.github.com')) {
          return new Response(archive, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const app = await buildApp();
    try {
      const installResponse = await app.inject({
        method: 'POST',
        url: '/plugins/install/github',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { repo: 'acme/plugins', path: 'plugins/route-github' },
      });
      expect(installResponse.statusCode).toBe(200);
      const body = installResponse.json() as {
        install: { installId: string; entrypoint: string };
        source: { repo: string; path: string };
        plugin: { id: string; state: { status: string } } | null;
      };
      expect(body.install.installId).toBe('route-github');
      expect(body.install.entrypoint.endsWith('index.mjs')).toBe(true);
      expect(body.source).toEqual({ repo: 'acme/plugins', path: 'plugins/route-github' });
      expect(body.plugin?.id).toBe('route-github-plugin');
      expect(body.plugin?.state.status).toBe('active');

      const listResponse = await app.inject({
        method: 'GET',
        url: '/plugins',
        headers: { authorization: bearer(app) },
      });
      const installed = (
        listResponse.json() as { plugins: (PluginProjection & { installId?: string })[] }
      ).plugins.find((entry) => entry.id === 'route-github-plugin');
      expect(installed?.installId).toBe('route-github');

      // Uninstall keeps the flow symmetric with the local install path.
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/plugins/${encodeURIComponent('route-github')}`,
        headers: { authorization: bearer(app) },
      });
      expect(deleteResponse.statusCode).toBe(200);
    } finally {
      await app.close();
      warningSpy.mockRestore();
    }
  });

  it('rejects a GitHub install whose subpath does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(zipSync({ 'acme-x/README.md': strToU8('# x') }), { status: 200 }),
      ),
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/plugins/install/github',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { repo: 'acme/plugins', path: 'plugins/missing' },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
