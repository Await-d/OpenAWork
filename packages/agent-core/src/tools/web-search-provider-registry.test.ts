/**
 * 免密钥引擎插槽（`registerWebSearchProvider`）回归。
 *
 * `baidu` / `sogou` 没有公开搜索 API，实现依赖 `open-websearch`（网关侧依赖），
 * 因此 agent-core 只定义插槽、由宿主注册。本文件锁定两条契约：
 *   1. 未注册时给出**可操作**错误（指向 duckduckgo 或注册方法），而不是静默
 *      失败或抛裸英文；
 *   2. 注册后单提供商调用与多提供商编排（`searchMultiProvider`）都能命中同一插槽。
 *
 * 注意顺序：模块级注册表在文件内共享，故「未注册」用例必须声明在最前。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  registerWebSearchProvider,
  searchMultiProvider,
  webSearchTool,
  type WebSearchProviderExecutor,
} from './web-search.js';

describe('websearch 免密钥引擎插槽', () => {
  it('未注册时抛出含配置指引的错误', async () => {
    for (const provider of ['baidu', 'startpage'] as const) {
      const error = await webSearchTool
        .execute({ query: 'q', provider }, new AbortController().signal)
        .then(
          () => null,
          (err: unknown) => err as Error,
        );

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain('尚未注册');
      expect(error?.message).toContain('registerWebSearchProvider');
      expect(error?.message).toContain('duckduckgo');
    }
  });

  it('注册后单提供商调用命中插槽，并把 maxResults 透传下去', async () => {
    const executor = vi.fn<WebSearchProviderExecutor>(
      async () => '1. 结果\n   摘要\n   https://example.com/a',
    );
    registerWebSearchProvider('baidu', executor);

    const out = await webSearchTool.execute(
      { query: '国产大模型', provider: 'baidu', maxResults: 7 },
      new AbortController().signal,
    );

    expect(out).toContain('https://example.com/a');
    expect(executor).toHaveBeenCalledTimes(1);
    const [query, config, signal] = executor.mock.calls[0]!;
    expect(query).toBe('国产大模型');
    expect(config.maxResults).toBe(7);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('多提供商编排共用同一插槽', async () => {
    const executor = vi.fn<WebSearchProviderExecutor>(
      async () => '1. 结果\n   摘要\n   https://example.com/sogou',
    );
    registerWebSearchProvider('sogou', executor);

    const out = await searchMultiProvider(
      '开源模型',
      { providers: [{ provider: 'sogou' }], rolloutMode: 'sequential', maxResults: 3 },
      new AbortController().signal,
    );

    expect(out).toContain('https://example.com/sogou');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('重复注册同一 provider 时后者覆盖前者', async () => {
    registerWebSearchProvider('baidu', async () => 'first');
    registerWebSearchProvider('baidu', async () => 'second');

    const out = await webSearchTool.execute(
      { query: 'q', provider: 'baidu' },
      new AbortController().signal,
    );

    expect(out).toBe('second');
  });

  it('bing 未配置 Key 且宿主未注册回退引擎时，仍抛出 API Key 指引', async () => {
    const error = await webSearchTool
      .execute({ query: 'q', provider: 'bing' }, new AbortController().signal)
      .then(
        () => null,
        (err: unknown) => err as Error,
      );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('BING_API_KEY');
  });

  it('bing 未配置 Key 时回退到注册的免密钥执行器', async () => {
    const keylessBing = vi.fn<WebSearchProviderExecutor>(
      async () => '1. 抓取结果\n   摘要\n   https://example.com/bing',
    );
    registerWebSearchProvider('bing', keylessBing);

    const out = await webSearchTool.execute(
      { query: 'q', provider: 'bing' },
      new AbortController().signal,
    );

    expect(out).toContain('https://example.com/bing');
    expect(keylessBing).toHaveBeenCalledTimes(1);
  });

  it('bing 配置了 Key 时走官方 API，不回退到抓取', async () => {
    const keylessBing = vi.fn<WebSearchProviderExecutor>(async () => 'should-not-be-used');
    registerWebSearchProvider('bing', keylessBing);

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            webPages: {
              value: [{ name: '官方 API 结果', url: 'https://example.com/api', snippet: 's' }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const out = await webSearchTool.execute(
        { query: 'q', provider: 'bing', apiKey: 'k' },
        new AbortController().signal,
      );

      expect(keylessBing).not.toHaveBeenCalled();
      expect(out).toContain('官方 API 结果');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.bing.microsoft.com'),
        expect.anything(),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
