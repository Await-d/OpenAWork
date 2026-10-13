// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PersistedMcpServer = {
  readonly id: string;
  readonly name?: string;
  readonly builtin?: boolean;
  readonly builtinKind?: string;
  readonly command?: string;
  readonly disabledTools?: readonly string[];
  readonly enabled?: boolean;
  readonly source?: string;
  readonly transport?: string;
  readonly url?: string;
};

type PutMcpServersPayload = {
  readonly servers: readonly PersistedMcpServer[];
};

type PutMcpServers = (
  token: string,
  payload: PutMcpServersPayload,
) => Promise<{ readonly ok: true }>;

const mocks = vi.hoisted(() => ({
  createSettingsClient: vi.fn(),
  getMcpStatus: vi.fn(),
  listMcpServers: vi.fn(),
  putMcpServers: vi.fn<PutMcpServers>(),
  retryMcpServer: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: mocks.createSettingsClient,
}));

import { useMcpServers } from './use-mcp-servers.js';

beforeEach(() => {
  mocks.listMcpServers.mockResolvedValue({
    servers: [
      {
        id: 'fs',
        name: 'filesystem',
        transport: 'stdio',
        command: 'mcp-server-fs',
        source: 'user',
        enabled: true,
      },
    ],
    builtinServers: [
      {
        id: 'omo',
        name: 'omo',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'adapter',
        source: 'builtin',
        enabled: true,
        disabledTools: ['omo_read_session'],
      },
    ],
  });
  // `clearAllMocks` 不会清掉 `mockResolvedValueOnce` 队列，先重置避免跨用例泄漏。
  mocks.getMcpStatus.mockReset();
  mocks.getMcpStatus.mockResolvedValue({
    servers: [
      {
        id: 'omo',
        name: 'omo',
        builtin: true,
        disabledTools: ['omo_read_session'],
        error: 'manifest stale',
        status: 'error',
        toolCount: 1,
        tools: [{ name: 'adapter_catalog', description: 'Catalog' }],
        type: 'stdio',
      },
    ],
  });
  mocks.putMcpServers.mockResolvedValue({ ok: true });
  mocks.retryMcpServer.mockResolvedValue({
    status: 'connected',
    toolCount: 3,
    durationMs: 42,
  });
  mocks.createSettingsClient.mockReturnValue({
    getMcpStatus: mocks.getMcpStatus,
    listMcpServers: mocks.listMcpServers,
    putMcpServers: mocks.putMcpServers,
    retryMcpServer: mocks.retryMcpServer,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMcpServers settings wiring', () => {
  it('Given an active settings tab When loading, saving, and retrying MCP servers Then uses web-client endpoints and preserves status data', async () => {
    const initialOmoStatus = {
      id: 'omo',
      name: 'omo',
      builtin: true,
      disabledTools: ['omo_read_session'],
      error: 'manifest stale',
      status: 'error',
      toolCount: 1,
      tools: [{ name: 'adapter_catalog', description: 'Catalog' }],
      type: 'stdio',
    };
    const refreshedOmoStatus = {
      id: 'omo',
      name: 'omo',
      builtin: true,
      disabledTools: [],
      status: 'connected',
      toolCount: 3,
      tools: [
        { name: 'fetch_web', description: '提取网页正文' },
        { name: 'fetch_github_readme', description: '读取 README' },
        { name: 'search', description: '多引擎搜索' },
      ],
      type: 'stdio',
    };
    mocks.getMcpStatus
      .mockResolvedValueOnce({ servers: [initialOmoStatus] })
      .mockResolvedValueOnce({ servers: [initialOmoStatus] })
      .mockResolvedValue({ servers: [refreshedOmoStatus] });

    const { result } = renderHook(() =>
      useMcpServers({
        active: true,
        gatewayUrl: 'http://gateway.local',
        token: 'token-1',
      }),
    );

    await waitFor(() => {
      expect(result.current.mcpServers.map((server) => server.id)).toEqual(['fs', 'omo']);
      expect(result.current.mcpStatuses).toEqual([
        {
          id: 'omo',
          name: 'omo',
          status: 'error',
          toolCount: 1,
          authType: 'stdio',
          builtin: true,
          disabledTools: ['omo_read_session'],
          error: 'manifest stale',
          tools: [{ name: 'adapter_catalog', description: 'Catalog' }],
        },
      ]);
    });

    expect(mocks.createSettingsClient).toHaveBeenCalledWith('http://gateway.local');
    expect(mocks.listMcpServers).toHaveBeenCalledWith('token-1');
    expect(mocks.getMcpStatus).toHaveBeenCalledWith('token-1', { includeTools: true });

    act(() => {
      result.current.setMcpServers((servers) =>
        servers.map((server) =>
          server.id === 'omo'
            ? {
                ...server,
                enabled: false,
                source: 'system',
                command: 'forged-omo-command',
                url: 'https://forged.invalid/omo',
              }
            : server,
        ),
      );
    });

    await waitFor(() => {
      expect(mocks.putMcpServers).toHaveBeenCalled();
    });

    const putMcpServersCall = mocks.putMcpServers.mock.calls[0];
    expect(putMcpServersCall).toBeDefined();
    if (putMcpServersCall === undefined) {
      expect.fail('Expected MCP settings save call');
    }
    const [putMcpServersToken, putMcpServersPayload] = putMcpServersCall;
    expect(putMcpServersToken).toBe('token-1');
    expect(putMcpServersPayload.servers.map((server) => server.id)).toEqual(['fs', 'omo']);
    expect(putMcpServersPayload.servers[0]).toMatchObject({
      id: 'fs',
      name: 'filesystem',
      source: 'user',
    });

    const persistedOmoServer = putMcpServersPayload.servers.find((server) => server.id === 'omo');
    expect(persistedOmoServer).toBeDefined();
    if (persistedOmoServer === undefined) {
      expect.fail('Expected persisted OMO server row');
    }
    expect(persistedOmoServer).toMatchObject({
      id: 'omo',
      builtin: true,
      builtinKind: 'adapter',
      disabledTools: ['omo_read_session'],
      enabled: false,
      source: 'system',
      transport: 'stdio',
    });
    expect(persistedOmoServer).not.toHaveProperty('url');
    expect(persistedOmoServer).not.toHaveProperty('command');

    expect(result.current.mcpStatuses[0]).toMatchObject({
      id: 'omo',
      status: 'error',
    });
    expect(result.current.mcpStatuses[0]).not.toHaveProperty('retryFeedback');

    // 保存成功后应重拉目录（挂载 1 次 + 保存后 1 次）。
    await waitFor(() => {
      expect(mocks.getMcpStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    act(() => {
      result.current.onRetryMcp('omo');
    });

    await waitFor(() => {
      expect(mocks.retryMcpServer).toHaveBeenCalledWith('token-1', 'omo');
      // 重试成功后同样重拉目录：计数与工具明细必须来自同一次后端快照。
      expect(mocks.getMcpStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(result.current.mcpStatuses[0]).toMatchObject({
        id: 'omo',
        status: 'connected',
        toolCount: 3,
        disabledTools: [],
        retryFeedback: {
          kind: 'ok',
          toolCount: 3,
          durationMs: 42,
        },
      });
      expect(result.current.mcpStatuses[0]?.tools?.map((tool) => tool.name)).toEqual([
        'fetch_web',
        'fetch_github_readme',
        'search',
      ]);
    });
  });

  it('preserves system-owned protected builtin rows loaded from settings storage', async () => {
    mocks.listMcpServers.mockResolvedValueOnce({
      servers: [
        {
          id: 'codegraph',
          name: 'codegraph',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'virtual',
          source: 'system',
          enabled: true,
          disabledTools: ['codegraph_search'],
        },
      ],
      builtinServers: [
        {
          id: 'codegraph',
          name: 'codegraph',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'virtual',
          source: 'system',
          enabled: true,
        },
      ],
    });
    mocks.getMcpStatus.mockResolvedValue({ servers: [] });

    const { result } = renderHook(() =>
      useMcpServers({
        active: true,
        gatewayUrl: 'http://gateway.local',
        token: 'token-2',
      }),
    );

    await waitFor(() => {
      expect(result.current.mcpServers).toEqual([
        expect.objectContaining({
          id: 'codegraph',
          builtin: true,
          builtinKind: 'virtual',
          source: 'system',
          enabled: true,
          disabledTools: ['codegraph_search'],
        }),
      ]);
    });

    act(() => {
      result.current.setMcpServers((servers) =>
        servers.map((server) =>
          server.id === 'codegraph' ? { ...server, enabled: false } : server,
        ),
      );
    });

    await waitFor(() => {
      expect(mocks.putMcpServers).toHaveBeenCalledWith('token-2', {
        servers: [
          expect.objectContaining({
            id: 'codegraph',
            builtin: true,
            builtinKind: 'virtual',
            source: 'system',
            enabled: false,
            disabledTools: ['codegraph_search'],
          }),
        ],
      });
    });
  });

  it('保存 disabledTools 改动后重拉目录，让卡片计数与工具明细同步（回归：3 tools / 2 行不一致）', async () => {
    mocks.listMcpServers.mockResolvedValueOnce({
      servers: [
        {
          id: 'open_websearch',
          name: 'Open WebSearch',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source: 'system',
          enabled: true,
          disabledTools: ['search'],
        },
      ],
      builtinServers: [],
    });
    mocks.getMcpStatus
      .mockResolvedValueOnce({
        servers: [
          {
            id: 'open_websearch',
            name: 'Open WebSearch',
            builtin: true,
            disabledTools: ['search'],
            status: 'connected',
            toolCount: 2,
            tools: [{ name: 'fetch_web' }, { name: 'fetch_github_readme' }],
            type: 'stdio',
          },
        ],
      })
      .mockResolvedValue({
        servers: [
          {
            id: 'open_websearch',
            name: 'Open WebSearch',
            builtin: true,
            disabledTools: [],
            status: 'connected',
            toolCount: 3,
            tools: [{ name: 'fetch_web' }, { name: 'fetch_github_readme' }, { name: 'search' }],
            type: 'stdio',
          },
        ],
      });

    const { result } = renderHook(() =>
      useMcpServers({
        active: true,
        gatewayUrl: 'http://gateway.local',
        token: 'token-3',
      }),
    );

    await waitFor(() => {
      expect(result.current.mcpStatuses[0]?.toolCount).toBe(2);
    });

    act(() => {
      result.current.setMcpServers((servers) =>
        servers.map((server) =>
          server.id === 'open_websearch' ? { ...server, disabledTools: [] } : server,
        ),
      );
    });

    await waitFor(() => {
      expect(mocks.putMcpServers).toHaveBeenCalled();
      // 保存后刷新：计数与工具明细都必须反映新目录（含重新启用的 search）。
      expect(result.current.mcpStatuses[0]).toMatchObject({
        id: 'open_websearch',
        status: 'connected',
        toolCount: 3,
        disabledTools: [],
      });
      expect(result.current.mcpStatuses[0]?.tools?.map((tool) => tool.name)).toEqual([
        'fetch_web',
        'fetch_github_readme',
        'search',
      ]);
    });
  });

  it('重试成功但目录刷新失败时，回退为本地回填计数与反馈', async () => {
    mocks.getMcpStatus
      .mockResolvedValueOnce({
        servers: [
          {
            id: 'omo',
            name: 'omo',
            builtin: true,
            disabledTools: ['omo_read_session'],
            status: 'error',
            toolCount: 1,
            tools: [{ name: 'adapter_catalog' }],
            type: 'stdio',
          },
        ],
      })
      .mockRejectedValue(new Error('status refresh failed'));

    const { result } = renderHook(() =>
      useMcpServers({
        active: true,
        gatewayUrl: 'http://gateway.local',
        token: 'token-4',
      }),
    );

    await waitFor(() => {
      expect(result.current.mcpStatuses[0]?.toolCount).toBe(1);
    });

    act(() => {
      result.current.onRetryMcp('omo');
    });

    await waitFor(() => {
      expect(result.current.mcpStatuses[0]).toMatchObject({
        id: 'omo',
        status: 'connected',
        toolCount: 3,
        retryFeedback: { kind: 'ok', toolCount: 3, durationMs: 42 },
      });
    });
  });
});
