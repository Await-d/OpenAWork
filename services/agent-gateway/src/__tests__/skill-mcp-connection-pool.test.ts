import { afterEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  connectMock: vi.fn(async () => undefined),
  disconnectMock: vi.fn(async () => undefined),
  callToolMock: vi.fn(async () => ({ content: [{ type: 'text', text: 'result' }] })),
}));

vi.mock('@openAwork/mcp-client', () => ({
  MCPClientAdapterImpl: class {
    connect = mocked.connectMock;
    disconnect = mocked.disconnectMock;
    callTool = mocked.callToolMock;
  },
}));

vi.mock('../db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(() => undefined),
}));

import { skillMcpPool } from '../skill-mcp-connection-pool.js';

const TEST_SERVER_REF = {
  id: 'test-server',
  transport: 'sse' as const,
  url: 'https://example.com/mcp',
};

describe('skill-mcp-connection-pool', () => {
  afterEach(async () => {
    await skillMcpPool.disconnectAll();
    vi.clearAllMocks();
  });

  it('creates a connection on first access and reuses it', async () => {
    const adapter1 = await skillMcpPool.getOrCreateConnection('user-1', 'test', TEST_SERVER_REF);
    expect(mocked.connectMock).toHaveBeenCalledTimes(1);

    const adapter2 = await skillMcpPool.getOrCreateConnection('user-1', 'test', TEST_SERVER_REF);
    expect(mocked.connectMock).toHaveBeenCalledTimes(1); // No new connection
    expect(adapter1).toBe(adapter2); // Same adapter instance
  });

  it('creates separate connections for different users', async () => {
    const adapter1 = await skillMcpPool.getOrCreateConnection('user-1', 'test', TEST_SERVER_REF);
    const adapter2 = await skillMcpPool.getOrCreateConnection('user-2', 'test', TEST_SERVER_REF);
    expect(mocked.connectMock).toHaveBeenCalledTimes(2);
    expect(adapter1).not.toBe(adapter2);
  });

  it('disconnects all connections for a user', async () => {
    await skillMcpPool.getOrCreateConnection('user-1', 'test-a', TEST_SERVER_REF);
    await skillMcpPool.getOrCreateConnection('user-1', 'test-b', TEST_SERVER_REF);
    await skillMcpPool.getOrCreateConnection('user-2', 'test-a', TEST_SERVER_REF);

    await skillMcpPool.disconnectAllForUser('user-1');
    expect(mocked.disconnectMock).toHaveBeenCalledTimes(2);

    // user-2 connection still exists
    expect(skillMcpPool.isConnected('user-2', 'test-a')).toBe(true);
    expect(skillMcpPool.isConnected('user-1', 'test-a')).toBe(false);
  });

  it('retries operations on connection errors', async () => {
    let callCount = 0;
    mocked.callToolMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('not connected');
      return { content: [{ type: 'text', text: 'success' }] };
    });

    const result = await skillMcpPool.withOperationRetry(
      'user-1',
      'test',
      TEST_SERVER_REF,
      async (adapter, serverId) => {
        return await adapter.callTool(serverId, 'myTool', {});
      },
    );

    expect(result).toEqual({ content: [{ type: 'text', text: 'success' }] });
    expect(callCount).toBe(2); // First failed, second succeeded after reconnect
  });

  it('reports connection status', async () => {
    expect(skillMcpPool.isConnected('user-1', 'test')).toBe(false);
    expect(skillMcpPool.connectionCount).toBe(0);

    await skillMcpPool.getOrCreateConnection('user-1', 'test', TEST_SERVER_REF);

    expect(skillMcpPool.isConnected('user-1', 'test')).toBe(true);
    expect(skillMcpPool.connectionCount).toBe(1);
    expect(skillMcpPool.getConnectedServers('user-1')).toEqual(['user-1:test']);
  });

  it('disconnects a specific connection', async () => {
    await skillMcpPool.getOrCreateConnection('user-1', 'test', TEST_SERVER_REF);
    expect(skillMcpPool.isConnected('user-1', 'test')).toBe(true);

    await skillMcpPool.disconnectUserConnection('user-1', 'test');
    expect(skillMcpPool.isConnected('user-1', 'test')).toBe(false);
    expect(mocked.disconnectMock).toHaveBeenCalledTimes(1);
  });
});
