import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenWebSearchRuntime } from 'open-websearch/build/runtime/createRuntime.js';
const {
  buildAxiosRequestOptionsMock,
  createOpenWebSearchRuntimeMock,
  createSearchServiceMock,
  dnsLookupMock,
  fetchGithubReadmeMock,
  requestWithSafeRedirectsMock,
  searchBaiduMock,
  searchBingMock,
  searchDuckDuckGoMock,
  searchSogouMock,
  searchStartpageMock,
  searchServiceExecuteMock,
} = vi.hoisted(() => ({
  buildAxiosRequestOptionsMock: vi.fn(() => ({})),
  createOpenWebSearchRuntimeMock: vi.fn(),
  createSearchServiceMock: vi.fn(),
  dnsLookupMock: vi.fn(),
  fetchGithubReadmeMock: vi.fn(),
  requestWithSafeRedirectsMock: vi.fn(),
  searchBaiduMock: vi.fn(),
  searchBingMock: vi.fn(),
  searchDuckDuckGoMock: vi.fn(),
  searchSogouMock: vi.fn(),
  searchStartpageMock: vi.fn(),
  searchServiceExecuteMock: vi.fn(),
}));

vi.mock('open-websearch/build/runtime/createRuntime.js', () => ({
  createOpenWebSearchRuntime: createOpenWebSearchRuntimeMock,
}));

vi.mock('open-websearch/build/core/search/searchService.js', () => ({
  createSearchService: createSearchServiceMock,
}));

vi.mock('open-websearch/build/engines/baidu/baidu.js', () => ({
  searchBaidu: searchBaiduMock,
}));

vi.mock('open-websearch/build/engines/bing/bing.js', () => ({
  searchBing: searchBingMock,
}));

vi.mock('open-websearch/build/engines/duckduckgo/index.js', () => ({
  searchDuckDuckGo: searchDuckDuckGoMock,
}));

vi.mock('open-websearch/build/engines/sogou/index.js', () => ({
  searchSogou: searchSogouMock,
}));

vi.mock('open-websearch/build/engines/startpage/index.js', () => ({
  searchStartpage: searchStartpageMock,
}));

vi.mock('open-websearch/build/engines/github/index.js', () => ({
  fetchGithubReadme: fetchGithubReadmeMock,
}));

vi.mock('open-websearch/build/utils/httpRequest.js', () => ({
  buildAxiosRequestOptions: buildAxiosRequestOptionsMock,
  requestWithSafeRedirects: requestWithSafeRedirectsMock,
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
    buildAxiosRequestOptionsMock.mockReset();
    buildAxiosRequestOptionsMock.mockReturnValue({});
    createOpenWebSearchRuntimeMock.mockReset();
    createSearchServiceMock.mockReset();
    dnsLookupMock.mockReset();
    fetchGithubReadmeMock.mockReset();
    requestWithSafeRedirectsMock.mockReset();
    searchBaiduMock.mockReset();
    searchBingMock.mockReset();
    searchDuckDuckGoMock.mockReset();
    searchSogouMock.mockReset();
    searchStartpageMock.mockReset();
    searchServiceExecuteMock.mockReset();
    dnsLookupMock.mockImplementation(async (hostname: string, options?: { all?: boolean }) => {
      const entries =
        hostname === 'github.com' || hostname === 'www.github.com'
          ? [{ address: '140.82.114.3', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }];
      return options?.all ? entries : entries[0];
    });
    createSearchServiceMock.mockReturnValue({
      execute: searchServiceExecuteMock,
    });
    searchServiceExecuteMock.mockImplementation(async (input) => ({
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
    }));
    fetchGithubReadmeMock.mockResolvedValue('# OpenAWork\n\nREADME content');
    requestWithSafeRedirectsMock.mockResolvedValue({
      data: '<html><head><title>Example Page</title></head><body><main><p>OpenAWork body</p></main></body></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      request: { res: { responseUrl: 'https://example.com/page' } },
      status: 200,
    });
  });

  it('exposes the curated search, fetch_web, and fetch_github_readme tools', () => {
    expect(OPEN_WEBSEARCH_VIRTUAL_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      'search',
      'fetch_web',
      'fetch_github_readme',
    ]);
  });

  it('search virtual call does not depend on the full runtime import chain', async () => {
    createOpenWebSearchRuntimeMock.mockImplementation(() => {
      throw new Error("Cannot find module 'jsdom/.../xhr-sync-worker.js'");
    });

    const result = await callOpenWebSearchVirtualMcp('session-1', {
      serverId: 'open_websearch',
      toolName: 'search',
      arguments: { query: 'openawork mcp' },
    });

    expect(result.isError).toBeUndefined();
    expect(createOpenWebSearchRuntimeMock).not.toHaveBeenCalled();
    expect(searchServiceExecuteMock).toHaveBeenCalledWith({
      query: 'openawork mcp',
      limit: 8,
      engines: ['bing', 'duckduckgo'],
      searchMode: 'request',
    });
  });

  it('fetch_github_readme virtual call does not depend on the full runtime import chain', async () => {
    createOpenWebSearchRuntimeMock.mockImplementation(() => {
      throw new Error("Cannot find module 'jsdom/.../xhr-sync-worker.js'");
    });

    const result = await callOpenWebSearchVirtualMcp('session-1', {
      serverId: 'open_websearch',
      toolName: 'fetch_github_readme',
      arguments: { url: 'https://github.com/openawork/repo' },
    });

    expect(result.isError).toBeUndefined();
    expect(createOpenWebSearchRuntimeMock).not.toHaveBeenCalled();
    expect(readFirstText(result)).toContain('OpenAWork');
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

  it('fetch_web virtual call uses the local extractor and avoids the full runtime import chain', async () => {
    createOpenWebSearchRuntimeMock.mockImplementation(() => {
      throw new Error("Cannot read property 'some' of undefined");
    });

    const result = await callOpenWebSearchVirtualMcp('session-1', {
      serverId: 'open_websearch',
      toolName: 'fetch_web',
      arguments: { url: 'https://example.com/page', maxChars: 30000 },
    });

    expect(result.isError).toBeUndefined();
    expect(createOpenWebSearchRuntimeMock).not.toHaveBeenCalled();
    expect(requestWithSafeRedirectsMock).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      url: 'https://example.com/page',
      finalUrl: 'https://example.com/page',
      title: 'Example Page',
      retrievalMethod: 'request',
    });
  });

  it('returns remote HTTP failures as stable MCP errors', async () => {
    requestWithSafeRedirectsMock.mockRejectedValueOnce(
      new Error('Request failed with status code 521'),
    );

    const result = await callOpenWebSearchVirtualMcp('session-1', {
      serverId: 'open_websearch',
      toolName: 'fetch_web',
      arguments: { url: 'https://example.com/page' },
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain('521');
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
