import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenWebSearchRuntime } from 'open-websearch/build/runtime/createRuntime.js';
const { createOpenWebSearchRuntimeMock, dnsLookupMock } = vi.hoisted(() => ({
  createOpenWebSearchRuntimeMock: vi.fn(),
  dnsLookupMock: vi.fn(),
}));

vi.mock('open-websearch/build/runtime/createRuntime.js', () => ({
  createOpenWebSearchRuntime: createOpenWebSearchRuntimeMock,
}));

vi.mock('node:dns/promises', () => ({
  lookup: dnsLookupMock,
}));

import {
  callOpenWebSearchVirtualMcp,
  executeOpenWebSearchTool,
  OPEN_WEBSEARCH_VIRTUAL_MCP_TOOLS,
} from '../../mcp/virtual-open-websearch-mcp.js';

function readFirstText(result: Awaited<ReturnType<typeof executeOpenWebSearchTool>>): string {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== 'text' || typeof firstContent.text !== 'string') {
    throw new Error('expected first MCP content item to be text');
  }
  return firstContent.text;
}

function createRuntime(): OpenWebSearchRuntime {
  return {
    services: {
      search: {
        execute: vi.fn(async (input) => ({
          query: input.query,
          engines: [...input.engines],
          results: [
            {
              title: 'Open WebSearch',
              description: 'builtin search result',
              engine: input.engines[0] ?? 'bing',
              source: 'unit-test',
              url: 'https://example.com/open-websearch',
            },
          ],
          partialFailures: [],
          totalResults: 1,
        })),
      },
      fetchWeb: {
        execute: vi.fn(async (input) => ({
          url: input.url,
          maxChars: input.maxChars,
          readability: input.readability ?? false,
        })),
      },
      fetchGithubReadme: {
        execute: vi.fn(async ({ url }) =>
          url.includes('missing') ? null : '# OpenAWork\n\nREADME content',
        ),
      },
    },
  };
}

describe('virtual open websearch mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOpenWebSearchRuntimeMock.mockReset();
    dnsLookupMock.mockReset();
    dnsLookupMock.mockImplementation(async (hostname: string, options?: { all?: boolean }) => {
      const entries =
        hostname === 'github.com' || hostname === 'www.github.com'
          ? [{ address: '140.82.114.3', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }];
      return options?.all ? entries : entries[0];
    });
  });

  it('exposes the curated search, fetch_web, and fetch_github_readme tools', () => {
    expect(OPEN_WEBSEARCH_VIRTUAL_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      'search',
      'fetch_web',
      'fetch_github_readme',
    ]);
  });

  it('lazy-loads and caches the runtime for virtual MCP calls', async () => {
    createOpenWebSearchRuntimeMock.mockReturnValue(createRuntime());

    await callOpenWebSearchVirtualMcp('session-1', {
      serverId: 'open_websearch',
      toolName: 'search',
      arguments: { query: 'openawork mcp' },
    });
    await callOpenWebSearchVirtualMcp('session-1', {
      serverId: 'open_websearch',
      toolName: 'fetch_web',
      arguments: { url: 'https://example.com/page' },
    });

    expect(createOpenWebSearchRuntimeMock).toHaveBeenCalledTimes(1);
  });

  it('forces request mode and default engines for search', async () => {
    const runtime = createRuntime();
    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'search',
      arguments: { query: 'openawork mcp' },
    });

    expect(runtime.services.search.execute).toHaveBeenCalledWith({
      query: 'openawork mcp',
      limit: 8,
      engines: ['bing', 'duckduckgo'],
      searchMode: 'request',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      query: 'openawork mcp',
      engines: ['bing', 'duckduckgo'],
      totalResults: 1,
    });
  });

  it('returns a typed error for invalid search input', async () => {
    const runtime = createRuntime();
    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'search',
      arguments: { query: '' },
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result).length).toBeGreaterThan(0);
    expect(runtime.services.search.execute).not.toHaveBeenCalled();
  });

  it('maps fetch_web structured content without real network access', async () => {
    const runtime = createRuntime();
    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'fetch_web',
      arguments: { url: 'https://example.com/page' },
    });

    expect(runtime.services.fetchWeb.execute).toHaveBeenCalledWith({
      url: 'https://example.com/page',
      maxChars: 30000,
    });
    expect(result.structuredContent).toEqual({
      url: 'https://example.com/page',
      maxChars: 30000,
      readability: false,
    });
  });

  it('rejects non-public or non-http fetch_web targets before touching the runtime', async () => {
    const runtime = createRuntime();
    const invalidResults = await Promise.all([
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_web',
        arguments: { url: 'file:///etc/passwd' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_web',
        arguments: { url: 'data:text/plain,hello' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_web',
        arguments: { url: 'ftp://example.com/archive.txt' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_web',
        arguments: { url: 'http://127.0.0.1:3000/internal' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_web',
        arguments: { url: 'http://localhost./internal' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_web',
        arguments: { url: 'http://[::1]:3000/internal' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_web',
        arguments: { url: 'http://[fd00::1]/internal' },
      }),
    ]);

    for (const result of invalidResults) {
      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('HTTP(S)');
    }
    expect(runtime.services.fetchWeb.execute).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private addresses before fetch_web executes', async () => {
    const runtime = createRuntime();
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]);

    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'fetch_web',
      arguments: { url: 'https://cluster.internal/page' },
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain('HTTP(S)');
    expect(runtime.services.fetchWeb.execute).not.toHaveBeenCalled();
  });

  it('maps missing github readme to an MCP error result', async () => {
    const runtime = createRuntime();
    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'fetch_github_readme',
      arguments: { url: 'https://github.com/openawork/missing' },
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain('README');
  });

  it('rejects non-github readme targets before touching the runtime', async () => {
    const runtime = createRuntime();
    const invalidResults = await Promise.all([
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_github_readme',
        arguments: { url: 'https://example.com/openawork/repo' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_github_readme',
        arguments: { url: 'https://github.com/openawork/repo/issues/1' },
      }),
      executeOpenWebSearchTool(runtime, {
        serverId: 'open_websearch',
        toolName: 'fetch_github_readme',
        arguments: { url: 'https://github.com/openawork/repo/blob/main/README.md' },
      }),
    ]);

    for (const result of invalidResults) {
      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('GitHub');
    }
    expect(runtime.services.fetchGithubReadme.execute).not.toHaveBeenCalled();
  });

  it('accepts a repository root url with a trailing slash for github readme fetch', async () => {
    const runtime = createRuntime();
    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'fetch_github_readme',
      arguments: { url: 'https://github.com/openawork/repo/' },
    });

    expect(result.isError).toBeUndefined();
    expect(readFirstText(result)).toContain('OpenAWork');
    expect(runtime.services.fetchGithubReadme.execute).toHaveBeenCalledWith({
      url: 'https://github.com/openawork/repo/',
    });
  });

  it('rejects github repository urls when github.com resolves to a private address', async () => {
    const runtime = createRuntime();
    dnsLookupMock.mockResolvedValueOnce([{ address: '192.168.1.8', family: 4 }]);

    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'fetch_github_readme',
      arguments: { url: 'https://github.com/openawork/repo' },
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain('GitHub');
    expect(runtime.services.fetchGithubReadme.execute).not.toHaveBeenCalled();
  });

  it('returns a typed error for unknown tool names', async () => {
    const runtime = createRuntime();
    const result = await executeOpenWebSearchTool(runtime, {
      serverId: 'open_websearch',
      toolName: 'unknown_tool',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain('未知的 Open WebSearch 工具');
  });
});
