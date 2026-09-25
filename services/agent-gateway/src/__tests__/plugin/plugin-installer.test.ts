/**
 * Plugin installer (`src/plugin/installer.ts`).
 *
 * Pins down:
 *   1. Directory installs copy recursively and validate an entrypoint.
 *   2. Single-file installs become `<installId>/index.<ext>`.
 *   3. Guards: missing source, entrypoint-less directory, unsupported
 *      file type, source already inside the plugins dir, existing
 *      install without `force`.
 *   4. Uninstall removes the installed directory (and is a no-op for
 *      missing ids).
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as InstallerModule from '../../plugin/installer.js';
import type * as SourceModule from '../../plugin/source.js';

// Isolate the plugins root from the developer's real gateway data dir.
const ORIGINAL_DATA_DIR = process.env['OPENAWORK_DATA_DIR'];
process.env['OPENAWORK_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'openawork-plugin-installer-'));

let installer: typeof InstallerModule;
let source: typeof SourceModule;

beforeAll(async () => {
  installer = await import('../../plugin/installer.js');
  source = await import('../../plugin/source.js');
});

afterAll(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env['OPENAWORK_DATA_DIR'];
  else process.env['OPENAWORK_DATA_DIR'] = ORIGINAL_DATA_DIR;
});

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
  // Remove everything installed during the test.
  const pluginsDir = source.resolveGatewayPluginsDir();
  await rm(pluginsDir, { recursive: true, force: true });
});

describe('plugin installer', () => {
  it('installs a directory with an entrypoint and returns the install id', async () => {
    const sourceDir = await makeTempDir('openawork-plugin-src-');
    await writeFile(join(sourceDir, 'index.mjs'), 'export default {};\n', 'utf8');

    const result = await installer.installPluginFromPath(sourceDir);

    expect(result.installId).toBe(basename(sourceDir));
    expect(result.entrypoint.endsWith('index.mjs')).toBe(true);
    const info = await stat(result.entrypoint);
    expect(info.isFile()).toBe(true);
  });

  it('installs a single file as index.<ext>', async () => {
    const sourceDir = await makeTempDir('openawork-plugin-file-src-');
    const file = join(sourceDir, 'my-plugin.mjs');
    await writeFile(file, 'export default {};\n', 'utf8');

    const result = await installer.installPluginFromPath(file);

    expect(result.installId).toBe('my-plugin');
    expect(result.entrypoint.endsWith(join('my-plugin', 'index.mjs'))).toBe(true);
  });

  it('rejects a directory without an entrypoint', async () => {
    const sourceDir = await makeTempDir('openawork-plugin-empty-src-');
    await mkdir(join(sourceDir, 'nested'), { recursive: true });

    await expect(installer.installPluginFromPath(sourceDir)).rejects.toThrow(
      /No plugin entrypoint found/,
    );
  });

  it('rejects unsupported single-file types and missing sources', async () => {
    const sourceDir = await makeTempDir('openawork-plugin-bad-src-');
    const txt = join(sourceDir, 'plugin.txt');
    await writeFile(txt, 'not a plugin\n', 'utf8');

    await expect(installer.installPluginFromPath(txt)).rejects.toThrow(
      /Unsupported plugin file type/,
    );
    await expect(installer.installPluginFromPath(join(sourceDir, 'nope.mjs'))).rejects.toThrow(
      /source not found/i,
    );
  });

  it('requires force to overwrite an existing install', async () => {
    const sourceDir = await makeTempDir('openawork-plugin-overwrite-');
    await writeFile(join(sourceDir, 'index.mjs'), 'export default {};\n', 'utf8');

    const first = await installer.installPluginFromPath(sourceDir);
    await expect(installer.installPluginFromPath(sourceDir)).rejects.toThrow(/already installed/);

    const overwritten = await installer.installPluginFromPath(sourceDir, { force: true });
    expect(overwritten.installId).toBe(first.installId);
  });

  it('uninstalls an installed plugin and no-ops for missing ids', async () => {
    const sourceDir = await makeTempDir('openawork-plugin-uninstall-');
    await writeFile(join(sourceDir, 'index.mjs'), 'export default {};\n', 'utf8');
    const installed = await installer.installPluginFromPath(sourceDir);

    expect(await installer.uninstallInstalledPlugin(installed.installId)).toBe(true);
    expect(await installer.uninstallInstalledPlugin(installed.installId)).toBe(false);
  });

  it('sanitizes install ids and confines writes to the plugins root', async () => {
    expect(() => installer.sanitizeInstallId('../escape')).toThrow(/Invalid plugin install id/);
    expect(() => installer.sanitizeInstallId('')).toThrow(/Invalid plugin install id/);

    const outside = join(tmpdir(), 'outside-plugin');
    expect(installer.isInsidePluginsDir(outside)).toBe(false);
  });
});
