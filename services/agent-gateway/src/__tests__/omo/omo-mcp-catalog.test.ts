import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const keyOf = (userId: string, key: string): string => `${userId}::${key}`;

  return {
    rows,
    keyOf,
    sqliteGetMock: vi.fn((sql: string, params: readonly unknown[] = []) => {
      if (sql.includes('SELECT user_id FROM sessions')) {
        return { user_id: 'omo-user' };
      }
      if (!sql.includes("'mcp_servers'")) return undefined;
      const userId = typeof params[0] === 'string' ? params[0] : '';
      const value = rows.get(keyOf(userId, 'mcp_servers'));
      return value ? { value } : undefined;
    }),
  };
});

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: vi.fn(() => []),
  sqliteGet: dbMock.sqliteGetMock,
  sqliteRun: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
}));

vi.mock('../../skill/skill-mcp-connection-pool.js', () => {
  const fakePool = {
    disconnectUserConnection: vi.fn(async () => undefined),
    withOperationRetry: vi.fn(async () => []),
    isConnected: vi.fn(() => false),
    onToolListChanged: () => () => undefined,
  };
  return {
    mcpConnectionPool: fakePool,
    skillMcpPool: fakePool,
  };
});

import { buildFlatMcpToolDefinitions } from '../../mcp/mcp-flat-tool-defs.js';
import { listMcpToolsForUser, type ConfiguredMCPServer } from '../../mcp/mcp-runtime.js';
import {
  buildOmoVirtualCatalog,
  buildOmoVirtualMcpTools,
  callOmoVirtualMcp,
} from '../../mcp/virtual-omo-mcp.js';

const USER_ID = 'omo-user';

function setUserMcpServers(servers: readonly ConfiguredMCPServer[]): void {
  const userServers = servers.map((server) => ({
    id: server.id,
    name: server.name,
    type: server.transport,
    url: server.url,
    command: server.command,
    args: server.args,
    builtin: server.builtin,
    enabled: server.enabled,
    disabledTools: server.disabledTools,
  }));
  dbMock.rows.set(dbMock.keyOf(USER_ID, 'mcp_servers'), JSON.stringify(userServers));
}

describe('OMO virtual MCP catalog', () => {
  beforeEach(() => {
    dbMock.rows.clear();
  });

  it('lists omo as a virtual builtin and flattens non-native OMO adapter tools', async () => {
    // Given: no user MCP settings, so builtin MCPs are the real runtime surface.

    // When: the runtime lists only the omo catalog and the flat builder converts it.
    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'omo' });
    const flat = buildFlatMcpToolDefinitions(catalogs);
    const flatNames = flat.definitions.map((definition) => definition.function.name);

    // Then: OMO is visible as a connected virtual server with non-native adapter tools.
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]?.serverId).toBe('omo');
    expect(catalogs[0]?.status).toBe('connected');
    expect(catalogs[0]?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['adapter_catalog', 'ast_grep', 'context7']),
    );
    expect(flatNames).toEqual(expect.arrayContaining(['mcp__omo__ast_grep', 'mcp__omo__context7']));
  });

  it('does not duplicate OMO native aliases under the omo server', async () => {
    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'omo' });
    const flat = buildFlatMcpToolDefinitions(catalogs);
    const flatNames = flat.definitions.map((definition) => definition.function.name);

    expect(flatNames.some((name) => name.startsWith('mcp__omo__codegraph'))).toBe(false);
    expect(flatNames.some((name) => name.startsWith('mcp__omo__lsp'))).toBe(false);
    expect(flatNames.some((name) => name.startsWith('mcp__omo__git_bash'))).toBe(false);
    expect(flatNames.some((name) => name.startsWith('mcp__omo__grep_app'))).toBe(false);
    expect(flatNames.some((name) => name.startsWith('mcp__omo__open_websearch'))).toBe(false);
  });

  it('honors disabledTools for the omo virtual MCP catalog and flat injection', async () => {
    // Given: the user disables one OMO adapter tool by overriding the builtin omo server.
    setUserMcpServers([
      {
        id: 'omo',
        name: 'omo',
        transport: 'stdio',
        command: 'openawork-virtual-omo',
        enabled: true,
        builtin: true,
        disabledTools: ['ast_grep'],
      },
    ]);

    // When: the runtime lists OMO and the flat catalog is built.
    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'omo' });
    const flatNames = buildFlatMcpToolDefinitions(catalogs).definitions.map(
      (definition) => definition.function.name,
    );

    // Then: the disabled tool is absent from both observable surfaces.
    expect(catalogs[0]?.tools.map((tool) => tool.name)).not.toContain('ast_grep');
    expect(flatNames).not.toContain('mcp__omo__ast_grep');
    expect(flatNames).toContain('mcp__omo__context7');
  });

  it('isolates malformed OMO manifests behind an inert diagnostic catalog tool', async () => {
    // Given: malformed OMO source data and prompt-injection text inside a candidate id.
    const tools = buildOmoVirtualMcpTools({
      mcpServersManifest: { mcpServers: { context7: { transport: 'http' } } },
      toolCapabilityManifest: { capabilities: ['$(rm -rf /) remains inert'] },
    });

    // When: the virtual provider builds the tool list from that source.
    const toolNames = tools.map((tool) => tool.name);

    // Then: it does not throw, keeps a diagnostic tool, and treats hostile text as inert data.
    expect(toolNames).toContain('adapter_catalog');
    expect(toolNames).toContain('rm_rf_remains_inert');
  });

  it('reports cross-manifest tool-name collisions when ids only differ by punctuation', () => {
    const catalog = buildOmoVirtualCatalog({
      mcpServersManifest: {
        mcpServers: {
          ast_grep: { url: 'https://example.com/mcp' },
        },
      },
      toolCapabilityManifest: {
        capabilities: ['ast-grep'],
      },
    });

    expect(catalog.entries).toEqual([
      {
        sourceId: 'ast_grep',
        toolName: 'ast_grep',
        kind: 'remote-candidate',
        nativeAlias: false,
      },
    ]);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        source: 'capabilities',
        code: 'duplicate_id',
      }),
    ]);
    expect(catalog.diagnostics[0]?.message).toContain('ast-grep');
  });

  it('returns catalog data for OMO adapter calls without executing candidates', async () => {
    // Given: an OMO virtual MCP catalog call.

    // When: the adapter_catalog tool is called.
    const result = await callOmoVirtualMcp('session-omo-1', {
      serverId: 'omo',
      toolName: 'adapter_catalog',
      arguments: {},
    });

    // Then: the response is structured catalog data, not command execution output.
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('candidate tools');
    expect(result.structuredContent).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ toolName: 'ast_grep', nativeAlias: false }),
      ]),
      nativeAliases: expect.arrayContaining(['codegraph', 'git_bash', 'lsp']),
    });
  });
});
