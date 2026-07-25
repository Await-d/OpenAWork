import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json')) {
      return {
        metadata_json: JSON.stringify({ workingDirectory: '/tmp/openawork-codegraph-test' }),
      };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/tmp/openawork-codegraph-test',
  WORKSPACE_ROOTS: ['/tmp/openawork-codegraph-test'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-codegraph-tools-'));
  tempDirs.push(workspaceRoot);
  return workspaceRoot;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('codegraph tool definitions and sandbox boundary', () => {
  it('exposes all model-visible codegraph tool schemas with bounded parameters', async () => {
    // Given
    const { buildGatewayToolDefinitions } = await import('../../tools/tool-definitions.js');

    // When
    const tools = buildGatewayToolDefinitions();
    const byName = new Map(tools.map((tool) => [tool.function.name, tool.function.parameters]));

    // Then
    for (const name of [
      'codegraph_status',
      'codegraph_index',
      'codegraph_search',
      'codegraph_node',
      'codegraph_callers',
      'codegraph_impact',
    ]) {
      expect(byName.has(name)).toBe(true);
      expect(byName.get(name)?.additionalProperties).toBe(false);
    }
    expect(byName.get('codegraph_search')?.properties.limit).toMatchObject({
      maximum: 100,
    });
    expect(byName.get('codegraph_node')?.properties.limit).toMatchObject({
      maximum: 2000,
    });
    expect(byName.get('codegraph_node')?.anyOf).toEqual([
      { type: 'object', required: ['symbol'] },
      { type: 'object', required: ['file'] },
    ]);
    expect(byName.get('codegraph_impact')?.properties.maxDepth).toMatchObject({
      maximum: 5,
    });
  });

  it('adds read/review access to read-only codegraph tools but not cache-writing index', async () => {
    // Given
    const { TOOLSET_TO_TOOL_NAMES } = await import('../../handoff/capability/toolset-gate.js');

    // When
    const readTools = TOOLSET_TO_TOOL_NAMES.read;
    const reviewTools = TOOLSET_TO_TOOL_NAMES.review;

    // Then
    expect(readTools).toEqual(expect.arrayContaining(['codegraph_search', 'codegraph_node']));
    expect(readTools).not.toContain('codegraph_index');
    expect(reviewTools).not.toContain('codegraph_index');
  });

  it('rejects codegraph_index paths outside the active workspace before cache access', async () => {
    // Given
    const workspaceRoot = await createWorkspace();
    const dataDir = await createWorkspace();
    vi.stubEnv('OPENAWORK_DATA_DIR', dataDir);
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
    const sandbox = createDefaultSandbox();

    // When
    const result = await sandbox.execute(
      {
        toolCallId: 'call-codegraph-index-outside',
        toolName: 'codegraph_index',
        rawInput: { path: '../outside.ts' },
      },
      new AbortController().signal,
      'session-1',
    );

    // Then
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('active workspace');
  });

  it('returns a bounded status smoke result through the real sandbox boundary', async () => {
    // Given
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
    const sandbox = createDefaultSandbox();

    // When
    const result = await sandbox.execute(
      {
        toolCallId: 'call-codegraph-status',
        toolName: 'codegraph_status',
        rawInput: {},
      },
      new AbortController().signal,
      'session-1',
    );

    // Then
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({
      workspaceRoot,
      freshness: {
        status: 'not_indexed',
      },
    });
    expect(JSON.stringify(result.output).length).toBeLessThan(4000);
  });
});
