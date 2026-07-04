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
  WORKSPACE_ROOT: '/tmp/openawork-codegraph-e2e',
  WORKSPACE_ROOTS: ['/tmp/openawork-codegraph-e2e'],
  sqliteAll: vi.fn(() => []),
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: vi.fn(),
}));

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-codegraph-e2e-workspace-'));
  tempDirs.push(workspaceRoot);
  await writeFile(
    join(workspaceRoot, 'main.ts'),
    'export function entry() { return 1; }\n',
    'utf8',
  );
  return workspaceRoot;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('codegraph gateway tool boundary smoke', () => {
  it('runs status/index/search/node/callers/impact and stale metadata through the sandbox', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'openawork-codegraph-e2e-data-'));
    tempDirs.push(dataDir);
    mocks.dataDir = dataDir;
    vi.stubEnv('OPENAWORK_DATA_DIR', dataDir);
    const workspaceRoot = await createWorkspace();
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('SELECT user_id FROM sessions')) {
        return { user_id: 'user-1' };
      }
      if (query.includes('SELECT metadata_json')) {
        return { metadata_json: JSON.stringify({ workingDirectory: workspaceRoot }) };
      }
      return undefined;
    });
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');
    const { markCodegraphFilesStaleBestEffort } = await import('../../tools/codegraph-tools.js');
    const sandbox = createDefaultSandbox();

    for (const [toolName, rawInput] of [
      ['codegraph_status', {}],
      ['codegraph_index', { path: 'main.ts' }],
      ['codegraph_search', { query: 'entry' }],
      ['codegraph_node', { file: 'main.ts' }],
      ['codegraph_callers', { symbol: 'entry' }],
      ['codegraph_impact', { symbol: 'entry', maxDepth: 2 }],
    ] as const) {
      const result = await sandbox.execute(
        {
          toolCallId: `call-${toolName}`,
          toolName,
          rawInput,
        },
        new AbortController().signal,
        'session-1',
      );
      expect(result.output).toMatchObject({
        workspaceRoot,
      });
      expect(JSON.stringify(result.output).length).toBeLessThan(8000);
    }

    await markCodegraphFilesStaleBestEffort({
      sessionId: 'session-1',
      files: [join(workspaceRoot, 'main.ts')],
      reason: 'e2e-mutation',
    });

    const staleStatus = await sandbox.execute(
      {
        toolCallId: 'call-codegraph-status-stale',
        toolName: 'codegraph_status',
        rawInput: {},
      },
      new AbortController().signal,
      'session-1',
    );
    expect(staleStatus.output).toMatchObject({
      freshness: {
        status: 'stale',
        staleFiles: [join(workspaceRoot, 'main.ts')],
      },
    });
  });
});
