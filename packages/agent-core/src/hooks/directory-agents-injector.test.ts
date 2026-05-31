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

describe('DirectoryAgentsInjectorImpl bounds (§0.158)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('忽略 node_modules / .git / dist 等噪声目录（防 monorepo /init-deep 爆量）', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oa-bounds-noise-'));
    tempDirs.push(root);
    await writeFile(path.join(root, 'AGENTS.md'), 'real');
    await mkdir(path.join(root, 'node_modules/some-dep'), { recursive: true });
    await writeFile(path.join(root, 'node_modules/some-dep', 'AGENTS.md'), 'vendored noise');
    await mkdir(path.join(root, '.git/hooks'), { recursive: true });
    await writeFile(path.join(root, '.git/hooks', 'CLAUDE.md'), 'git noise');
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'AGENTS.md'), 'build noise');

    const injector = new DirectoryAgentsInjectorImpl();
    const entries = await injector.collectAllAgentsFiles(root, root);

    expect(entries.map((e) => path.relative(root, e.filePath))).toEqual(['AGENTS.md']);
  });

  it('单个 AGENTS.md 超过 256KB 时被静默跳过（防一行巨页 OOM 网关）', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oa-bounds-bigfile-'));
    tempDirs.push(root);
    // 257KB > MAX_FILE_BYTES (256KB)
    const big = 'x'.repeat(257 * 1024);
    await writeFile(path.join(root, 'AGENTS.md'), big);
    await mkdir(path.join(root, 'apps'), { recursive: true });
    await writeFile(path.join(root, 'apps', 'CLAUDE.md'), 'small ok');

    const injector = new DirectoryAgentsInjectorImpl();
    const entries = await injector.collectAllAgentsFiles(root, root);

    expect(entries.map((e) => path.relative(root, e.filePath))).toEqual([
      path.join('apps', 'CLAUDE.md'),
    ]);
  });

  it('总字节超过 1MB 时停止收集（防 metadata_json 行爆 + LLM 上下文窗口爆）', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oa-bounds-totalbytes-'));
    tempDirs.push(root);
    // 5 个 250KB 文件 -> 1.25MB total > MAX_TOTAL_BYTES (1MB)
    const chunk = 'y'.repeat(250 * 1024);
    for (let i = 0; i < 5; i += 1) {
      const sub = path.join(root, `pkg${i}`);
      await mkdir(sub, { recursive: true });
      await writeFile(path.join(sub, 'AGENTS.md'), chunk);
    }

    const injector = new DirectoryAgentsInjectorImpl();
    const entries = await injector.collectAllAgentsFiles(root, root);

    // 4 个 250KB 文件累计 1MB（恰好等于 cap，第 5 个会触发 cap 退出）
    expect(entries.length).toBeLessThanOrEqual(4);
    const total = entries.reduce((s, e) => s + Buffer.byteLength(e.content, 'utf8'), 0);
    expect(total).toBeLessThanOrEqual(1024 * 1024);
  });
});
