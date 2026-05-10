/**
 * Coverage for `buildFlatMcpToolDefinitions` — the PR-C step that
 * turns a catalog snapshot into LLM-visible top-level tool
 * definitions. The tests pin down:
 *
 *   1. Connected servers' tools each become a `GatewayToolDefinition`
 *      with the canonical `mcp__<server>__<tool>` name and a
 *      well-formed `function.parameters` shape (object schema).
 *   2. Disabled / errored servers are skipped — we never advertise
 *      tools the user can't actually call.
 *   3. The env-flag escape hatch (`OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1`)
 *      returns empty arrays so the legacy wrappers remain canonical.
 *   4. The route map round-trips back to (serverId, toolName) pairs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFlatMcpToolDefinitions } from '../mcp-flat-tool-defs.js';
import type { MCPServerToolCatalog } from '../mcp-runtime.js';

function makeCatalog(overrides: Partial<MCPServerToolCatalog>): MCPServerToolCatalog {
  return {
    serverId: 'github',
    serverName: 'GitHub',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    tools: [],
    ...overrides,
  };
}

describe('buildFlatMcpToolDefinitions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['OPENAWORK_DISABLE_MCP_FLAT_TOOLS'];
  });

  it('emits a tool definition per tool of every connected server', () => {
    const result = buildFlatMcpToolDefinitions([
      makeCatalog({
        serverId: 'github',
        serverName: 'GitHub',
        tools: [
          {
            name: 'create_issue',
            description: 'Open a new issue',
            inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
          },
          {
            name: 'list_repos',
            description: '',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
    ]);

    expect(result.definitions.map((d) => d.function.name)).toEqual([
      'mcp__github__create_issue',
      'mcp__github__list_repos',
    ]);

    // Description carries the server name so the model has a
    // disambiguating prefix when picking between similarly named
    // tools across servers.
    const create = result.definitions.find((d) => d.function.name === 'mcp__github__create_issue');
    expect(create?.function.description).toContain('[mcp:GitHub]');
    expect(create?.function.description).toContain('Open a new issue');

    // Parameters are normalised into the {type:'object', properties,
    // required, additionalProperties} shape regardless of what the
    // server returned.
    expect(create?.function.parameters.type).toBe('object');
    expect(create?.function.parameters.properties).toEqual({ title: { type: 'string' } });
    expect(create?.function.parameters.required).toEqual([]);
    expect(create?.function.parameters.additionalProperties).toBe(false);
  });

  it('skips servers whose status is not "connected"', () => {
    const result = buildFlatMcpToolDefinitions([
      makeCatalog({
        serverId: 'github',
        status: 'connected',
        tools: [{ name: 't1', description: '', inputSchema: {} }],
      }),
      makeCatalog({
        serverId: 'gitea',
        status: 'disabled',
        tools: [{ name: 't_disabled', description: '', inputSchema: {} }],
      }),
      makeCatalog({
        serverId: 'gitlab',
        status: 'error',
        tools: [{ name: 't_errored', description: '', inputSchema: {} }],
      }),
    ]);

    expect(result.definitions.map((d) => d.function.name)).toEqual(['mcp__github__t1']);
  });

  it('returns the canonical (serverId, toolName) pair via the route map', () => {
    const result = buildFlatMcpToolDefinitions([
      makeCatalog({
        serverId: 'my-search',
        tools: [{ name: 'web.search', description: '', inputSchema: {} }],
      }),
    ]);
    // The flat name sanitises `.` → `_`; the routeMap stores the
    // pre-sanitise originals so the sandbox can route to the real
    // server/tool pair.
    const entries = Array.from(result.routeMap.entries());
    expect(entries).toHaveLength(1);
    const [flatName, route] = entries[0]!;
    expect(flatName).toBe('mcp__my-search__web_search');
    expect(route).toEqual({ serverId: 'my-search', toolName: 'web.search' });
  });

  it('drops collisions and warns rather than producing duplicate tool names', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // Two servers whose ids differ only in characters that the
      // sanitiser collapses to the same form: `srv-a` and `srv_a`
      // both become `srv-a` after underscore collapse... wait, they
      // don't. Use a forced collision: identical post-sanitise names
      // by injecting two tools with names that flatten to the same
      // `__<tool>` segment after truncation. The simplest test is two
      // tools with identical sanitised names on the same server.
      const result = buildFlatMcpToolDefinitions([
        makeCatalog({
          serverId: 'srv',
          tools: [
            { name: 'a.b', description: 'first', inputSchema: {} },
            { name: 'a/b', description: 'second', inputSchema: {} },
          ],
        }),
      ]);
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0]!.function.description).toContain('first');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns empty arrays when OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1 (env escape hatch)', async () => {
    process.env['OPENAWORK_DISABLE_MCP_FLAT_TOOLS'] = '1';
    // Re-import so the env read inside `mcp-tool-naming.ts` picks up
    // the new value.
    const mod = await import('../mcp-flat-tool-defs.js');
    const result = mod.buildFlatMcpToolDefinitions([
      makeCatalog({
        tools: [{ name: 'create_issue', description: '', inputSchema: {} }],
      }),
    ]);
    expect(result.definitions).toEqual([]);
    expect(result.routeMap.size).toBe(0);
  });
});
