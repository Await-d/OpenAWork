import { describe, expect, it } from 'vitest';

import {
  parseMaybeJsonPayload,
  parseMcpCall,
  resolveMcpBuiltinBridge,
  resolveMcpBuiltinToolName,
  unwrapMcpPayload,
} from './mcp-builtin-alias.js';

describe('parseMcpCall — 扁平 MCP 工具名', () => {
  it('拆出 serverId 与内层工具名', () => {
    expect(parseMcpCall('mcp__lsp__find_references')).toEqual({
      serverId: 'lsp',
      toolName: 'find_references',
    });
  });

  it('大小写与空白不敏感', () => {
    expect(parseMcpCall('  MCP__LSP__Diagnostics ')).toEqual({
      serverId: 'lsp',
      toolName: 'diagnostics',
    });
  });

  it('内层工具名本身含双下划线时只切第一个分隔符', () => {
    expect(parseMcpCall('mcp__codegraph__tool__with__underscores')).toEqual({
      serverId: 'codegraph',
      toolName: 'tool__with__underscores',
    });
  });

  it('内置工具名不误判为 MCP', () => {
    expect(parseMcpCall('lsp_find_references')).toBeNull();
    expect(parseMcpCall('read')).toBeNull();
    expect(parseMcpCall('mcp_list_tools')).toBeNull();
  });

  it('缺少 server 或工具名时不命中', () => {
    expect(parseMcpCall('mcp__lsp__')).toBeNull();
    expect(parseMcpCall('mcp__find_references')).toBeNull();
  });
});

describe('parseMcpCall — legacy mcp_call', () => {
  it('从入参取 serverId 与 toolName', () => {
    expect(parseMcpCall('mcp_call', { serverId: 'lsp', toolName: 'symbols' })).toEqual({
      serverId: 'lsp',
      toolName: 'symbols',
    });
  });

  it('serverId 大小写不敏感', () => {
    expect(parseMcpCall(' MCP_CALL ', { serverId: ' LSP ', toolName: 'Hover' })).toEqual({
      serverId: 'lsp',
      toolName: 'hover',
    });
  });

  it('缺少参数时不命中', () => {
    expect(parseMcpCall('mcp_call', { serverId: 'lsp' })).toBeNull();
    expect(parseMcpCall('mcp_call', { toolName: 'hover' })).toBeNull();
    expect(parseMcpCall('mcp_call')).toBeNull();
  });
});

describe('resolveMcpBuiltinToolName', () => {
  it('lsp 内层名补上 lsp_ 前缀', () => {
    expect(resolveMcpBuiltinToolName('mcp__lsp__diagnostics')).toBe('lsp_diagnostics');
    expect(resolveMcpBuiltinToolName('mcp__lsp__status')).toBe('lsp_status');
  });

  it('codegraph 内层名本身就是内置名', () => {
    expect(resolveMcpBuiltinToolName('mcp__codegraph__codegraph_search')).toBe('codegraph_search');
  });

  it('open_websearch 的抓取工具映射到 webfetch', () => {
    expect(resolveMcpBuiltinToolName('mcp__open_websearch__fetch_web')).toBe('webfetch');
    expect(resolveMcpBuiltinToolName('mcp__open_websearch__fetch_github_readme')).toBe('webfetch');
  });

  it('legacy mcp_call 走同一张映射表', () => {
    expect(
      resolveMcpBuiltinToolName('mcp_call', { serverId: 'codegraph', toolName: 'codegraph_node' }),
    ).toBe('codegraph_node');
  });

  it('git_bash：run 复用 bash，状态类两个工具共用一张状态卡', () => {
    expect(resolveMcpBuiltinToolName('mcp__git_bash__run')).toBe('bash');
    expect(resolveMcpBuiltinToolName('mcp__git_bash__which_bash')).toBe('git_bash_status');
    expect(resolveMcpBuiltinToolName('mcp__git_bash__diagnose')).toBe('git_bash_status');
  });

  it('omo adapter 已下线：其历史工具名不再映射到任何渲染通道', () => {
    // 存量会话里仍可能带 `mcp__omo__*` 的 tool_call，必须回落到通用
    // `McpResultPreview`（即返回 null → 走原有 MCP 渲染路径），而不是指向
    // 已删除的 `omo_catalog` 预览分支。
    expect(resolveMcpBuiltinToolName('mcp__omo__adapter_catalog')).toBeNull();
    expect(resolveMcpBuiltinToolName('mcp__omo__ast_grep')).toBeNull();
    expect(resolveMcpBuiltinToolName('mcp__omo__context7')).toBeNull();
    expect(resolveMcpBuiltinBridge('mcp__omo__adapter_catalog', { any: 'payload' })).toBeNull();
  });

  it('搜索类工具都走 web 结果列表', () => {
    expect(resolveMcpBuiltinToolName('mcp__open_websearch__search')).toBe('websearch');
    expect(resolveMcpBuiltinToolName('mcp__websearch__web_search_exa')).toBe('web_search');
  });

  it('grep_app 是远端 SSE server，本地不掌握工具名与形状，不登记', () => {
    expect(resolveMcpBuiltinToolName('mcp__grep_app__search')).toBeNull();
  });

  it('未登记的 server / 工具返回 null', () => {
    expect(resolveMcpBuiltinToolName('mcp__github__create_issue')).toBeNull();
    expect(resolveMcpBuiltinToolName('lsp_diagnostics')).toBeNull();
    expect(resolveMcpBuiltinToolName('read')).toBeNull();
  });

  it('内置工具名与未登记前缀不受影响', () => {
    expect(resolveMcpBuiltinToolName('lsp_diagnostics')).toBeNull();
    expect(resolveMcpBuiltinToolName('read')).toBeNull();
  });
});

describe('unwrapMcpPayload', () => {
  it('优先 structuredContent', () => {
    expect(
      unwrapMcpPayload({
        content: [{ type: 'text', text: 'ignored' }],
        structuredContent: { 'src/a.ts': [] },
      }),
    ).toEqual({ 'src/a.ts': [] });
  });

  it('回退 text 块并按 JSON 还原', () => {
    expect(unwrapMcpPayload({ content: [{ type: 'text', text: '{"a":1}' }] })).toEqual({ a: 1 });
  });

  it('非 JSON 文本原样返回', () => {
    expect(unwrapMcpPayload({ content: [{ type: 'text', text: '/r/a.ts:1:0' }] })).toBe(
      '/r/a.ts:1:0',
    );
  });

  it('非 MCP 信封原样返回（同一引用，不做无谓拷贝）', () => {
    const payload = { foo: 'bar' };
    expect(unwrapMcpPayload(payload)).toBe(payload);
    expect(unwrapMcpPayload(null)).toBeNull();
  });
});

describe('resolveMcpBuiltinBridge', () => {
  it('归一化工具名并剥掉信封', () => {
    const bridge = resolveMcpBuiltinBridge('mcp__lsp__diagnostics', {
      content: [{ type: 'text', text: '{"src/a.ts":[{"line":1}]}' }],
    });

    expect(bridge).toMatchObject({
      serverId: 'lsp',
      mcpToolName: 'diagnostics',
      toolName: 'lsp_diagnostics',
    });
    expect(bridge?.output).toEqual({ 'src/a.ts': [{ line: 1 }] });
  });

  it('codegraph 的 JSON 文本被还原成对象，供现成的结果卡消费', () => {
    const bridge = resolveMcpBuiltinBridge('mcp__codegraph__codegraph_search', {
      content: [{ type: 'text', text: '{"nodes":[{"id":1}]}' }],
    });

    expect(bridge?.toolName).toBe('codegraph_search');
    expect(bridge?.output).toEqual({ nodes: [{ id: 1 }] });
  });

  it('没有内置对应时返回 null，让调用方走原有 MCP 渲染', () => {
    expect(resolveMcpBuiltinBridge('mcp__grep_app__search', { content: [] })).toBeNull();
    expect(resolveMcpBuiltinBridge('read', { content: [{ type: 'text', text: 'x' }] })).toBeNull();
  });
});

describe('parseMaybeJsonPayload', () => {
  it('JSON 文本还原对象', () => {
    expect(parseMaybeJsonPayload('{"src/a.ts":[]}')).toEqual({ 'src/a.ts': [] });
  });

  it('位置文本原样返回', () => {
    expect(parseMaybeJsonPayload('/r/a.ts:1:0')).toBe('/r/a.ts:1:0');
  });

  it('非法 JSON 原样返回（不抛错）', () => {
    expect(parseMaybeJsonPayload('{"broken":')).toBe('{"broken":');
  });

  it('非字符串原样返回', () => {
    const payload = { a: 1 };
    expect(parseMaybeJsonPayload(payload)).toBe(payload);
  });
});
