/**
 * 反回归断言（批次 A / T-12 + T-13）：
 *
 * `omo` adapter MCP 已整条下线，能力面不得再出现它的任何入口。本文件把
 * 这些不变量钉成可执行断言，防止后续重构把 omo 悄悄带回来：
 *
 *  - A-01 系统内置 MCP id 列表不含 `omo`
 *  - A-02 `listMcpToolsForUser(userId)` 不返回 `serverId: 'omo'`
 *  - A-03 flat 工具名集合不含任何 `mcp__omo__*`
 *  - A-04 存量 `user_settings.mcp_servers` 含 `id:'omo'` 时不产生去 spawn
 *         `openawork-virtual-omo` 的 stdio 条目（D5）
 *  - A-05 `workspace-ignored-dirs` 仍包含 `.omo`（不能顺手清理）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as McpRuntimeModule from '../../mcp/mcp-runtime.js';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn(() => undefined),
  sqliteRunMock: vi.fn(),
  sqliteRunWithRowIdMock: vi.fn(() => 1),
  listConfiguredMcpToolsMock: vi.fn(async () => []),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: mocks.sqliteRunWithRowIdMock,
}));

vi.mock('../../mcp/mcp-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof McpRuntimeModule>();
  return {
    ...actual,
    listMcpToolsForConfiguredServers: mocks.listConfiguredMcpToolsMock,
  };
});

import {
  RETIRED_PROTECTED_MCP_IDS,
  buildBuiltinMcpServers,
  isRetiredProtectedMcpId,
  mergeBuiltinAndConfiguredMcps,
} from '../../mcp/builtin-mcps.js';
import { WORKSPACE_CORE_IGNORED_DIRS } from '../../workspace/workspace-ignored-dirs.js';
import { listSystemBuiltinMcpDescriptors } from '@openAwork/resources/node';

describe('omo 移除反回归断言', () => {
  beforeEach(() => {
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockReturnValue([]);
    mocks.listConfiguredMcpToolsMock.mockReset();
    mocks.listConfiguredMcpToolsMock.mockResolvedValue([]);
  });

  // A-01
  it('系统内置 MCP id 列表不含 omo', () => {
    expect(listSystemBuiltinMcpDescriptors().map((server) => server.id)).not.toContain('omo');
    expect(buildBuiltinMcpServers({ env: {} }).map((server) => server.id)).not.toContain('omo');
  });

  // A-01 / 退役登记表
  it('omo 已登记为下线的 protected builtin id', () => {
    expect(RETIRED_PROTECTED_MCP_IDS as readonly string[]).toContain('omo');
    expect(isRetiredProtectedMcpId('omo')).toBe(true);
    expect(isRetiredProtectedMcpId('lsp')).toBe(false);
  });

  // A-02 / A-04：合并层直接丢弃存量 omo 配置，不会 spawn openawork-virtual-omo
  it('存量 user_settings 含 id=omo 时，合并结果不产生 openawork-virtual-omo 条目', () => {
    for (const source of ['system', 'user', 'plugin'] as const) {
      const merged = mergeBuiltinAndConfiguredMcps([
        {
          id: 'omo',
          name: 'omo',
          transport: 'stdio',
          command: 'openawork-virtual-omo',
          source,
          enabled: true,
        },
      ]);

      expect(merged.find((server) => server.id === 'omo')).toBeUndefined();
      expect(merged.filter((server) => server.command === 'openawork-virtual-omo')).toEqual([]);
    }
  });

  // A-05：忽略目录里的 `.omo` 必须保留（965 个 run-continuation JSON 依赖它）
  it('workspace-ignored-dirs 仍包含 .omo', () => {
    expect(WORKSPACE_CORE_IGNORED_DIRS.has('.omo')).toBe(true);

    const merged = mergeBuiltinAndConfiguredMcps([]);
    expect(merged.some((server) => server.id.startsWith('omo'))).toBe(false);
  });
});

describe('omo 移除反回归断言（runtime 注入面）', () => {
  // A-02：无存量配置时，listMcpToolsForUser 根本不返回 omo server。
  it('listMcpToolsForUser 不返回 serverId=omo', async () => {
    const { listMcpToolsForUser } = await import('../../mcp/mcp-runtime.js');

    const catalogs = await listMcpToolsForUser('user-1');

    expect(catalogs.filter((catalog) => catalog.serverId === 'omo')).toEqual([]);
    // 内置集合（去掉用户配置后）也不含 omo。
    expect(buildBuiltinMcpServers({ env: {} }).map((server) => server.id)).not.toContain('omo');
  });

  // A-03：即便历史目录里混入 omo catalog，flat 工具名也不会产出 `mcp__omo__*`
  // ——已下线 server 进不了 catalog 列表，flat 构造层没有输入。
  it('flat 工具名集合不含任何 mcp__omo__*', async () => {
    const { buildFlatMcpToolDefinitions } = await import('../../mcp/mcp-flat-tool-defs.js');

    const { definitions } = buildFlatMcpToolDefinitions([
      {
        serverId: 'lsp',
        serverName: 'lsp',
        transport: 'stdio',
        enabled: true,
        status: 'connected',
        tools: [{ name: 'find_references', description: '查找引用', inputSchema: {} }],
      },
    ]);

    const flatNames = definitions.map((definition) => definition.function.name);
    expect(flatNames).toContain('mcp__lsp__find_references');
    expect(flatNames.filter((name) => name.startsWith('mcp__omo__'))).toEqual([]);
  });
});
