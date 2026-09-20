import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenWebSearchRuntime } from 'open-websearch/build/runtime/createRuntime.js';
import { config } from 'open-websearch/build/config.js';
import {
  assertPublicHttpUrlResolved,
  __setDnsLookupForTests,
} from 'open-websearch/build/utils/urlSafety.js';
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

// 上游 urlSafety.js 位于 node_modules，是 vitest 的外部依赖：对 node:dns/promises 的
// vi.mock 不会穿透到它。改用上游为此导出的测试钩子，让预检走同一个 DNS mock。
beforeEach(() => {
  __setDnsLookupForTests(dnsLookupMock);
});

afterEach(() => {
  __setDnsLookupForTests();
});

function readFirstText(result: Awaited<ReturnType<typeof executeOpenWebSearchTool>>): string {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== 'text' || typeof firstContent.text !== 'string') {
    throw new Error('expected first MCP content item to be text');
  }
  return firstContent.text;
}

function callFetchWeb(url = 'https://example.com/page') {
  return callOpenWebSearchVirtualMcp('session-1', {
    serverId: 'open_websearch',
    toolName: 'fetch_web',
    arguments: { url },
  });
}

async function captureRejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the call to reject');
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
    dnsLookupMock.mockImplementation(async (hostname: string) => {
      // 上游仅按字符串匹配 localhost / *.localhost，`localhost.` 这种尾点写法会走到
      // DNS 解析，这里按真实解析结果返回回环地址。
      if (hostname === 'localhost.') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      const entries =
        hostname === 'github.com' || hostname === 'www.github.com'
          ? [{ address: '140.82.114.3', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }];
      return entries;
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

  describe('fetch_web SSRF diagnostics', () => {
    const originalFakeIpCidrs = [...config.fakeIpCidrs];

    afterEach(() => {
      config.fakeIpCidrs = [...originalFakeIpCidrs];
    });

    it('localizes the upstream resolved-private SSRF error for the request hop', async () => {
      requestWithSafeRedirectsMock.mockRejectedValueOnce(
        new Error(
          'Request URL resolves to a private or local network target, which is not allowed',
        ),
      );

      const result = await callFetchWeb();

      expect(result.isError).toBe(true);
      const message = readFirstText(result);
      expect(message).toContain('只支持公开 HTTP(S) 网页 URL。');
      expect(message).not.toContain('private or local');
    });

    it('localizes the upstream literal-private SSRF error', async () => {
      requestWithSafeRedirectsMock.mockRejectedValueOnce(
        new Error('Request URL points to a private or local network target, which is not allowed'),
      );

      const result = await callFetchWeb();

      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('只支持公开 HTTP(S) 网页 URL。');
      expect(readFirstText(result)).not.toContain('private or local');
    });

    it('localizes the upstream redirect-hop SSRF error', async () => {
      requestWithSafeRedirectsMock.mockRejectedValueOnce(
        new Error(
          'Redirect target resolves to a private or local network target, which is not allowed',
        ),
      );

      const result = await callFetchWeb();

      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('只支持公开 HTTP(S) 网页 URL。');
      expect(readFirstText(result)).not.toContain('private or local');
    });

    it('localizes the upstream unresolvable-host error', async () => {
      requestWithSafeRedirectsMock.mockRejectedValueOnce(
        new Error('Request URL could not be resolved'),
      );

      const result = await callFetchWeb();

      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('域名解析失败');
    });

    it('localizes the upstream non-http scheme error', async () => {
      requestWithSafeRedirectsMock.mockRejectedValueOnce(
        new Error('Request URL must use HTTP or HTTPS'),
      );

      const result = await callFetchWeb();

      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('只支持公开 HTTP(S) 网页 URL。');
    });

    it('allows DNS answers matching the configured fake-IP CIDRs', async () => {
      config.fakeIpCidrs = ['198.18.0.0/15'];
      dnsLookupMock.mockResolvedValueOnce([{ address: '198.18.0.2', family: 4 }]);

      const result = await callFetchWeb();

      expect(requestWithSafeRedirectsMock).toHaveBeenCalledTimes(1);
      expect(result.isError).toBeUndefined();
    });

    it('rejects a private DNS answer even when fake-IP CIDRs are configured', async () => {
      config.fakeIpCidrs = ['198.18.0.0/15'];
      dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]);

      const result = await callFetchWeb('https://cluster.internal/page');

      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('只支持公开 HTTP(S) 网页 URL。');
      expect(requestWithSafeRedirectsMock).not.toHaveBeenCalled();
    });

    it('keeps literal fake-IP URLs blocked even when fake-IP CIDRs are configured', async () => {
      config.fakeIpCidrs = ['198.18.0.0/15'];

      const result = await callFetchWeb('http://198.18.0.1/');

      expect(result.isError).toBe(true);
      expect(readFirstText(result)).toContain('只支持公开 HTTP(S) 网页 URL。');
      expect(requestWithSafeRedirectsMock).not.toHaveBeenCalled();
    });

    it('localizes the real upstream SSRF messages (contract binding)', async () => {
      dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]);
      const resolvedMessage = await captureRejectionMessage(() =>
        assertPublicHttpUrlResolved('https://example.com/', 'Request URL'),
      );
      expect(resolvedMessage).toContain('private or local network');

      requestWithSafeRedirectsMock.mockRejectedValueOnce(new Error(resolvedMessage));
      const resolvedResult = await callFetchWeb();
      expect(readFirstText(resolvedResult)).toContain('只支持公开 HTTP(S) 网页 URL。');
      expect(readFirstText(resolvedResult)).not.toContain('private or local');

      dnsLookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const unresolvedMessage = await captureRejectionMessage(() =>
        assertPublicHttpUrlResolved('https://example.com/', 'Request URL'),
      );
      expect(unresolvedMessage).toContain('could not be resolved');

      requestWithSafeRedirectsMock.mockRejectedValueOnce(new Error(unresolvedMessage));
      const unresolvedResult = await callFetchWeb();
      expect(readFirstText(unresolvedResult)).toContain('域名解析失败');
    });
  });
});
