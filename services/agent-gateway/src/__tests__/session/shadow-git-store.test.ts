import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = promisify(execFileCallback);

// 重定向 storage-paths 到临时数据目录
let dataDir: string;

vi.mock('../../infra/storage-paths.js', () => ({
  resolveGatewayDataDir: () => dataDir,
  resolveGatewayDatabasePath: () => join(dataDir, 'test.db'),
  resolveGatewayArtifactsDir: () => join(dataDir, 'artifacts'),
  resolveGatewayArtifactsIndexPath: () => join(dataDir, 'artifacts-index.json'),
  resolveGatewayFileBackupsDir: () => join(dataDir, 'file-backups'),
  resolveGatewayReposDir: () => join(dataDir, 'repos'),
}));

let workspaceRoot: string;

// 同步检测 git 可用性，确保 it.skipIf 在测试定义时拿到正确值
const gitAvailable = (() => {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf8' });
    return /git version/.test(out);
  } catch {
    return false;
  }
})();

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'shadow-git-data-'));
  workspaceRoot = await mkdtemp(join(tmpdir(), 'shadow-git-ws-'));
  // 初始化为 git repo（避免 ls-files --others 出错）
  if (gitAvailable) {
    await execFile('git', ['init', '-q', workspaceRoot]);
    await execFile('git', ['-C', workspaceRoot, 'config', 'user.email', 'test@example.com']);
    await execFile('git', ['-C', workspaceRoot, 'config', 'user.name', 'Test']);
  }
});

afterEach(async () => {
  // Reset module state between tests
  const mod = await import('../../snapshot/shadow-git-store.js');
  mod.__resetShadowGitStoreForTests();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
});

describe('shadow-git-store', () => {
  it('isAvailable reflects git presence on system', async () => {
    const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
    const store = createShadowGitStore();
    const available = await store.isAvailable();
    expect(available).toBe(gitAvailable);
  });

  it.skipIf(!gitAvailable)(
    'capture returns a stable hash and detects subsequent file changes',
    async () => {
      const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
      const store = createShadowGitStore();

      await writeFile(join(workspaceRoot, 'a.txt'), 'first content\n');
      const hash1 = await store.capture(workspaceRoot);
      expect(hash1).toMatch(/^[0-9a-f]{40,64}$/);

      // 二次捕获（无变更）：tree hash 应当相同
      const hash1Again = await store.capture(workspaceRoot);
      expect(hash1Again).toBe(hash1);

      await writeFile(join(workspaceRoot, 'a.txt'), 'second content\n');
      const hash2 = await store.capture(workspaceRoot);
      expect(hash2).not.toBe(hash1);
    },
  );

  it.skipIf(!gitAvailable)('diff produces structured patches', async () => {
    const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
    const store = createShadowGitStore();

    await writeFile(join(workspaceRoot, 'a.txt'), 'hello\nworld\n');
    const baseHash = await store.capture(workspaceRoot);

    await writeFile(join(workspaceRoot, 'a.txt'), 'hello\nworld\nadded\n');
    await writeFile(join(workspaceRoot, 'b.txt'), 'brand new\n');
    const newHash = await store.capture(workspaceRoot);

    const patches = await store.diff(workspaceRoot, baseHash, newHash);
    const byFile = new Map(patches.map((p) => [p.file, p]));
    expect(byFile.get('a.txt')?.status).toBe('modified');
    expect(byFile.get('b.txt')?.status).toBe('added');
  });

  it.skipIf(!gitAvailable)('diffFull returns before/after content with line counts', async () => {
    const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
    const store = createShadowGitStore();

    await writeFile(join(workspaceRoot, 'a.txt'), 'one\ntwo\n');
    const before = await store.capture(workspaceRoot);

    await writeFile(join(workspaceRoot, 'a.txt'), 'one\ntwo\nthree\n');
    const after = await store.capture(workspaceRoot);

    const diffs = await store.diffFull(workspaceRoot, before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.file).toBe('a.txt');
    expect(diffs[0]?.before).toBe('one\ntwo\n');
    expect(diffs[0]?.after).toBe('one\ntwo\nthree\n');
    expect(diffs[0]?.additions).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!gitAvailable)('readFileAt reads file contents at a specific snapshot', async () => {
    const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
    const store = createShadowGitStore();

    await writeFile(join(workspaceRoot, 'a.txt'), 'snapshot one\n');
    const hash = await store.capture(workspaceRoot);

    // 修改但不再次 capture
    await writeFile(join(workspaceRoot, 'a.txt'), 'snapshot two\n');

    const content = await store.readFileAt(workspaceRoot, hash, 'a.txt');
    expect(content).toBe('snapshot one\n');

    const missing = await store.readFileAt(workspaceRoot, hash, 'nonexistent.txt');
    expect(missing).toBeNull();
  });

  it.skipIf(!gitAvailable)('restoreFile reverts content to the snapshot version', async () => {
    const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
    const store = createShadowGitStore();

    await writeFile(join(workspaceRoot, 'a.txt'), 'original\n');
    const hash = await store.capture(workspaceRoot);

    await writeFile(join(workspaceRoot, 'a.txt'), 'corrupted\n');
    await store.restoreFile(workspaceRoot, hash, 'a.txt');

    const restored = await readFile(join(workspaceRoot, 'a.txt'), 'utf8');
    expect(restored).toBe('original\n');
  });

  it.skipIf(!gitAvailable)(
    'restoreSelective restores multiple files and optionally deletes missing ones',
    async () => {
      const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
      const store = createShadowGitStore();

      await writeFile(join(workspaceRoot, 'keep.txt'), 'keep-base\n');
      await writeFile(join(workspaceRoot, 'remove.txt'), 'remove-base\n');
      const hash = await store.capture(workspaceRoot);

      // 修改 keep, 创建新文件 newly.txt
      await writeFile(join(workspaceRoot, 'keep.txt'), 'modified\n');
      await writeFile(join(workspaceRoot, 'newly.txt'), 'newly added\n');

      await store.restoreSelective(workspaceRoot, hash, ['keep.txt', 'newly.txt'], {
        deleteMissing: true,
      });

      expect(await readFile(join(workspaceRoot, 'keep.txt'), 'utf8')).toBe('keep-base\n');
      // newly.txt 应被删除（在 hash 快照里不存在）
      await expect(readFile(join(workspaceRoot, 'newly.txt'), 'utf8')).rejects.toThrow();
    },
  );

  it.skipIf(!gitAvailable)('capture skips files exceeding the size limit', async () => {
    const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
    const store = createShadowGitStore();

    const big = Buffer.alloc(8 * 1024)
      .fill('x')
      .toString();
    await writeFile(join(workspaceRoot, 'small.txt'), 'small\n');
    await writeFile(join(workspaceRoot, 'big.txt'), big);

    const hash = await store.capture(workspaceRoot, { fileSizeLimit: 4 * 1024 });

    const small = await store.readFileAt(workspaceRoot, hash, 'small.txt');
    const bigContent = await store.readFileAt(workspaceRoot, hash, 'big.txt');
    expect(small).toBe('small\n');
    expect(bigContent).toBeNull();
  });

  it.skipIf(!gitAvailable)('capture handles nested directories correctly', async () => {
    const { createShadowGitStore } = await import('../../snapshot/shadow-git-store.js');
    const store = createShadowGitStore();

    await mkdir(join(workspaceRoot, 'src', 'nested'), { recursive: true });
    await writeFile(join(workspaceRoot, 'src', 'nested', 'deep.txt'), 'deep\n');

    const hash = await store.capture(workspaceRoot);
    const content = await store.readFileAt(workspaceRoot, hash, 'src/nested/deep.txt');
    expect(content).toBe('deep\n');
  });
});
