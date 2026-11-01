import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPClientAdapterImpl } from './adapter.js';

const capture = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    async connect(): Promise<void> {
      await Promise.resolve();
    }
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(options: unknown) {
      capture.options(options);
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  capture.options.mockClear();
});

describe('stdio transport environment', () => {
  it('显式隔离环境不被 adapter 再合并宿主凭据', async () => {
    vi.stubEnv('MCP_ENV_SECRET_TEST', 'gateway-secret');
    await new MCPClientAdapterImpl().connect({
      id: 'isolated',
      transport: 'stdio',
      command: 'node',
      inheritEnv: false,
      env: { PATH: '/bin' },
    });
    expect(capture.options.mock.calls[0]?.[0]).toMatchObject({ env: { PATH: '/bin' } });
    expect(capture.options.mock.calls[0]?.[0].env.MCP_ENV_SECRET_TEST).toBeUndefined();
  });
  it('用户级缺省继续继承宿主环境', async () => {
    vi.stubEnv('MCP_ENV_SECRET_TEST', 'gateway-secret');
    await new MCPClientAdapterImpl().connect({ id: 'legacy', transport: 'stdio', command: 'node' });
    expect(capture.options.mock.calls[0]?.[0].env.MCP_ENV_SECRET_TEST).toBe('gateway-secret');
  });
});
