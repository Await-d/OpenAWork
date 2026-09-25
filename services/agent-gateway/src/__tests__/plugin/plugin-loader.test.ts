/**
 * Plugin loader + hot reload.
 *
 * Pins down:
 *   1. Loading from the env list, from discovered `<pluginsDir>/*`
 *      directories, and config-file removals filtering discovered
 *      sources.
 *   2. Missing paths are reported as `skipped` and never throw.
 *   3. Hot reload: editing a plugin file (same id) re-activates it
 *      without a gateway restart — hook behaviour switches to the new
 *      file contents.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins, startPluginHotReload } from '../../plugin/loader.js';
import { _resetPluginsForTest, dispatchToolExecuteBefore } from '../../runtime/plugin-host.js';

const DOCS_GUARD_EXAMPLE = fileURLToPath(
  new URL('../../../../../docs/plugins/examples/guard-plugin.mjs', import.meta.url),
);

const V1_PLUGIN = `
export default {
  id: 'temp-hot',
  setup(ctx) {
    ctx.tool.hook('execute.before', (event) => {
      event.args = { version: 'v1' };
    });
  },
};
`;

const V2_PLUGIN = `
export default {
  id: 'temp-hot',
  setup(ctx) {
    ctx.tool.hook('execute.before', (event) => {
      event.args = { version: 'v2' };
    });
  },
};
`;

describe('plugin loader', () => {
  let dir: string;

  beforeEach(async () => {
    _resetPluginsForTest();
    dir = await mkdtemp(join(tmpdir(), 'openawork-plugin-loader-'));
  });

  afterEach(async () => {
    _resetPluginsForTest();
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a plugin from the env list', async () => {
    const file = join(dir, 'env-plugin.mjs');
    await writeFile(file, V1_PLUGIN, 'utf8');

    const outcome = await loadPlugins({
      configPath: join(dir, 'missing.json'),
      pluginsDir: join(dir, 'no-plugins'),
      envPlugins: file,
    });

    expect(outcome.active).toHaveLength(1);
    expect(outcome.active[0]?.pluginId).toBe('temp-hot');
  });

  it('discovers plugin directories with a known entrypoint', async () => {
    const pluginsDir = join(dir, 'plugins');
    await mkdir(join(pluginsDir, 'my-plugin'), { recursive: true });
    await writeFile(join(pluginsDir, 'my-plugin', 'index.mjs'), V1_PLUGIN, 'utf8');

    const outcome = await loadPlugins({
      configPath: join(dir, 'missing.json'),
      pluginsDir,
      envPlugins: '',
    });

    expect(outcome.active).toHaveLength(1);
    expect(outcome.active[0]?.spec).toBe(join(pluginsDir, 'my-plugin'));
  });

  it('applies config removals to discovered sources', async () => {
    const pluginsDir = join(dir, 'plugins');
    await mkdir(join(pluginsDir, 'my-plugin'), { recursive: true });
    await writeFile(join(pluginsDir, 'my-plugin', 'index.mjs'), V1_PLUGIN, 'utf8');
    const configPath = join(dir, 'openawork.json');
    await writeFile(configPath, JSON.stringify({ plugins: ['-my-plugin'] }), 'utf8');

    const outcome = await loadPlugins({ configPath, pluginsDir, envPlugins: '' });

    expect(outcome.active).toHaveLength(0);
    expect(outcome.skipped.some((item) => item.reason === 'removed by config')).toBe(true);
  });

  it('lets an explicit enable selector override a bulk removal', async () => {
    const pluginsDir = join(dir, 'plugins');
    await mkdir(join(pluginsDir, 'keep-me'), { recursive: true });
    await mkdir(join(pluginsDir, 'drop-me'), { recursive: true });
    await writeFile(join(pluginsDir, 'keep-me', 'index.mjs'), V1_PLUGIN, 'utf8');
    await writeFile(
      join(pluginsDir, 'drop-me', 'index.mjs'),
      V1_PLUGIN.replace('temp-hot', 'dropped-plugin'),
      'utf8',
    );
    const configPath = join(dir, 'openawork.json');
    await writeFile(configPath, JSON.stringify({ plugins: ['-*', 'keep-me'] }), 'utf8');

    const outcome = await loadPlugins({ configPath, pluginsDir, envPlugins: '' });

    expect(outcome.active).toHaveLength(1);
    expect(outcome.active[0]?.spec).toBe(join(pluginsDir, 'keep-me'));
    expect(outcome.skipped.some((item) => item.reason === 'removed by config')).toBe(true);
  });

  it('reports missing paths as skipped without throwing', async () => {
    const outcome = await loadPlugins({
      configPath: join(dir, 'missing.json'),
      pluginsDir: join(dir, 'no-plugins'),
      envPlugins: join(dir, 'nope.mjs'),
    });

    expect(outcome.active).toHaveLength(0);
    expect(outcome.skipped[0]?.reason).toBe('path not found');
  });

  it('loads the documented guard example end-to-end', async () => {
    const outcome = await loadPlugins({
      configPath: join(dir, 'missing.json'),
      pluginsDir: join(dir, 'no-plugins'),
      envPlugins: DOCS_GUARD_EXAMPLE,
    });
    expect(outcome.active).toHaveLength(1);
    expect(outcome.active[0]?.pluginId).toBe('example.guard');

    const blocked = { args: { path: '/repo/.env' } as unknown };
    await dispatchToolExecuteBefore({ tool: 'read', sessionID: 's1', callID: 'c1' }, blocked);
    expect((blocked.args as Record<string, unknown>)['path']).toBe('/dev/null');

    const allowed = { args: { path: '/repo/src/index.ts' } as unknown };
    await dispatchToolExecuteBefore({ tool: 'read', sessionID: 's1', callID: 'c1' }, allowed);
    expect((allowed.args as Record<string, unknown>)['path']).toBe('/repo/src/index.ts');
  });

  it('hot-reloads a changed plugin file without a restart', async () => {
    const file = join(dir, 'hot-plugin.mjs');
    await writeFile(file, V1_PLUGIN, 'utf8');

    const outcome = await loadPlugins({
      configPath: join(dir, 'missing.json'),
      pluginsDir: join(dir, 'no-plugins'),
      envPlugins: file,
    });
    expect(outcome.active).toHaveLength(1);

    const handle = await startPluginHotReload(outcome);
    try {
      const before = { args: {} as unknown };
      await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, before);
      expect(before.args).toEqual({ version: 'v1' });

      await writeFile(file, V2_PLUGIN, 'utf8');
      await handle.watcher.flushForTest(file);

      const after = { args: {} as unknown };
      await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, after);
      expect(after.args).toEqual({ version: 'v2' });
    } finally {
      handle.stop();
    }
  });
});
