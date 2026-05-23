import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectoryAgentsInjectorImpl } from './directory-agents-injector.js';

describe('DirectoryAgentsInjectorImpl', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('collects instructions from the workspace root and descendant directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oa-work-agents-'));
    tempDirs.push(root);

    await writeFile(path.join(root, 'AGENTS.md'), 'root instructions');
    await mkdir(path.join(root, 'apps/web'), { recursive: true });
    await writeFile(path.join(root, 'apps/web', 'AGENTS.md'), 'web instructions');
    await mkdir(path.join(root, 'packages/shared'), { recursive: true });
    await writeFile(path.join(root, 'packages/shared', 'CLAUDE.md'), 'shared instructions');
    await writeFile(path.join(root, 'README.md'), 'ignore me');

    const injector = new DirectoryAgentsInjectorImpl();
    const entries = await injector.collectAllAgentsFiles(root, root);

    expect(entries.map((entry) => path.relative(root, entry.filePath))).toEqual([
      'AGENTS.md',
      path.join('apps', 'web', 'AGENTS.md'),
      path.join('packages', 'shared', 'CLAUDE.md'),
    ]);
    expect(entries.map((entry) => entry.content)).toEqual([
      'root instructions',
      'web instructions',
      'shared instructions',
    ]);
    expect(injector.buildInjectionBlock(entries)).toContain('Instructions from:');
  });

  it('returns an empty list when no instructions files exist', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oa-work-empty-'));
    tempDirs.push(root);

    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'notes.md'), 'nope');

    const injector = new DirectoryAgentsInjectorImpl();
    await expect(injector.collectAllAgentsFiles(root, root)).resolves.toEqual([]);
    expect(injector.buildInjectionBlock([])).toBe('');
  });
});
