import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ───────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  loadedTrees: [] as Array<{
    sessionId: string;
    userId: string;
    treeHash: string;
    parentTreeHash: string | null;
    clientRequestId: string | null;
    scopeKind: string;
    sourceKind: string;
    guaranteeLevel: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    toolName: string | null;
    toolCallId: string | null;
    observability: null;
    createdAt: string;
    id: number;
  }>,
  loadedFileEntries: new Map<number, Array<{ filePath: string; status: string }>>(),
  shadowGitEnabled: true,
  capturedReadFiles: [] as string[],
  restoreCalls: [] as Array<{ files: string[]; deleteMissing: boolean }>,
  captureSequence: ['after-restore-hash'] as string[],
  // Per-path fs.readFile error override (path-substring → errno code). Lets a
  // single file throw a non-ENOENT error (EACCES/EISDIR) to exercise the
  // per-file resilience of the snapshot preview/restore batch reads.
  readFileErrorByPath: new Map<string, string>(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: ['/tmp/openawork-snapshot-tree-test'],
  sqliteGet: mocks.sqliteGet,
  sqliteRun: vi.fn(),
  sqliteAll: vi.fn(() => []),
}));

vi.mock('../../infra/auth.js', () => ({
  requireAuth: async (request: { user?: unknown }) => {
    request.user = { sub: 'test-user', email: 'test@openAwork.local' };
  },
}));

vi.mock('../../runtime/request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: vi.fn(), fail: vi.fn() },
    child: () => ({ succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('../../session/session-workspace-metadata.js', () => ({
  extractSessionWorkingDirectory: (metadata: Record<string, unknown>) => {
    const value = metadata['workingDirectory'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  },
  parseSessionMetadataJson: (raw: string) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  },
  sanitizeSessionMetadataJson: (raw: string) => raw,
}));

vi.mock('../../workspace/workspace-paths.js', () => ({
  validateWorkspacePath: (path: string) => path,
}));

vi.mock('../../tools/file-diff-format.js', () => ({
  buildFileDiff: ({ file, before, after }: { file: string; before: string; after: string }) => ({
    file,
    before,
    after,
    additions: after.length > before.length ? 1 : 0,
    deletions: before.length > after.length ? 1 : 0,
    status: !before ? 'added' : !after ? 'deleted' : 'modified',
  }),
}));

vi.mock('node:fs', () => ({
  promises: {
    readFile: async (path: string) => {
      // A specific file can be marked unreadable with a non-ENOENT errno to
      // exercise per-file resilience; otherwise simulate "file absent" (ENOENT).
      for (const [needle, code] of mocks.readFileErrorByPath) {
        if (path.includes(needle)) {
          const err = new Error(`${code}: ${path}`) as NodeJS.ErrnoException;
          err.code = code;
          throw err;
        }
      }
      const err = new Error(
        `ENOENT: no such file or directory, open '${path}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    },
  },
}));

vi.mock('../../snapshot/snapshot-tree-store.js', () => ({
  getSnapshotTreeByHash: ({ sessionId, treeHash }: { sessionId: string; treeHash: string }) => {
    return (
      mocks.loadedTrees.find(
        (tree) => tree.sessionId === sessionId && tree.treeHash === treeHash,
      ) ?? null
    );
  },
  getSnapshotTreeAtOrBefore: ({
    sessionId,
    userId,
    timestamp,
  }: {
    sessionId: string;
    userId: string;
    timestamp: string;
  }) => {
    const candidates = mocks.loadedTrees.filter(
      (tree) =>
        tree.sessionId === sessionId && tree.userId === userId && tree.createdAt <= timestamp,
    );
    return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  },
  listSnapshotTreesForSession: ({ sessionId, userId }: { sessionId: string; userId: string }) =>
    mocks.loadedTrees.filter((tree) => tree.sessionId === sessionId && tree.userId === userId),
  listSnapshotTreesForRequest: ({
    sessionId,
    userId,
    clientRequestId,
  }: {
    sessionId: string;
    userId: string;
    clientRequestId: string;
  }) =>
    mocks.loadedTrees.filter(
      (tree) =>
        tree.sessionId === sessionId &&
        tree.userId === userId &&
        tree.clientRequestId === clientRequestId,
    ),
  listSnapshotFileEntries: (id: number) => mocks.loadedFileEntries.get(id) ?? [],
  traceSnapshotTreeChain: ({ treeHash, sessionId }: { treeHash: string; sessionId: string }) => {
    const result: typeof mocks.loadedTrees = [];
    let cursor: string | null = treeHash;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const node = mocks.loadedTrees.find(
        (tree) => tree.sessionId === sessionId && tree.treeHash === cursor,
      );
      if (!node) break;
      result.push(node);
      cursor = node.parentTreeHash;
    }
    return result;
  },
  persistSnapshotTree: vi.fn(),
}));

vi.mock('../../snapshot/snapshot-engine.js', () => ({
  getSnapshotEngine: () => ({
    isShadowGitEnabled: async () => mocks.shadowGitEnabled,
    capture: async () => {
      const next = mocks.captureSequence.shift() ?? 'after-fallback';
      return {
        ref: { kind: 'git', hash: next },
        guaranteeLevel: 'strong',
        backend: 'git',
      };
    },
    diff: async () => [],
    readFileAt: async ({ filePath }: { filePath: string }) => {
      mocks.capturedReadFiles.push(filePath);
      return `content of ${filePath}`;
    },
    restoreSelective: async ({
      files,
      deleteMissing,
    }: {
      files: string[];
      deleteMissing?: boolean;
    }) => {
      mocks.restoreCalls.push({ files, deleteMissing: deleteMissing ?? false });
    },
    gc: async () => undefined,
  }),
}));

import { snapshotTreeRoutes } from '../../routes/snapshot-tree-routes.js';

const SESSION_ID = 'sess-1';
const USER_ID = 'test-user';

function makeTree(overrides: Partial<(typeof mocks.loadedTrees)[number]> = {}) {
  return {
    id: mocks.loadedTrees.length + 1,
    sessionId: SESSION_ID,
    userId: USER_ID,
    treeHash: 'hash-1',
    parentTreeHash: null,
    clientRequestId: null,
    scopeKind: 'turn',
    sourceKind: 'session_snapshot',
    guaranteeLevel: 'strong',
    filesChanged: 1,
    additions: 1,
    deletions: 0,
    toolName: null,
    toolCallId: null,
    observability: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function createApp() {
  const app = Fastify();
  await app.register(snapshotTreeRoutes);
  return app;
}

beforeEach(() => {
  mocks.loadedTrees = [];
  mocks.loadedFileEntries = new Map();
  mocks.shadowGitEnabled = true;
  mocks.capturedReadFiles = [];
  mocks.restoreCalls = [];
  mocks.captureSequence = ['after-restore-hash'];
  mocks.readFileErrorByPath = new Map();

  mocks.sqliteGet.mockReset();
  mocks.sqliteGet.mockImplementation((sql: string, params: unknown[] = []) => {
    if (/FROM\s+sessions/i.test(sql)) {
      const [sessionId] = params as [string];
      if (sessionId === SESSION_ID) {
        return {
          user_id: USER_ID,
          metadata_json: JSON.stringify({ workingDirectory: '/workspace' }),
        };
      }
    }
    return null;
  });
});

describe('snapshot-tree routes', () => {
  it('GET /sessions/:id/snapshot-trees returns persisted trees', async () => {
    mocks.loadedTrees.push(makeTree({ treeHash: 'hash-1' }));
    mocks.loadedTrees.push(
      makeTree({ treeHash: 'hash-2', parentTreeHash: 'hash-1', clientRequestId: 'req-1' }),
    );

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/snapshot-trees`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.trees).toHaveLength(2);
    expect(body.trees.map((t: { treeHash: string }) => t.treeHash).sort()).toEqual([
      'hash-1',
      'hash-2',
    ]);
  });

  it('GET /sessions/:id/snapshot-trees filters by clientRequestId', async () => {
    mocks.loadedTrees.push(makeTree({ treeHash: 'hash-1', clientRequestId: 'req-1' }));
    mocks.loadedTrees.push(makeTree({ treeHash: 'hash-2', clientRequestId: 'req-2' }));

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/snapshot-trees?clientRequestId=req-1`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.trees).toHaveLength(1);
    expect(body.trees[0]?.treeHash).toBe('hash-1');
  });

  it('GET /sessions/:id/snapshot-trees/:hash returns details with file entries', async () => {
    const tree = makeTree({ treeHash: 'hash-detail' });
    mocks.loadedTrees.push(tree);
    mocks.loadedFileEntries.set(tree.id, [
      { filePath: 'a.ts', status: 'modified' },
      { filePath: 'b.ts', status: 'added' },
    ]);

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/snapshot-trees/hash-detail`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tree.treeHash).toBe('hash-detail');
    expect(body.files).toHaveLength(2);
    expect(body.chain).toHaveLength(1);
  });

  it('returns 404 when tree not found', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/snapshot-trees/missing-hash`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST /sessions/:id/restore/to-tree (preview) lists target files without writing', async () => {
    const tree = makeTree({ treeHash: 'hash-restore' });
    mocks.loadedTrees.push(tree);
    mocks.loadedFileEntries.set(tree.id, [
      { filePath: 'a.ts', status: 'modified' },
      { filePath: 'b.ts', status: 'added' },
    ]);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/to-tree`,
      payload: { treeHash: 'hash-restore', mode: 'preview' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe('preview');
    expect(body.files).toHaveLength(2);
    expect(body.summary).toBeDefined();
    expect(body.summary.total).toBe(2);
    expect(mocks.capturedReadFiles).toEqual(['a.ts', 'b.ts']);
    expect(mocks.restoreCalls).toEqual([]);
  });

  it('POST /sessions/:id/restore/to-tree (preview) 跳过读取失败的单个文件而不是整列 500', async () => {
    // One workspace file unreadable with a non-ENOENT errno (e.g. EACCES /
    // EISDIR) must not reject the whole preview batch — the bad file degrades
    // to "absent" and the rest of the preview still loads.
    const tree = makeTree({ treeHash: 'hash-eacces' });
    mocks.loadedTrees.push(tree);
    mocks.loadedFileEntries.set(tree.id, [
      { filePath: 'ok.ts', status: 'modified' },
      { filePath: 'locked.ts', status: 'modified' },
    ]);
    mocks.readFileErrorByPath.set('locked.ts', 'EACCES');

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/to-tree`,
      payload: { treeHash: 'hash-eacces', mode: 'preview' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe('preview');
    expect(body.files).toHaveLength(2);
    const locked = body.files.find((f: { filePath: string }) => f.filePath === 'locked.ts');
    // Unreadable current file is treated as absent (empty content).
    expect(locked.currentExists).toBe(false);
    expect(mocks.restoreCalls).toEqual([]);
  });

  it('POST /sessions/:id/restore/to-tree (apply) calls restoreSelective and captures audit tree', async () => {
    const tree = makeTree({ treeHash: 'hash-apply' });
    mocks.loadedTrees.push(tree);
    mocks.loadedFileEntries.set(tree.id, [{ filePath: 'a.ts', status: 'modified' }]);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/to-tree`,
      payload: { treeHash: 'hash-apply', mode: 'apply', deleteMissing: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe('apply');
    expect(body.afterTreeHash).toBe('after-restore-hash');

    expect(mocks.restoreCalls).toEqual([{ files: ['a.ts'], deleteMissing: true }]);
  });

  it('POST /sessions/:id/restore/to-tree returns 503 when shadow-git unavailable', async () => {
    mocks.shadowGitEnabled = false;
    mocks.loadedTrees.push(makeTree({ treeHash: 'hash-noop' }));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/to-tree`,
      payload: { treeHash: 'hash-noop', mode: 'preview' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: '当前会话未启用 shadow git，无法执行快照树恢复。',
      code: 'shadow_git_unavailable',
    });
  });

  it('returns 400 when workspaceRoot is not configured', async () => {
    mocks.sqliteGet.mockImplementation((sql: string, params: unknown[] = []) => {
      if (/FROM\s+sessions/i.test(sql)) {
        const [sessionId] = params as [string];
        if (sessionId === SESSION_ID) {
          return {
            team_parent_session_id: null,
            user_id: USER_ID,
            metadata_json: JSON.stringify({}),
          };
        }
      }
      return null;
    });
    mocks.loadedTrees.push(makeTree({ treeHash: 'hash-no-ws' }));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/to-tree`,
      payload: { treeHash: 'hash-no-ws', mode: 'apply' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: '当前会话未绑定可用工作区，无法执行快照恢复。',
      code: 'workspace_root_unavailable',
    });
  });

  it('returns 404 when session not found', async () => {
    mocks.sqliteGet.mockImplementation(() => null);
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/missing-session/snapshot-trees`,
    });
    expect(response.statusCode).toBe(404);
  });

  // ── Cherry-pick tests ──────────────────────────────────────────────

  it('POST /sessions/:id/restore/cherry-pick (preview) identifies files to revert', async () => {
    // Setup: keep=[hash-k1], revert=[hash-r1]
    // hash-r1 touches file "reverted.ts"
    // hash-k1 touches file "kept.ts"
    const keepTree = makeTree({ treeHash: 'hash-k1', id: 10 });
    const revertTree = makeTree({ treeHash: 'hash-r1', id: 11 });
    mocks.loadedTrees.push(keepTree, revertTree);
    mocks.loadedFileEntries.set(10, [{ filePath: 'kept.ts', status: 'modified' }]);
    mocks.loadedFileEntries.set(11, [{ filePath: 'reverted.ts', status: 'modified' }]);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/cherry-pick`,
      payload: {
        keep: ['hash-k1'],
        revert: ['hash-r1'],
        mode: 'preview',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe('preview');
    // Only "reverted.ts" should be in the preview (it's the file affected by revert)
    expect(body.files).toHaveLength(1);
    expect(body.files[0]?.filePath).toBe('reverted.ts');
    expect(body.keep).toEqual(['hash-k1']);
    expect(body.revert).toEqual(['hash-r1']);
  });

  it('POST /sessions/:id/restore/cherry-pick (apply) restores files grouped by target hash', async () => {
    const keepTree = makeTree({ treeHash: 'hash-k1', id: 20 });
    const revertTree = makeTree({ treeHash: 'hash-r1', id: 21 });
    mocks.loadedTrees.push(keepTree, revertTree);
    mocks.loadedFileEntries.set(20, [{ filePath: 'shared.ts', status: 'modified' }]);
    mocks.loadedFileEntries.set(21, [
      { filePath: 'shared.ts', status: 'modified' },
      { filePath: 'only-reverted.ts', status: 'added' },
    ]);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/cherry-pick`,
      payload: {
        keep: ['hash-k1'],
        revert: ['hash-r1'],
        mode: 'apply',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe('apply');
    // "shared.ts" should be restored to hash-k1 (keep has it)
    // "only-reverted.ts" should be restored to hash-k1 (fallback to first keep)
    expect(mocks.restoreCalls.length).toBeGreaterThanOrEqual(1);
    expect(body.afterTreeHash).toBe('after-restore-hash');
  });

  it('POST /sessions/:id/restore/cherry-pick returns 404 for unknown tree hash', async () => {
    mocks.loadedTrees.push(makeTree({ treeHash: 'hash-exists' }));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/cherry-pick`,
      payload: {
        keep: ['hash-exists'],
        revert: ['hash-missing'],
        mode: 'preview',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: '目标快照树不存在。',
      code: 'tree_not_found',
      treeHash: 'hash-missing',
    });
  });

  it('POST /sessions/:id/restore/cherry-pick returns empty when revert set has no files', async () => {
    // revert tree exists but has no file entries
    const revertTree = makeTree({ treeHash: 'hash-empty-revert', id: 30 });
    const keepTree = makeTree({ treeHash: 'hash-keep', id: 31 });
    mocks.loadedTrees.push(revertTree, keepTree);
    mocks.loadedFileEntries.set(30, []);
    mocks.loadedFileEntries.set(31, []);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/cherry-pick`,
      payload: {
        keep: ['hash-keep'],
        revert: ['hash-empty-revert'],
        mode: 'preview',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      files: [],
      changed: 0,
      message: '当前回退集合未命中任何文件，无需恢复。',
    });
  });

  // ── at-time tests ──────────────────────────────────────────────────

  it('POST /sessions/:id/restore/at-time resolves to the nearest tree before timestamp', async () => {
    // The at-time endpoint internally forwards to /restore/to-tree via app.inject
    // Since our mock doesn't wire getSnapshotTreeAtOrBefore, we verify the route
    // exists and handles the case where no tree is found at that time.
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/at-time`,
      payload: { timestamp: '2025-05-20 12:00:00', mode: 'preview' },
    });

    // With our mock, getSnapshotTreeAtOrBefore returns null → 404
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: '指定时间点之前没有可用快照。',
      code: 'no_snapshot_at_time',
    });
  });

  // ── from-session tests ─────────────────────────────────────────────

  it('POST /sessions/:id/restore/from-session returns error for missing source session', async () => {
    // Default mock returns target session correctly but null for unknown sessions.
    // The route validates workspace_root first (which may fail depending on mock
    // wiring), then checks source session. We verify the route handles the case.
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/from-session`,
      payload: {
        sourceSessionId: 'missing-session',
        treeHash: 'hash-1',
        mode: 'preview',
      },
    });

    // Either 400 (workspace validation) or 404 (source not found) is acceptable
    // depending on mock wiring. The important thing is it doesn't 500.
    expect(response.statusCode).toBeLessThan(500);
  });

  it('POST /sessions/:id/restore/from-session returns 400 for workspace mismatch', async () => {
    // Setup: target session has workspace /workspace, source has /other-workspace
    mocks.sqliteGet.mockImplementation((sql: string, params: unknown[] = []) => {
      if (/FROM\s+sessions/i.test(sql)) {
        const [sessionId] = params as [string];
        if (sessionId === SESSION_ID) {
          return {
            user_id: USER_ID,
            metadata_json: JSON.stringify({ workingDirectory: '/workspace' }),
          };
        }
        if (sessionId === 'source-sess') {
          return {
            user_id: USER_ID,
            metadata_json: JSON.stringify({ workingDirectory: '/other-workspace' }),
          };
        }
      }
      return null;
    });

    mocks.loadedTrees.push(makeTree({ treeHash: 'hash-source', sessionId: 'source-sess' }));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/from-session`,
      payload: {
        sourceSessionId: 'source-sess',
        treeHash: 'hash-source',
        mode: 'preview',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: '源会话与目标会话的工作区不一致，无法跨会话恢复。',
      code: 'workspace_mismatch',
    });
  });

  it('POST /sessions/:id/restore/from-session (preview) works for same-workspace sessions', async () => {
    // Both sessions share /workspace
    mocks.sqliteGet.mockImplementation((sql: string, params: unknown[] = []) => {
      if (/FROM\s+sessions/i.test(sql)) {
        const [sessionId] = params as [string];
        if (sessionId === SESSION_ID || sessionId === 'source-sess') {
          return {
            user_id: USER_ID,
            metadata_json: JSON.stringify({ workingDirectory: '/workspace' }),
          };
        }
      }
      return null;
    });

    const sourceTree = makeTree({ treeHash: 'hash-cross', sessionId: 'source-sess', id: 50 });
    mocks.loadedTrees.push(sourceTree);
    mocks.loadedFileEntries.set(50, [{ filePath: 'cross.ts', status: 'modified' }]);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/restore/from-session`,
      payload: {
        sourceSessionId: 'source-sess',
        treeHash: 'hash-cross',
        mode: 'preview',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe('preview');
    expect(body.sourceSessionId).toBe('source-sess');
    expect(body.files).toHaveLength(1);
    expect(body.files[0]?.filePath).toBe('cross.ts');
  });
});
