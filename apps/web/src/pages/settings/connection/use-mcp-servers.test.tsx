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

    act(() => {
      result.current.onRetryMcp('omo');
    });

    await waitFor(() => {
      expect(mocks.retryMcpServer).toHaveBeenCalledWith('token-1', 'omo');
      expect(result.current.mcpStatuses[0]).toMatchObject({
        id: 'omo',
        status: 'connected',
        toolCount: 3,
        retryFeedback: {
          kind: 'ok',
          toolCount: 3,
          durationMs: 42,
        },
      });
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
    mocks.getMcpStatus.mockResolvedValueOnce({ servers: [] });

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
});
