/**
 * Plugin configuration grammar + source resolution.
 *
 * Pins down the declarative `plugins` array (openawork.json) aligned
 * with opencode v2:
 *   "pkg" / { package, options } → add
 *   "-pkg" / "-*" / "-scope.*"   → removal selectors
 * and the local source resolver (file / directory entrypoint / package).
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesRemovalSelector, parsePluginConfig } from '../../plugin/config.js';
import { resolvePluginSpec } from '../../plugin/source.js';

describe('plugin config grammar', () => {
  it('parses string entries, object entries, removals and enable selectors', () => {
    const parsed = parsePluginConfig([
      'pkg-a',
      { package: './local/plugin', options: { strict: true } },
      '-pkg-b',
      '*',
      'scope.*',
    ]);

    expect(parsed.adds).toEqual([
      { target: 'pkg-a', options: {} },
      { target: './local/plugin', options: { strict: true } },
    ]);
    expect(parsed.removals).toEqual(['pkg-b']);
    expect(parsed.enables).toEqual(['*', 'scope.*']);
  });

  it('treats a missing or null plugins array as empty config', () => {
    expect(parsePluginConfig(undefined)).toEqual({ adds: [], removals: [], enables: [] });
    expect(parsePluginConfig(null)).toEqual({ adds: [], removals: [], enables: [] });
  });

  it('rejects malformed entries with a path into the array', () => {
    expect(() => parsePluginConfig('not-an-array')).toThrow(/"plugins" must be an array/);
    expect(() => parsePluginConfig([''])).toThrow(/plugins\[0\]/);
    expect(() => parsePluginConfig(['-'])).toThrow(/removal requires a target/);
    expect(() => parsePluginConfig([{ options: {} }])).toThrow(/non-empty "package"/);
    expect(() => parsePluginConfig([42])).toThrow(/string or \{ package, options \}/);
  });

  it('matches removal selectors: exact, wildcard and prefix.*', () => {
    expect(matchesRemovalSelector('pkg-a', 'pkg-a')).toBe(true);
    expect(matchesRemovalSelector('pkg-a', 'pkg-b')).toBe(false);
    expect(matchesRemovalSelector('*', 'anything')).toBe(true);
    expect(matchesRemovalSelector('@scope.*', '@scope.pkg')).toBe(true);
    expect(matchesRemovalSelector('@scope.*', '@other/pkg')).toBe(false);
  });
});

describe('plugin source resolution', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'openawork-plugin-source-'));
    await writeFile(join(dir, 'single.mjs'), 'export default {};\n', 'utf8');
    await mkdir(join(dir, 'plugin-dir'));
    await writeFile(join(dir, 'plugin-dir', 'index.mjs'), 'export default {};\n', 'utf8');
    await mkdir(join(dir, 'empty-dir'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves a file spec to a file:// URL with a watch path', async () => {
    const resolved = await resolvePluginSpec('./single.mjs', dir);
    expect(resolved?.kind).toBe('file');
    expect(resolved?.entrypoint.startsWith('file://')).toBe(true);
    expect(resolved?.watchPath).toBe(join(dir, 'single.mjs'));
  });

  it('resolves a directory spec through its entrypoint candidate', async () => {
    const resolved = await resolvePluginSpec('./plugin-dir', dir);
    expect(resolved?.kind).toBe('directory');
    expect(resolved?.entrypoint.endsWith('index.mjs')).toBe(true);
  });

  it('returns null for missing paths and entrypoint-less directories', async () => {
    expect(await resolvePluginSpec('./missing.mjs', dir)).toBeNull();
    expect(await resolvePluginSpec('./empty-dir', dir)).toBeNull();
  });

  it('passes bare package specifiers through untouched', async () => {
    const resolved = await resolvePluginSpec('@scope/some-plugin', dir);
    expect(resolved).toEqual({
      spec: '@scope/some-plugin',
      kind: 'package',
      entrypoint: '@scope/some-plugin',
    });
  });
});
