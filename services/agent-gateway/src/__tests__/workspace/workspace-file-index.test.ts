import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import {
  __resetWorkspaceFileIndexCacheForTest,
  collectWorkspaceFileIndex,
  getWorkspaceFileIndex,
  invalidateWorkspaceFileIndex,
  WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES,
  WORKSPACE_FILE_INDEX_CACHE_TTL_MS,
} from '../../workspace/workspace-file-index.js';

const WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES = 1000;

const fixtureRoot = mkdtempSync(join(tmpdir(), 'openawork-file-index-'));

function createFixtureRoot(name: string): string {
  const root = join(fixtureRoot, name);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeFixtureFile(root: string, relativePath: string, content = 'fixture\n'): string {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

const testOnNonWindows = process.platform === 'win32' ? it.skip : it;
// root 用户不受 0o000 权限位限制，无法构造不可读目录。
const runsAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const testWithUnreadableDir = process.platform !== 'win32' && !runsAsRoot ? it : it.skip;

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('collectWorkspaceFileIndex', () => {
  it('按 BFS 顺序返回三层嵌套的扁平相对路径，且不包含目录', async () => {
    const root = createFixtureRoot('nested');
    writeFixtureFile(root, 'a-file.txt');
    writeFixtureFile(root, join('z-dir', 'b-file.txt'));
    writeFixtureFile(root, join('z-dir', 'y-dir', 'c-file.txt'));

    const result = await collectWorkspaceFileIndex({ rootPath: root });

    expect(result.files).toEqual(['a-file.txt', 'z-dir/b-file.txt', 'z-dir/y-dir/c-file.txt']);
    expect(result.truncated).toBe(false);
    expect(result.visited).toBe(5);
  });

  it('跳过 node_modules 与 dist 目录及其内容', async () => {
    const root = createFixtureRoot('ignored-dirs');
    writeFixtureFile(root, 'src/app.ts');
    writeFixtureFile(root, join('node_modules', 'pkg', 'index.js'));
    writeFixtureFile(root, join('dist', 'bundle.js'));

    const result = await collectWorkspaceFileIndex({ rootPath: root });

    expect(result.files).toEqual(['src/app.ts']);
    expect(result.files.some((file) => file.includes('node_modules'))).toBe(false);
    expect(result.files.some((file) => file.startsWith('dist'))).toBe(false);
  });

  it('loadRules 后跳过 .gitignore 命中的文件与目录', async () => {
    const root = createFixtureRoot('ignore-rules');
    writeFixtureFile(root, 'kept.ts');
    writeFixtureFile(root, 'ignored-by-rules.txt');
    writeFixtureFile(root, join('ignored-dir', 'inner.txt'));
    writeFixtureFile(root, '.gitignore', 'ignored-by-rules.txt\nignored-dir/\n');

    await defaultIgnoreManager.loadRules(root);
    const result = await collectWorkspaceFileIndex({ rootPath: root });

    expect(result.files).toContain('kept.ts');
    expect(result.files).not.toContain('ignored-by-rules.txt');
    expect(result.files.some((file) => file.startsWith('ignored-dir'))).toBe(false);
  });

  testOnNonWindows('跳过符号链接，文件链接与目录链接都不返回', async () => {
    const root = createFixtureRoot('symlinks');
    writeFixtureFile(root, 'real.txt');
    writeFixtureFile(root, join('target-dir', 'inside.txt'));
    writeFixtureFile(root, 'target-file.txt');
    symlinkSync(join(root, 'target-dir'), join(root, 'link-dir'));
    symlinkSync(join(root, 'target-file.txt'), join(root, 'link-file.txt'));

    const result = await collectWorkspaceFileIndex({ rootPath: root });

    expect(result.files).toEqual(['real.txt', 'target-file.txt', 'target-dir/inside.txt']);
  });

  it('maxEntries 截断时返回 truncated: true 且 files 长度等于上限', async () => {
    const root = createFixtureRoot('truncated');
    const total = WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES + 25;
    for (let index = 0; index < total; index += 1) {
      writeFixtureFile(root, `file-${String(index).padStart(5, '0')}.txt`);
    }

    const result = await collectWorkspaceFileIndex({
      rootPath: root,
      maxEntries: WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES,
    });

    expect(result.files).toHaveLength(WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES);
    expect(result.truncated).toBe(true);
  });

  it('maxEntries 低于下限时收敛到最小上限', async () => {
    const root = createFixtureRoot('truncated-clamped');
    const total = WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES + 25;
    for (let index = 0; index < total; index += 1) {
      writeFixtureFile(root, `file-${String(index).padStart(5, '0')}.txt`);
    }

    const result = await collectWorkspaceFileIndex({ rootPath: root, maxEntries: 1 });

    expect(result.files).toHaveLength(WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES);
    expect(result.truncated).toBe(true);
  });

  it('根路径不存在时返回空结果且不抛错', async () => {
    const result = await collectWorkspaceFileIndex({
      rootPath: join(fixtureRoot, 'missing-root'),
    });

    expect(result).toEqual({ files: [], truncated: false, visited: 0 });
  });

  it('根路径是文件时返回空结果且不抛错', async () => {
    const rootFile = join(fixtureRoot, 'not-a-directory.txt');
    writeFileSync(rootFile, 'fixture\n', 'utf8');

    const result = await collectWorkspaceFileIndex({ rootPath: rootFile });

    expect(result).toEqual({ files: [], truncated: false, visited: 0 });
  });

  testWithUnreadableDir('目录不可读时跳过该目录且不抛错', async () => {
    const root = createFixtureRoot('unreadable');
    writeFixtureFile(root, 'visible.txt');
    const blockedDir = join(root, 'blocked');
    writeFixtureFile(root, join('blocked', 'hidden.txt'));
    chmodSync(blockedDir, 0o000);

    try {
      const result = await collectWorkspaceFileIndex({ rootPath: root });

      expect(result.files).toEqual(['visible.txt']);
    } finally {
      chmodSync(blockedDir, 0o755);
    }
  });
});

function relativePaths(index: { files: readonly { relativePath: string }[] }): string[] {
  return index.files.map((entry) => entry.relativePath);
}

describe('getWorkspaceFileIndex 缓存', () => {
  beforeEach(() => {
    __resetWorkspaceFileIndexCacheForTest();
  });

  it('派生 label / lowerLabel / lowerPath / depth 与目录集合', async () => {
    const root = createFixtureRoot('cache-derived');
    writeFixtureFile(root, join('apps', 'web', 'src', 'App.tsx'));
    writeFixtureFile(root, 'README.md');

    const index = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });

    expect(index.rootPath).toBe(root);
    expect(index.builtAt).toBe(1_000);
    expect(relativePaths(index)).toEqual(['README.md', 'apps/web/src/App.tsx']);
    expect(index.directories).toEqual(['apps', 'apps/web', 'apps/web/src']);
    expect(index.files.find((entry) => entry.relativePath === 'README.md')).toMatchObject({
      label: 'README.md',
      lowerLabel: 'readme.md',
      lowerPath: 'readme.md',
      depth: 1,
    });
    expect(
      index.files.find((entry) => entry.relativePath === 'apps/web/src/App.tsx'),
    ).toMatchObject({
      label: 'App.tsx',
      lowerLabel: 'app.tsx',
      lowerPath: 'apps/web/src/app.tsx',
      depth: 4,
    });
  });

  it('TTL 内命中缓存，新建文件不可见', async () => {
    const root = createFixtureRoot('cache-hit');
    writeFixtureFile(root, 'first.txt');
    const first = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    expect(relativePaths(first)).toEqual(['first.txt']);

    writeFixtureFile(root, 'second.txt');

    const warm = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    expect(warm).toBe(first);
    expect(relativePaths(warm)).toEqual(['first.txt']);
  });

  it('TTL 到期后重建索引，新建文件可见', async () => {
    const root = createFixtureRoot('cache-expired');
    writeFixtureFile(root, 'first.txt');
    const first = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    writeFixtureFile(root, 'second.txt');

    const rebuilt = await getWorkspaceFileIndex({
      rootPath: root,
      now: 1_000 + WORKSPACE_FILE_INDEX_CACHE_TTL_MS,
    });

    expect(rebuilt).not.toBe(first);
    expect(relativePaths(rebuilt)).toEqual(['first.txt', 'second.txt']);
    expect(rebuilt.builtAt).toBe(1_000 + WORKSPACE_FILE_INDEX_CACHE_TTL_MS);
  });

  it('invalidateWorkspaceFileIndex(root) 后新建文件可见', async () => {
    const root = createFixtureRoot('cache-invalidate-root');
    writeFixtureFile(root, 'first.txt');
    const first = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    writeFixtureFile(root, 'second.txt');

    invalidateWorkspaceFileIndex(root);

    const rebuilt = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    expect(rebuilt).not.toBe(first);
    expect(relativePaths(rebuilt)).toEqual(['first.txt', 'second.txt']);
  });

  it('invalidateWorkspaceFileIndex(无关路径) 保持缓存命中', async () => {
    const root = createFixtureRoot('cache-unrelated');
    writeFixtureFile(root, 'first.txt');
    const first = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    writeFixtureFile(root, 'second.txt');

    invalidateWorkspaceFileIndex(join(fixtureRoot, 'unrelated-path'));

    const warm = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    expect(warm).toBe(first);
    expect(relativePaths(warm)).toEqual(['first.txt']);
  });

  it('invalidateWorkspaceFileIndex 的前缀比较不会误伤同前缀兄弟目录', async () => {
    const root = createFixtureRoot('cache-prefix');
    const sibling = createFixtureRoot('cache-prefix-suffix');
    writeFixtureFile(root, 'first.txt');
    writeFixtureFile(sibling, 'first.txt');
    const rootIndex = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    const siblingIndex = await getWorkspaceFileIndex({ rootPath: sibling, now: 1_000 });

    invalidateWorkspaceFileIndex(root);

    expect(await getWorkspaceFileIndex({ rootPath: root, now: 1_000 })).not.toBe(rootIndex);
    expect(await getWorkspaceFileIndex({ rootPath: sibling, now: 1_000 })).toBe(siblingIndex);
  });

  it('invalidateWorkspaceFileIndex 无参数时清空全部缓存', async () => {
    const root = createFixtureRoot('cache-clear-all');
    writeFixtureFile(root, 'first.txt');
    const first = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });

    invalidateWorkspaceFileIndex();

    expect(await getWorkspaceFileIndex({ rootPath: root, now: 1_000 })).not.toBe(first);
  });

  it('__resetWorkspaceFileIndexCacheForTest 让下一次调用重新构建', async () => {
    const root = createFixtureRoot('cache-reset');
    writeFixtureFile(root, 'first.txt');
    const first = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    writeFixtureFile(root, 'second.txt');

    __resetWorkspaceFileIndexCacheForTest();

    const rebuilt = await getWorkspaceFileIndex({ rootPath: root, now: 1_000 });
    expect(rebuilt).not.toBe(first);
    expect(relativePaths(rebuilt)).toEqual(['first.txt', 'second.txt']);
  });

  it('超过缓存上限时淘汰 builtAt 最小的根目录', async () => {
    const roots: string[] = [];
    for (let index = 0; index <= WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES; index += 1) {
      const root = createFixtureRoot(`cache-evict-${String(index)}`);
      writeFixtureFile(root, 'first.txt');
      roots.push(root);
      await getWorkspaceFileIndex({ rootPath: root, now: 1_000 + index });
    }

    const oldestRoot = roots[0]!;
    writeFixtureFile(oldestRoot, 'second.txt');

    const rebuilt = await getWorkspaceFileIndex({ rootPath: oldestRoot, now: 1_000 });
    expect(relativePaths(rebuilt)).toEqual(['first.txt', 'second.txt']);
  });

  it('多根目录交替服务时忽略规则互不污染（跨根隔离回归）', async () => {
    const rootA = createFixtureRoot('cross-root-a');
    const rootB = createFixtureRoot('cross-root-b');
    for (const root of [rootA, rootB]) {
      writeFixtureFile(root, 'kept.txt');
      writeFixtureFile(root, 'anchored-only-in-a.txt');
      writeFixtureFile(root, join('ignored-dir-a', 'inner.txt'));
    }
    writeFixtureFile(rootA, '.gitignore', '/anchored-only-in-a.txt\nignored-dir-a/\n');
    writeFixtureFile(rootB, '.gitignore', 'nothing-at-all\n');

    await defaultIgnoreManager.loadRules(rootA);
    const firstA = await getWorkspaceFileIndex({ rootPath: rootA, now: 1_000 });
    expect(relativePaths(firstA)).toContain('kept.txt');
    expect(relativePaths(firstA)).not.toContain('anchored-only-in-a.txt');
    expect(relativePaths(firstA).some((path) => path.startsWith('ignored-dir-a'))).toBe(false);

    await defaultIgnoreManager.loadRules(rootB);
    const indexB = await getWorkspaceFileIndex({ rootPath: rootB, now: 1_000 });
    expect(relativePaths(indexB)).toContain('anchored-only-in-a.txt');
    expect(relativePaths(indexB)).toContain('ignored-dir-a/inner.txt');

    invalidateWorkspaceFileIndex(rootA);
    const rebuiltA = await getWorkspaceFileIndex({ rootPath: rootA, now: 2_000 });
    expect(relativePaths(rebuiltA)).toContain('kept.txt');
    expect(relativePaths(rebuiltA)).not.toContain('anchored-only-in-a.txt');
    expect(relativePaths(rebuiltA).some((path) => path.startsWith('ignored-dir-a'))).toBe(false);

    invalidateWorkspaceFileIndex(rootB);
    const rebuiltB = await getWorkspaceFileIndex({ rootPath: rootB, now: 2_000 });
    expect(relativePaths(rebuiltB)).toContain('anchored-only-in-a.txt');
    expect(relativePaths(rebuiltB)).toContain('ignored-dir-a/inner.txt');

    invalidateWorkspaceFileIndex(rootA);
    const rebuiltA2 = await getWorkspaceFileIndex({ rootPath: rootA, now: 3_000 });
    expect(relativePaths(rebuiltA2)).not.toContain('anchored-only-in-a.txt');
    expect(relativePaths(rebuiltA2).some((path) => path.startsWith('ignored-dir-a'))).toBe(false);
  });
});
