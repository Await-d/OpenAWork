/**
 * 免密钥中文引擎（baidu / sogou）回归。
 *
 * `open_websearch` MCP 的 `search` 默认已被收口，其免密钥中文引擎能力迁到原生
 * `websearch` 的 provider 插槽上（实现复用 `open-websearch` 包）。本文件断言：
 *   - `tool-aliases` 模块加载时确实完成了注册（插槽非空）；
 *   - baidu / sogou 会以正确的 engine 调到底层服务；
 *   - 输出格式与 agent-core 的 `formatResults` 一致（Merge 模式依赖该格式解析）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchExecuteMock = vi.hoisted(() => vi.fn());

vi.mock('../../mcp/open-websearch-services.js', () => ({
  loadOpenWebSearchSearchService: async () => ({ execute: searchExecuteMock }),
  loadOpenWebSearchGithubReadmeService: async () => ({ execute: vi.fn() }),
}));

import { createWebsearchTool } from '../../tools/tool-aliases.js';

function engineResponse(engine: 'bing' | 'baidu' | 'sogou' | 'startpage', title: string) {
  return {
    query: 'q',
    engines: [engine],
    partialFailures: [],
    totalResults: 1,
    results: [
      {
        title,
        description: '摘要',
        engine,
        source: 'unit-test',
        url: `https://example.com/${engine}`,
      },
    ],
  };
}

describe('websearch 免密钥中文引擎', () => {
  beforeEach(() => {
    searchExecuteMock.mockReset();
  });

  it('provider: baidu 走网关注册的引擎，并按统一三行格式输出', async () => {
    searchExecuteMock.mockResolvedValue(engineResponse('baidu', '百度结果'));
    const tool = createWebsearchTool();

    const out = await tool.execute!(
      { query: '国产大模型', provider: 'baidu', maxResults: 5 },
      new AbortController().signal,
    );

    expect(searchExecuteMock).toHaveBeenCalledWith({
      engines: ['baidu'],
      limit: 5,
      query: '国产大模型',
      searchMode: 'request',
    });
    expect(out).toContain('百度结果');
    expect(out).toContain('摘要');
    expect(out).toContain('https://example.com/baidu');
  });

  it('provider: sogou 指定 sogou 引擎', async () => {
    searchExecuteMock.mockResolvedValue(engineResponse('sogou', '搜狗结果'));
    const tool = createWebsearchTool();

    const out = await tool.execute!(
      { query: 'q', provider: 'sogou' },
      new AbortController().signal,
    );

    expect(searchExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({ engines: ['sogou'], limit: 5 }),
    );
    expect(out).toContain('搜狗结果');
  });

  it('无结果时返回与其它 provider 一致的文案', async () => {
    searchExecuteMock.mockResolvedValue({
      query: 'q',
      engines: ['baidu'],
      partialFailures: [],
      totalResults: 0,
      results: [],
    });
    const tool = createWebsearchTool();

    const out = await tool.execute!(
      { query: '冷门查询', provider: 'baidu' },
      new AbortController().signal,
    );

    expect(out).toBe('No results found for: 冷门查询');
  });

  it('provider: startpage 走网关注册的引擎', async () => {
    searchExecuteMock.mockResolvedValue(engineResponse('startpage', 'Startpage 结果'));
    const tool = createWebsearchTool();

    const out = await tool.execute!(
      { query: 'q', provider: 'startpage' },
      new AbortController().signal,
    );

    expect(searchExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({ engines: ['startpage'] }),
    );
    expect(out).toContain('Startpage 结果');
  });

  it('bing 未配置 Key 时回退到免密钥抓取引擎（而不是直接失败）', async () => {
    const savedKey = process.env['BING_API_KEY'];
    const savedAlt = process.env['BING_SEARCH_API_KEY'];
    delete process.env['BING_API_KEY'];
    delete process.env['BING_SEARCH_API_KEY'];
    try {
      searchExecuteMock.mockResolvedValue(engineResponse('bing', 'Bing 免密钥结果'));
      const tool = createWebsearchTool();

      const out = await tool.execute!(
        { query: 'q', provider: 'bing' },
        new AbortController().signal,
      );

      expect(searchExecuteMock).toHaveBeenCalledWith(
        expect.objectContaining({ engines: ['bing'] }),
      );
      expect(out).toContain('Bing 免密钥结果');
    } finally {
      if (savedKey === undefined) delete process.env['BING_API_KEY'];
      else process.env['BING_API_KEY'] = savedKey;
      if (savedAlt === undefined) delete process.env['BING_SEARCH_API_KEY'];
      else process.env['BING_SEARCH_API_KEY'] = savedAlt;
    }
  });

  it('bing 配置了 Key 时仍走官方 API，不回退到抓取', async () => {
    const savedKey = process.env['BING_API_KEY'];
    process.env['BING_API_KEY'] = 'env-bing-key';
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            webPages: {
              value: [{ name: 'Bing API 结果', url: 'https://example.com/api', snippet: 's' }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const tool = createWebsearchTool();

      const out = await tool.execute!(
        { query: 'q', provider: 'bing' },
        new AbortController().signal,
      );

      expect(searchExecuteMock).not.toHaveBeenCalled();
      expect(out).toContain('Bing API 结果');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.bing.microsoft.com'),
        expect.anything(),
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (savedKey === undefined) delete process.env['BING_API_KEY'];
      else process.env['BING_API_KEY'] = savedKey;
    }
  });

  it('maxResults 会转成 limit 并截断输出条数', async () => {
    searchExecuteMock.mockResolvedValue({
      query: 'q',
      engines: ['baidu'],
      partialFailures: [],
      totalResults: 3,
      results: Array.from({ length: 3 }, (_, index) => ({
        title: `结果 ${index + 1}`,
        description: 's',
        engine: 'baidu',
        source: 'unit-test',
        url: `https://example.com/${index + 1}`,
      })),
    });
    const tool = createWebsearchTool();

    const out = await tool.execute!(
      { query: 'q', provider: 'baidu', maxResults: 2 },
      new AbortController().signal,
    );

    expect(searchExecuteMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
    expect(out).toContain('结果 1');
    expect(out).toContain('结果 2');
    expect(out).not.toContain('结果 3');
  });
});
