/**
 * Tests for `builtin-mcps.ts`：内置远程 MCP 注册与"用户配置覆盖"
 * 合并语义。覆盖：
 *
 *  1. **默认产出**：在零环境变量下也输出 websearch + grep_app 两条
 *     稳定的远程 server 配置。
 *  2. **EXA_API_KEY 注入**：`process.env.EXA_API_KEY` 存在时，会被
 *     当作 `x-api-key` header 写到 websearch；不存在时不挂任何
 *     header（确保不污染匿名访问）。
 *  3. **mergeBuiltinAndConfiguredMcps**：用户配置同 id 完全覆盖
 *     内置项；不同 id 的用户配置追加在内置项之后。空数组等价于
 *     "用户没配过"，应得到全部内置项。
 *
 * 这些断言覆盖了运行时每次 `loadConfiguredMcpServersForUser` 调用
 * 内置 MCP 是否真的出现的关键路径。
 */

import { describe, expect, it } from 'vitest';

import {
  BUILTIN_MCP_IDS,
  buildBuiltinMcpServers,
  mergeBuiltinAndConfiguredMcps,
} from '../../mcp/builtin-mcps.js';
import type { ConfiguredMCPServer } from '../../mcp/mcp-runtime.js';

describe('buildBuiltinMcpServers', () => {
  it('exposes websearch + grep_app with stable remote URLs by default', () => {
    const out = buildBuiltinMcpServers({ env: {} });
    expect(out).toHaveLength(2);

    const websearch = out.find((server) => server.id === 'websearch');
    expect(websearch).toMatchObject({
      id: 'websearch',
      name: 'websearch',
      transport: 'sse',
      url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
      enabled: true,
    });
    // 没传 EXA_API_KEY 时不挂 header，避免给匿名访问加奇怪头。
    expect(websearch?.headers).toBeUndefined();

    const grepApp = out.find((server) => server.id === 'grep_app');
    expect(grepApp).toMatchObject({
      id: 'grep_app',
      name: 'grep_app',
      transport: 'sse',
      url: 'https://mcp.grep.app',
      enabled: true,
    });
    expect(grepApp?.headers).toBeUndefined();
  });

  it('injects EXA_API_KEY header when present in env', () => {
    const out = buildBuiltinMcpServers({ env: { EXA_API_KEY: 'sk-test-123' } });
    const websearch = out.find((server) => server.id === 'websearch');
    expect(websearch?.headers).toEqual({ 'x-api-key': 'sk-test-123' });
  });

  it('treats whitespace-only EXA_API_KEY as missing', () => {
    const out = buildBuiltinMcpServers({ env: { EXA_API_KEY: '   ' } });
    const websearch = out.find((server) => server.id === 'websearch');
    expect(websearch?.headers).toBeUndefined();
  });

  it('keeps BUILTIN_MCP_IDS in sync with the actual server list', () => {
    const ids = buildBuiltinMcpServers({ env: {} }).map((server) => server.id);
    expect(new Set(ids)).toEqual(new Set(BUILTIN_MCP_IDS));
  });
});

describe('mergeBuiltinAndConfiguredMcps', () => {
  it('returns the full builtin set when the user has no custom config', () => {
    const merged = mergeBuiltinAndConfiguredMcps([]);
    const ids = merged.map((server) => server.id);
    expect(ids).toContain('websearch');
    expect(ids).toContain('grep_app');
    expect(merged.every((server) => server.enabled === true)).toBe(true);
  });

  it('user config with the same id overrides the builtin entry entirely', () => {
    // 用户决定把 websearch 指向自建 Exa 代理 + 强制禁用。
    const userOverride: ConfiguredMCPServer = {
      id: 'websearch',
      name: 'my-private-exa',
      transport: 'sse',
      url: 'https://exa.internal.corp/mcp',
      enabled: false,
      headers: { 'x-api-key': 'corp-key' },
    };

    const merged = mergeBuiltinAndConfiguredMcps([userOverride]);

    // websearch 这一项应该完全是用户那份 —— 不应该出现两条同 id。
    const websearchEntries = merged.filter((server) => server.id === 'websearch');
    expect(websearchEntries).toHaveLength(1);
    expect(websearchEntries[0]).toBe(userOverride);

    // 同时 grep_app 内置项应原样保留。
    expect(merged.some((server) => server.id === 'grep_app')).toBe(true);
  });

  it('appends user configs that do not collide with any builtin id', () => {
    const customServer: ConfiguredMCPServer = {
      id: 'my-custom-mcp',
      name: 'My Custom MCP',
      transport: 'stdio',
      command: '/usr/local/bin/my-mcp',
      enabled: true,
    };

    const merged = mergeBuiltinAndConfiguredMcps([customServer]);
    expect(merged.map((server) => server.id)).toEqual(
      expect.arrayContaining(['websearch', 'grep_app', 'my-custom-mcp']),
    );
    // 用户自定义项排在内置项之后（顺序：内置在前）。
    const customIndex = merged.findIndex((server) => server.id === 'my-custom-mcp');
    const websearchIndex = merged.findIndex((server) => server.id === 'websearch');
    expect(customIndex).toBeGreaterThan(websearchIndex);
  });

  it('accepts an explicit builtin list (useful for tests)', () => {
    const fakeBuiltin: ConfiguredMCPServer[] = [
      { id: 'fake', name: 'fake', transport: 'sse', url: 'https://fake', enabled: true },
    ];
    const merged = mergeBuiltinAndConfiguredMcps([], fakeBuiltin);
    expect(merged).toEqual(fakeBuiltin);
  });
});
