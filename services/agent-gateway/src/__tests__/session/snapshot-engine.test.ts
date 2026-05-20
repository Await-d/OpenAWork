import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ShadowGitStore,
  ShadowGitFileDiff,
  ShadowGitFilePatch,
  TreeHash,
} from '../../snapshot/shadow-git-store.js';
import type * as shadowGitStoreModule from '../../snapshot/shadow-git-store.js';

class FakeShadowGit implements ShadowGitStore {
  available = true;
  captures: TreeHash[] = ['hash-0'];
  files: Map<TreeHash, Map<string, string>> = new Map([['hash-0', new Map()]]);

  async isAvailable() {
    return this.available;
  }
  async init() {
    /* noop */
  }
  async capture() {
    const next = `hash-${this.captures.length}`;
    this.captures.push(next);
    this.files.set(next, new Map(this.files.get(this.captures[this.captures.length - 2]!) ?? []));
    return next;
  }
  async diff(): Promise<ShadowGitFilePatch[]> {
    return [];
  }
  async diffFull(
    _workspaceRoot: string,
    from: TreeHash,
    to: TreeHash,
  ): Promise<ShadowGitFileDiff[]> {
    const fromMap = this.files.get(from) ?? new Map<string, string>();
    const toMap = this.files.get(to) ?? new Map<string, string>();
    const allFiles = new Set([...fromMap.keys(), ...toMap.keys()]);
    const result: ShadowGitFileDiff[] = [];
    for (const file of allFiles) {
      const before = fromMap.get(file) ?? '';
      const after = toMap.get(file) ?? '';
      if (before === after) continue;
      const status: ShadowGitFileDiff['status'] = !before
        ? 'added'
        : !after
          ? 'deleted'
          : 'modified';
      result.push({ file, before, after, status, additions: 0, deletions: 0 });
    }
    return result;
  }
  async readFileAt(
    _workspaceRoot: string,
    hash: TreeHash,
    filePath: string,
  ): Promise<string | null> {
    return this.files.get(hash)?.get(filePath) ?? null;
  }
  async restoreFile() {
    /* noop */
  }
  async restoreAll() {
    /* noop */
  }
  async restoreSelective() {
    /* noop */
  }
  async gc() {
    /* noop */
  }

  setSnapshot(hash: TreeHash, files: Record<string, string>): void {
    this.files.set(hash, new Map(Object.entries(files)));
    if (!this.captures.includes(hash)) this.captures.push(hash);
  }
}

let fake: FakeShadowGit;

vi.mock('../../snapshot/shadow-git-store.js', async (importOriginal) => {
  const original = await importOriginal<typeof shadowGitStoreModule>();
  return {
    ...original,
    createShadowGitStore: () => fake,
  };
});

beforeEach(async () => {
  fake = new FakeShadowGit();
  const mod = await import('../../snapshot/snapshot-engine.js');
  mod.__resetSnapshotEngineForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('snapshot-engine', () => {
  it('isShadowGitEnabled returns true when shadow git reports available', async () => {
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    expect(await engine.isShadowGitEnabled()).toBe(true);
  });

  it('capture returns git-backed ref with strong guarantee', async () => {
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    const result = await engine.capture({ workspaceRoot: '/tmp/ws' });
    expect(result.backend).toBe('git');
    expect(result.guaranteeLevel).toBe('strong');
    expect(result.ref.kind).toBe('git');
  });

  it('capture falls back to noop when shadow git unavailable', async () => {
    fake.available = false;
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    const result = await engine.capture({ workspaceRoot: '/tmp/ws' });
    expect(result.backend).toBe('noop');
    expect(result.guaranteeLevel).toBe('medium');
    expect(result.ref).toEqual({ kind: 'legacy', requestId: '' });
  });

  it('diff requires both refs to be git-backed', async () => {
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();

    await expect(
      engine.diff({
        workspaceRoot: '/tmp/ws',
        from: { kind: 'legacy', requestId: 'req-1' },
        to: { kind: 'git', hash: 'aaa' },
      }),
    ).rejects.toThrow(/git-backed/);
  });

  it('diff returns empty array when from === to', async () => {
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    const result = await engine.diff({
      workspaceRoot: '/tmp/ws',
      from: { kind: 'git', hash: 'h' },
      to: { kind: 'git', hash: 'h' },
    });
    expect(result).toEqual([]);
  });

  it('diff produces FileDiffContent rows from shadow git', async () => {
    fake.setSnapshot('h-before', { 'a.ts': 'one\n' });
    fake.setSnapshot('h-after', { 'a.ts': 'two\n', 'b.ts': 'new\n' });

    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    const diffs = await engine.diff({
      workspaceRoot: '/tmp/ws',
      from: { kind: 'git', hash: 'h-before' },
      to: { kind: 'git', hash: 'h-after' },
    });

    expect(diffs).toHaveLength(2);
    expect(diffs.every((d) => d.guaranteeLevel === 'strong')).toBe(true);
    expect(diffs.every((d) => d.sourceKind === 'session_snapshot')).toBe(true);
  });

  it('readFileAt returns null for legacy refs', async () => {
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    const result = await engine.readFileAt({
      workspaceRoot: '/tmp/ws',
      snapshot: { kind: 'legacy', requestId: 'req' },
      filePath: 'a.ts',
    });
    expect(result).toBeNull();
  });

  it('readFileAt delegates to shadow git for git refs', async () => {
    fake.setSnapshot('h1', { 'a.ts': 'hello' });
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    const result = await engine.readFileAt({
      workspaceRoot: '/tmp/ws',
      snapshot: { kind: 'git', hash: 'h1' },
      filePath: 'a.ts',
    });
    expect(result).toBe('hello');
  });

  it('restoreSelective requires git-backed snapshot', async () => {
    const { getSnapshotEngine } = await import('../../snapshot/snapshot-engine.js');
    const engine = getSnapshotEngine();
    await expect(
      engine.restoreSelective({
        workspaceRoot: '/tmp/ws',
        snapshot: { kind: 'legacy', requestId: 'req' },
        files: ['a.ts'],
      }),
    ).rejects.toThrow(/git-backed/);
  });
});
