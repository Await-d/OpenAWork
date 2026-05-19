/**
 * Coverage for the flattened-MCP tool naming convention introduced
 * in PR-C: each MCP tool gets its own LLM-visible function under the
 * `mcp__<server>__<tool>` namespace, with a deterministic inverse
 * parser used by `tool-sandbox.ts` to route incoming calls back to
 * the right `(serverId, toolName)` pair.
 *
 * The contract these tests pin down:
 *   1. Forward construction is deterministic and stays inside the
 *      OpenAI/Anthropic tool-name regex `^[a-zA-Z0-9_-]{1,64}$`.
 *   2. Inverse parsing is unambiguous — no name produced by
 *      `flatMcpToolName` should mis-parse, and any non-MCP tool name
 *      should return null (so the prefix can't shadow builtins).
 *   3. Long ids fall back to a hash suffix that preserves collision
 *      resistance while keeping the leading bytes human-readable.
 */

import { describe, expect, it } from 'vitest';
import {
  flatMcpToolName,
  parseFlatMcpToolName,
  MCP_FLAT_TOOL_PREFIX,
} from '../../mcp/mcp-tool-naming.js';

const TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

describe('flatMcpToolName', () => {
  it('builds the canonical mcp__server__tool form for ASCII ids', () => {
    expect(flatMcpToolName('github', 'create_issue')).toBe('mcp__github__create_issue');
    expect(flatMcpToolName('grep_app', 'search')).toBe('mcp__grep_app__search');
  });

  it('replaces disallowed characters with underscores and collapses runs', () => {
    expect(flatMcpToolName('my-search', 'web.search')).toBe('mcp__my-search__web_search');
    expect(flatMcpToolName('a.b.c', 'x@y@z')).toBe('mcp__a_b_c__x_y_z');
  });

  it('collapses double underscores in the original ids so the segment delimiter stays unambiguous', () => {
    // toolName "x__y" has a literal `__` that would otherwise be
    // mis-parsed as a server/tool boundary. Sanitiser collapses it.
    expect(flatMcpToolName('long_name__a', 'x__y')).toBe('mcp__long_name_a__x_y');
  });

  it('always emits a name that satisfies the OpenAI tool-name regex', () => {
    const samples: Array<[string, string]> = [
      ['github', 'create_issue'],
      ['grep_app', 'search'],
      ['my-search', 'web.search'],
      ['weird name with spaces', 'tool/with/slashes'],
      ['a__b__c', 'd__e__f'],
    ];
    for (const [server, tool] of samples) {
      const flat = flatMcpToolName(server, tool);
      expect(flat).toMatch(TOOL_NAME_REGEX);
      expect(flat.length).toBeLessThanOrEqual(64);
      expect(flat.startsWith(MCP_FLAT_TOOL_PREFIX)).toBe(true);
    }
  });

  it('truncates tool name with a hash suffix when the assembled name overflows 64 chars', () => {
    const longTool = 'this_is_an_extraordinarily_long_tool_name_that_should_not_fit_unchanged';
    const flat = flatMcpToolName('github', longTool);
    expect(flat.length).toBeLessThanOrEqual(64);
    expect(flat.startsWith('mcp__github__')).toBe(true);
    // Hash suffix is `_<6 hex>` at the very end so two different long
    // tools from the same server stay distinguishable.
    expect(flat).toMatch(/_[a-f0-9]{6}$/);
  });

  it('produces distinct names for distinct (server, tool) pairs that both overflow', () => {
    const longA = flatMcpToolName('github', 'a_extraordinarily_long_tool_name_that_overflows_aaa');
    const longB = flatMcpToolName('github', 'b_extraordinarily_long_tool_name_that_overflows_bbb');
    expect(longA).not.toBe(longB);
    expect(longA.length).toBeLessThanOrEqual(64);
    expect(longB.length).toBeLessThanOrEqual(64);
  });
});

describe('parseFlatMcpToolName', () => {
  it('round-trips ASCII server / tool ids', () => {
    expect(parseFlatMcpToolName('mcp__github__create_issue')).toEqual({
      serverId: 'github',
      toolName: 'create_issue',
    });
    expect(parseFlatMcpToolName('mcp__grep_app__search')).toEqual({
      serverId: 'grep_app',
      toolName: 'search',
    });
  });

  it('returns null for names without the mcp__ prefix', () => {
    // Builtins must NEVER be mistaken for flat MCP tools, otherwise
    // the sandbox would route them through the wrong path.
    expect(parseFlatMcpToolName('read')).toBeNull();
    expect(parseFlatMcpToolName('edit')).toBeNull();
    expect(parseFlatMcpToolName('mcp_call')).toBeNull(); // legacy wrapper, single underscore
    expect(parseFlatMcpToolName('mcp_list_tools')).toBeNull();
    expect(parseFlatMcpToolName('skill')).toBeNull();
  });

  it('returns null when the segment shape is malformed', () => {
    expect(parseFlatMcpToolName('mcp__only_server')).toBeNull(); // missing tool segment
    expect(parseFlatMcpToolName('mcp____trailing')).toBeNull(); // empty server
    expect(parseFlatMcpToolName('mcp__server__')).toBeNull(); // empty tool
  });

  it('rejects double-underscored tail (defends against malformed inputs)', () => {
    // The forward sanitiser collapses `__` runs, so a parsed tool
    // name should never contain `__`. If it does, treat as a
    // protocol violation and bail out instead of guessing.
    expect(parseFlatMcpToolName('mcp__server__a__b')).toBeNull();
  });

  it('round-trips through flatMcpToolName for typical inputs', () => {
    const cases: Array<[string, string]> = [
      ['github', 'create_issue'],
      ['my-server', 'search-code'],
      ['grep_app', 'count'],
    ];
    for (const [server, tool] of cases) {
      const parsed = parseFlatMcpToolName(flatMcpToolName(server, tool));
      expect(parsed).not.toBeNull();
      expect(parsed!.serverId).toBe(server);
      expect(parsed!.toolName).toBe(tool);
    }
  });
});
