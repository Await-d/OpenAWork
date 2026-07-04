import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { openCodegraphStore } from '../../codegraph/store.js';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openawork-codegraph-schema-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CodegraphStore schema', () => {
  it('creates schema idempotently and records the schema version', async () => {
    // Given
    const dir = await createTempDir();
    const databasePath = join(dir, 'codegraph.sqlite');
    const store = openCodegraphStore({ databasePath });

    try {
      // When
      store.initialize();
      store.initialize();

      // Then
      expect(store.getSchemaVersion()).toBe(1);
      expect([...store.listTableNames()].sort()).toEqual([
        'codegraph_edges',
        'codegraph_files',
        'codegraph_index_runs',
        'codegraph_meta',
        'codegraph_stale_markers',
        'codegraph_startup_status',
        'codegraph_symbols',
        'codegraph_workspace_roots',
        'sqlite_sequence',
      ]);
    } finally {
      store.close();
    }
  });

  it('keeps workspace roots unique and stores stale markers without runtime tables', async () => {
    // Given
    const dir = await createTempDir();
    const workspaceRoot = join(dir, 'workspace');
    const store = openCodegraphStore({ databasePath: join(dir, 'codegraph.sqlite') });

    try {
      store.initialize();

      // When
      const first = store.upsertWorkspaceRoot(workspaceRoot);
      const second = store.upsertWorkspaceRoot(workspaceRoot);
      store.markFilesStale({
        workspaceRoot,
        files: [join(workspaceRoot, 'src/example.ts')],
        reason: 'test-change',
      });

      // Then
      expect(second.id).toBe(first.id);
      expect(store.getStaleFiles(workspaceRoot)).toEqual([join(workspaceRoot, 'src/example.ts')]);
      expect(store.listTableNames()).not.toContain('users');
      expect(store.listTableNames()).not.toContain('sessions');
    } finally {
      store.close();
    }
  });
});
