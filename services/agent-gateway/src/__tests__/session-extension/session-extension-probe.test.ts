/**
 * 会话 MCP 真实探活（261101）。
 *
 * 这层以前只是「路由层记得传的注入点」，漏传会被结算成 `probe_not_configured`——
 * 一个假的失败原因。现在它是服务层默认实现，因此必须有直接单测：
 *   1. 先作废旧连接再列工具（保证验的是刚写入的配置，而不是池里的旧连接）；
 *   2. 目录 `connected` 才算通过，并把工具数带回去；
 *   3. 连不上时返回可读原因，绝不返回 `ok: true`。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfiguredMcpServerForSession: vi.fn(),
  invalidateMcpServerConnectionForUser: vi.fn(async () => undefined),
  listMcpToolsForSession: vi.fn(),
}));

vi.mock('../../mcp/mcp-runtime.js', () => mocks);

const { probeSessionExtensionMcpServer } =
  await import('../../session-extension/session-extension-probe.js');

const INPUT = { sessionId: 's-probe', displayId: 'demo-mcp', ownerUserId: 'u-probe' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfiguredMcpServerForSession.mockReturnValue({
    id: 'demo-mcp',
    sessionScope: { ownerUserId: 'u-probe', sessionId: 's-probe' },
  });
});

describe('probeSessionExtensionMcpServer', () => {
  it('先作废旧连接再取目录；connected 才判通过', async () => {
    mocks.listMcpToolsForSession.mockResolvedValue([
      { serverId: 'demo-mcp', status: 'connected', tools: [{ name: 'a' }, { name: 'b' }] },
    ]);

    await expect(probeSessionExtensionMcpServer(INPUT)).resolves.toEqual({
      ok: true,
      toolCount: 2,
    });

    // 顺序即语义：不先回收，探的就是池里那份旧配置。
    const invalidateOrder =
      mocks.invalidateMcpServerConnectionForUser.mock.invocationCallOrder[0] ?? 0;
    const listOrder = mocks.listMcpToolsForSession.mock.invocationCallOrder[0] ?? 0;
    expect(invalidateOrder).toBeGreaterThan(0);
    expect(invalidateOrder).toBeLessThan(listOrder);
    expect(mocks.invalidateMcpServerConnectionForUser).toHaveBeenCalledWith(
      'u-probe',
      expect.objectContaining({ id: 'demo-mcp' }),
    );
    expect(mocks.listMcpToolsForSession).toHaveBeenCalledWith('s-probe', {
      serverId: 'demo-mcp',
    });
  });

  it('目录报错时回传可读原因，不谎报通过', async () => {
    mocks.listMcpToolsForSession.mockResolvedValue([
      { serverId: 'demo-mcp', status: 'error', tools: [], error: 'ECONNREFUSED' },
    ]);
    await expect(probeSessionExtensionMcpServer(INPUT)).resolves.toEqual({
      ok: false,
      error: 'ECONNREFUSED',
    });
  });

  it('目录里查不到该条目时也不判通过', async () => {
    mocks.listMcpToolsForSession.mockResolvedValue([]);
    const result = await probeSessionExtensionMcpServer(INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('missing');
  });
});
