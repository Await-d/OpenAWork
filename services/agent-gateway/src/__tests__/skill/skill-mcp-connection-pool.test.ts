import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MCPServerRef } from '@openAwork/skill-types';

const mocked = vi.hoisted(() => ({
  connectMock: vi.fn<(_server: MCPServerRef) => Promise<void>>(async () => undefined),
  disconnectMock: vi.fn(async () => undefined),
  callToolMock: vi.fn(async () => ({ content: [{ type: 'text', text: 'result' }] })),
  // Capture the listener the pool registers post-connect so tests
  // can simulate a `notifications/tools/list_changed` push and verify
  // the pool fans out to its registered listeners.
  subscribeMock: vi.fn(),
}));

vi.mock('@openAwork/mcp-client', () => ({
  MCPClientAdapterImpl: class {
    connect = mocked.connectMock;
    disconnect = mocked.disconnectMock;
    callTool = mocked.callToolMock;
    subscribeToolListChanged = mocked.subscribeMock;
  },
}));

vi.mock('../../infra/db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(() => undefined),
}));

import { skillMcpPool } from '../../skill/skill-mcp-connection-pool.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  it('disconnectMatching 只回收匹配键的连接（会话隔离回收）', async () => {
    await skillMcpPool.getOrCreateConnection('user-1', 's-a::server', TEST_SERVER_REF);
    await skillMcpPool.getOrCreateConnection('user-1', 's-b::server', TEST_SERVER_REF);
    await skillMcpPool.getOrCreateConnection('user-2', 's-a::server', TEST_SERVER_REF);

    const removed = await skillMcpPool.disconnectMatching((key) => key.includes('s-a::server'));

    // user-1 与 user-2 的同名会话键都属于「s-a」，另一个会话不受影响。
    expect(removed).toBe(2);
    expect(skillMcpPool.isConnected('user-1', 's-b::server')).toBe(true);
    expect(skillMcpPool.isConnected('user-1', 's-a::server')).toBe(false);
    expect(skillMcpPool.isConnected('user-2', 's-a::server')).toBe(false);
  });

  it('回收期间正在建立的连接不会在完成后「复活」（迟到 connect）', async () => {
    const connected = deferred();
    mocked.connectMock.mockImplementationOnce(() => connected.promise);

    // 连接挂起在 connect 阶段。
    const pending = skillMcpPool.getOrCreateConnection('user-1', 'session-x', TEST_SERVER_REF);

    // 此刻回收：pending 被摘除、该键的代数被作废。
    const removed = await skillMcpPool.disconnectMatching((key) => key.includes('session-x'));
    expect(removed).toBe(0); // 尚未进入 connections

    // 让 connect 完成——`createConnection` 末尾会尝试写回 connections，
    // 但代数已变，尝试必须被主动放弃并断开，而不是把连接留下来。
    connected.resolve();
    await expect(pending).rejects.toThrow(/revoked while connecting/);

    expect(skillMcpPool.isConnected('user-1', 'session-x')).toBe(false);
    expect(mocked.disconnectMock).toHaveBeenCalled();
  });

  it('回收之后重新连接同一键仍可成功（代数不会永久封锁）', async () => {
    await skillMcpPool.getOrCreateConnection('user-1', 'session-y', TEST_SERVER_REF);
    await skillMcpPool.disconnectMatching((key) => key.includes('session-y'));
    expect(skillMcpPool.isConnected('user-1', 'session-y')).toBe(false);

    await skillMcpPool.getOrCreateConnection('user-1', 'session-y', TEST_SERVER_REF);
    expect(skillMcpPool.isConnected('user-1', 'session-y')).toBe(true);
  });

  it('旧连接结束后不能移除新一代仍在连接的去重记录', async () => {
    const first = deferred();
    const second = deferred();
    mocked.connectMock.mockImplementationOnce(() => first.promise);
    mocked.connectMock.mockImplementationOnce(() => second.promise);

    const oldAttempt = skillMcpPool.getOrCreateConnection('user-1', 'replace', TEST_SERVER_REF);
    const oldResult = expect(oldAttempt).rejects.toThrow(/revoked while connecting/);
    await skillMcpPool.disconnectMatching((key) => key === 'user-1:replace');
    const newAttempt = skillMcpPool.getOrCreateConnection('user-1', 'replace', TEST_SERVER_REF);
    first.resolve();
    await oldResult;
    const sharedAttempt = skillMcpPool.getOrCreateConnection('user-1', 'replace', TEST_SERVER_REF);
    second.resolve();
    const [adapter, shared] = await Promise.all([newAttempt, sharedAttempt]);
    expect(mocked.connectMock).toHaveBeenCalledTimes(2);
    expect(adapter).toBe(shared);
  });

  it.each(['user', 'all'] as const)('%s 回收会作废尚未完成的连接', async (mode) => {
    const connected = deferred();
    mocked.connectMock.mockImplementationOnce(() => connected.promise);
    const pending = skillMcpPool.getOrCreateConnection(
      'user-1',
      'pending-cleanup',
      TEST_SERVER_REF,
    );
    const result = expect(pending).rejects.toThrow(/revoked while connecting/);
    if (mode === 'user') {
      await skillMcpPool.disconnectAllForUser('user-1');
    } else {
      await skillMcpPool.disconnectAll();
    }
    connected.resolve();
    await result;
    expect(skillMcpPool.isConnected('user-1', 'pending-cleanup')).toBe(false);
  });

  it('连接被撤销后默认重试不能重新建立已撤销的连接', async () => {
    const connected = deferred();
    mocked.connectMock.mockImplementationOnce(() => connected.promise);
    const operation = vi.fn(async () => 'done');
    const pending = skillMcpPool.withOperationRetry(
      'user-1',
      'revoked-retry',
      TEST_SERVER_REF,
      operation,
    );
    const result = expect(pending).rejects.toThrow(/revoked while connecting/);
    await skillMcpPool.disconnectMatching((key) => key === 'user-1:revoked-retry');
    connected.resolve();
    await result;
    expect(mocked.connectMock).toHaveBeenCalledTimes(1);
    expect(operation).not.toHaveBeenCalled();
  });

  it('maxAttempts=1 时非幂等调用不自动重放', async () => {
    let callCount = 0;
    mocked.callToolMock.mockImplementation(async () => {
      callCount++;
      throw new Error('not connected');
    });

    await expect(
      skillMcpPool.withOperationRetry(
        'user-1',
        'non-idempotent',
        TEST_SERVER_REF,
        async (adapter, serverId) => adapter.callTool(serverId, 'writeThing', {}),
        { maxAttempts: 1 },
      ),
    ).rejects.toThrow(/Failed after 1 reconnection attempts/);

    // 只执行一次：断线重放会让远端副作用执行两次。
    expect(callCount).toBe(1);
  });

  it('envPolicy=minimal 时 stdio 子进程拿到最小环境（不含网关凭据）', async () => {
    process.env['SESSION_TEST_GATEWAY_SECRET'] = 'should-not-leak';
    process.env['PATH'] = process.env['PATH'] ?? '/usr/bin';

    await skillMcpPool.getOrCreateConnection(
      'user-1',
      'stdio-minimal',
      { id: 'fs', transport: 'stdio', command: 'node' },
      { envPolicy: 'minimal' },
    );

    const passedRef = mocked.connectMock.mock.calls.at(-1)?.[0] as
      { env?: Record<string, string> } | undefined;
    expect(passedRef?.env?.['SESSION_TEST_GATEWAY_SECRET']).toBeUndefined();
    expect(passedRef?.env?.['PATH']).toBeDefined();

    delete process.env['SESSION_TEST_GATEWAY_SECRET'];
  });

  it('envPolicy 缺省（用户级）沿用既有环境清理行为', async () => {
    process.env['SESSION_TEST_GATEWAY_SECRET'] = 'inherited-by-default';
    process.env['npm_config_registry'] = 'https://registry.example';

    await skillMcpPool.getOrCreateConnection('user-1', 'stdio-inherit', {
      id: 'fs2',
      transport: 'stdio',
      command: 'node',
    });

    const passedRef = mocked.connectMock.mock.calls.at(-1)?.[0] as
      { env?: Record<string, string> } | undefined;
    // 用户级保持既有语义：非 npm 变量照常继承。
    expect(passedRef?.env?.['SESSION_TEST_GATEWAY_SECRET']).toBe('inherited-by-default');
    // npm 变量被既有清理规则排除。
    expect(passedRef?.env?.['npm_config_registry']).toBeUndefined();

    delete process.env['SESSION_TEST_GATEWAY_SECRET'];
    delete process.env['npm_config_registry'];
  });

  it('fans out tool-list-changed notifications to registered listeners with the originating tuple', async () => {
    // The pool's `createConnection` registers a notification handler
    // by calling `adapter.subscribeToolListChanged(serverId, sdkHandler)`.
    // We capture the SDK handler from the mock so we can synthesise a
    // server-pushed notification.
    let capturedSdkHandler: (() => void | Promise<void>) | null = null;
    mocked.subscribeMock.mockImplementation(
      async (_serverId: string, sdkHandler: () => void | Promise<void>) => {
        capturedSdkHandler = sdkHandler;
      },
    );

    const events: Array<{ userId: string; mcpName: string; serverId: string }> = [];
    const unsubscribe = skillMcpPool.onToolListChanged((evt) => {
      events.push(evt);
    });

    await skillMcpPool.getOrCreateConnection('user-1', 'gh-mcp', {
      ...TEST_SERVER_REF,
      id: 'gh-mcp-server',
    });
    expect(capturedSdkHandler).not.toBeNull();

    // Simulate the MCP server pushing notifications/tools/list_changed.
    await capturedSdkHandler!();

    expect(events).toEqual([{ userId: 'user-1', mcpName: 'gh-mcp', serverId: 'gh-mcp-server' }]);

    unsubscribe();

    // After unsubscribe, further pushes must not deliver to the listener.
    await capturedSdkHandler!();
    expect(events).toHaveLength(1);
  });
});
