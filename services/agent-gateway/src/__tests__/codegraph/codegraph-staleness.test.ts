import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as StoragePaths from '../../infra/storage-paths.js';

const tempDirs: string[] = [];

const mocks = vi.hoisted(() => ({
  dataDir: '',
  sqliteGetMock: vi.fn(),
}));

vi.mock('../../infra/storage-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof StoragePaths>();
  return {
    ...actual,
    resolveGatewayDataDir: () => mocks.dataDir,
  };
});

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/tmp/openawork-codegraph-stale',
  WORKSPACE_ROOTS: ['/tmp/openawork-codegraph-stale'],
  sqliteAll: vi.fn(() => []),
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: vi.fn(),
}));

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-codegraph-stale-workspace-'));
  tempDirs.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'a.ts'), 'export const a = 1;\n', 'utf8');
  return workspaceRoot;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('codegraph stale markers', () => {
  it('writes stale markers under the gateway data dir and surfaces them in status', async () => {
    // Given
    const dataDir = await mkdtemp(join(tmpdir(), 'openawork-codegraph-data-'));
    tempDirs.push(dataDir);
    mocks.dataDir = dataDir;
    vi.stubEnv('OPENAWORK_DATA_DIR', dataDir);
    const workspaceRoot = await createWorkspace();
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('SELECT metadata_json')) {
        return { metadata_json: JSON.stringify({ workingDirectory: workspaceRoot }) };
      }
      if (query.includes('SELECT user_id FROM sessions')) {
        return { user_id: 'user-1' };
      }
      return undefined;
    });
    const { executeCodegraphTool, markCodegraphFilesStaleBestEffort, resolveCodegraphCachePath } =
      await import('../../tools/codegraph-tools.js');

    // When
    await markCodegraphFilesStaleBestEffort({
      sessionId: 'session-1',
      files: [join(workspaceRoot, 'a.ts'), join(workspaceRoot, '../outside.ts')],
      reason: 'test-write',
    });
    const status = await executeCodegraphTool({
      sessionId: 'session-1',
      toolName: 'codegraph_status',
      rawInput: {},
    });

    // Then
    expect(resolveCodegraphCachePath()).toBe(join(dataDir, 'codegraph/codegraph.sqlite'));
    expect(status).toMatchObject({
      freshness: {
        status: 'not_indexed',
        staleFiles: [join(workspaceRoot, 'a.ts')],
      },
    });
  });
});
