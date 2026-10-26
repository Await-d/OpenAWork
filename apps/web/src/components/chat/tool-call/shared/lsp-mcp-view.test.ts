import { describe, expect, it } from 'vitest';

import {
  parseMaybeJsonPayload,
  resolveLspMcpToolName,
  resolveMcpLspPayload,
} from './lsp-mcp-view.js';

describe('resolveLspMcpToolName — 扁平 MCP 工具名', () => {
  it('识别 mcp__lsp__ 前缀并取出内层工具名', () => {
    expect(resolveLspMcpToolName('mcp__lsp__find_references')).toBe('find_references');
    expect(resolveLspMcpToolName('  MCP__LSP__Diagnostics ')).toBe('diagnostics');
  });

  it('非 lsp server 不命中', () => {
    expect(resolveLspMcpToolName('mcp__github__create_issue')).toBeNull();
    expect(resolveLspMcpToolName('lsp_find_references')).toBeNull();
  });

  it('空前缀不命中', () => {
    expect(resolveLspMcpToolName('mcp__lsp__')).toBeNull();
  });
});

describe('resolveLspMcpToolName — legacy mcp_call', () => {
  it('serverId=lsp 时取出 toolName', () => {
    expect(resolveLspMcpToolName('mcp_call', { serverId: 'lsp', toolName: 'symbols' })).toBe(
      'symbols',
    );
  });

  it('serverId 大小写不敏感', () => {
    expect(resolveLspMcpToolName('mcp_call', { serverId: ' LSP ', toolName: 'hover' })).toBe(
      'hover',
    );
  });

  it('其它 server / 缺少 toolName 不命中', () => {
    expect(resolveLspMcpToolName('mcp_call', { serverId: 'github', toolName: 'x' })).toBeNull();
    expect(resolveLspMcpToolName('mcp_call', { serverId: 'lsp' })).toBeNull();
  });
});

describe('resolveMcpLspPayload', () => {
  it('优先 structuredContent', () => {
    expect(
      resolveMcpLspPayload({
        content: [{ type: 'text', text: 'ignored' }],
        structuredContent: { 'src/a.ts': [] },
      }),
    ).toEqual({ 'src/a.ts': [] });
  });

  it('回退第一个 text 块', () => {
    expect(resolveMcpLspPayload({ content: [{ type: 'text', text: '/r/a.ts:1:0' }] })).toBe(
      '/r/a.ts:1:0',
    );
  });

  it('非 MCP 输出返回 null', () => {
    expect(resolveMcpLspPayload({ foo: 'bar' })).toBeNull();
    expect(resolveMcpLspPayload(null)).toBeNull();
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
