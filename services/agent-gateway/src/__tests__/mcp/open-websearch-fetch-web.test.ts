import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { buildAxiosRequestOptionsMock, dnsLookupMock, requestWithSafeRedirectsMock } = vi.hoisted(
  () => ({
    buildAxiosRequestOptionsMock: vi.fn(() => ({})),
    dnsLookupMock: vi.fn(),
    requestWithSafeRedirectsMock: vi.fn(),
  }),
);

vi.mock('open-websearch/build/utils/httpRequest.js', () => ({
  buildAxiosRequestOptions: buildAxiosRequestOptionsMock,
  requestWithSafeRedirects: requestWithSafeRedirectsMock,
}));

vi.mock('node:dns/promises', () => ({
  lookup: dnsLookupMock,
}));

import { fetchOpenWebSearchPage } from '../../mcp/open-websearch-fetch-web.js';
import { extractReadableContent, extractTitle } from '../../mcp/open-websearch-html.js';
import type { MCPToolResult } from '@openAwork/mcp-client';
import { callOpenWebSearchVirtualMcp } from '../../mcp/virtual-open-websearch-mcp.js';
import { __setDnsLookupForTests } from 'open-websearch/build/utils/urlSafety.js';

// 上游 urlSafety.js 位于 node_modules，是 vitest 的外部依赖：对 node:dns/promises 的
// vi.mock 不会穿透到它。改用上游为此导出的测试钩子，让预检走同一个 DNS mock。
beforeEach(() => {
  __setDnsLookupForTests(dnsLookupMock);
});

afterEach(() => {
  __setDnsLookupForTests();
});

const NAV_MARKER = '站点导航链接入口';
const FOOTER_MARKER = '版权页脚标记文本';
const ARTICLE_SENTENCE =
  '深度工作的核心在于把注意力集中到高价值任务上，并通过刻意练习持续提升认知能力，同时用清晰的边界抵御即时通讯与琐碎事务的持续打扰。';
const ARTICLE_HTML = `<!doctype html>
<html lang="zh">
  <head>
    <title>深度工作指南 | 示例站</title>
    <meta name="description" content="关于深度工作的示例文章。">
  </head>
  <body>
    <nav><a href="/">${NAV_MARKER}</a></nav>
    <article>
      <h1>深度工作指南</h1>
      <p>${ARTICLE_SENTENCE}</p>
      <p>${ARTICLE_SENTENCE}</p>
      <p>${ARTICLE_SENTENCE}</p>
      <p>${ARTICLE_SENTENCE}</p>
    </article>
    <footer>${FOOTER_MARKER}</footer>
  </body>
</html>`;

const SMALL_HTML =
  '<html><head><title>Example Page</title></head><body><main><p>OpenAWork body</p></main></body></html>';

function mockHtmlResponse(body: string, contentType = 'text/html; charset=utf-8'): void {
  requestWithSafeRedirectsMock.mockResolvedValueOnce({
    data: body,
    headers: { 'content-type': contentType },
    request: { res: { responseUrl: 'https://example.com/page' } },
    status: 200,
  });
}

function readFirstText(result: MCPToolResult): string {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== 'text' || typeof firstContent.text !== 'string') {
    throw new Error('expected first MCP content item to be text');
  }
  return firstContent.text;
}

function axiosLikeError(message: string, fields: { code?: string; status?: number }): Error {
  return Object.assign(new Error(message), {
    ...(fields.status === undefined ? {} : { response: { status: fields.status } }),
    ...(fields.code === undefined ? {} : { code: fields.code }),
  });
}

function callFetchWeb(url = 'https://example.com/page'): Promise<MCPToolResult> {
  return callOpenWebSearchVirtualMcp('session-1', {
    serverId: 'open_websearch',
    toolName: 'fetch_web',
    arguments: { url },
  });
}

describe('fetchOpenWebSearchPage readability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAxiosRequestOptionsMock.mockReturnValue({});
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('adopts the Mozilla Readability article text when readability is true', async () => {
    mockHtmlResponse(ARTICLE_HTML);

    const result = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
      readability: true,
    });

    expect(result.readabilityApplied).toBe(true);
    expect(result.content).toContain(ARTICLE_SENTENCE);
    expect(result.content).not.toContain(NAV_MARKER);
    expect(result.content).not.toContain(FOOTER_MARKER);
    expect(result.title).toBe('深度工作指南 | 示例站');
  });

  it('keeps the container extractor byte-for-byte when readability is omitted or false', async () => {
    mockHtmlResponse(ARTICLE_HTML);
    const omitted = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
    });

    mockHtmlResponse(ARTICLE_HTML);
    const disabled = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
      readability: false,
    });

    const legacyContent = extractReadableContent({
      contentType: 'text/html; charset=utf-8',
      finalUrl: 'https://example.com/page',
      raw: ARTICLE_HTML,
    });
    expect(omitted.content).toBe(legacyContent);
    expect(disabled.content).toBe(legacyContent);
    expect(omitted).not.toHaveProperty('readabilityApplied');
    expect(disabled).not.toHaveProperty('readabilityApplied');
    expect(omitted.title).toBe(extractTitle(ARTICLE_HTML));

    mockHtmlResponse(SMALL_HTML);
    const smallPage = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
    });
    expect(smallPage.content).toBe('OpenAWork body');
    expect(smallPage.title).toBe('Example Page');
  });

  it('reports readabilityApplied false without changing content for non-HTML bodies', async () => {
    mockHtmlResponse('纯文本正文内容', 'text/plain; charset=utf-8');

    const result = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
      readability: true,
    });

    expect(result.readabilityApplied).toBe(false);
    expect(result.content).toBe('纯文本正文内容');
  });
});

describe('fetch_web failure diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAxiosRequestOptionsMock.mockReturnValue({});
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it.each([
    { status: 401, expected: '需要登录' },
    { status: 403, expected: '反爬' },
    { status: 404, expected: '不存在' },
    { status: 408, expected: '响应超时' },
    { status: 429, expected: '请求过于频繁' },
    { status: 451, expected: '法律原因' },
    { status: 503, expected: '服务器错误' },
  ])('maps HTTP $status to an actionable Chinese diagnostic', async ({ status, expected }) => {
    requestWithSafeRedirectsMock.mockRejectedValueOnce(
      axiosLikeError(`Request failed with status code ${status}`, { status }),
    );

    const result = await callFetchWeb();

    expect(result.isError).toBe(true);
    const message = readFirstText(result);
    expect(message).toContain(expected);
    expect(message).toContain(String(status));
  });

  it('maps timeout error codes to a retry hint', async () => {
    requestWithSafeRedirectsMock.mockRejectedValueOnce(
      axiosLikeError('timeout of 20000ms exceeded', { code: 'ECONNABORTED' }),
    );

    const result = await callFetchWeb();

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain('请求超时');
  });

  it('maps DNS error codes to a URL hint', async () => {
    requestWithSafeRedirectsMock.mockRejectedValueOnce(
      axiosLikeError('getaddrinfo ENOTFOUND no-such-host.invalid', { code: 'ENOTFOUND' }),
    );

    const result = await callFetchWeb('https://no-such-host.invalid/page');

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain('域名解析失败');
  });

  it('falls back to the generic extraction message for unknown failures', async () => {
    requestWithSafeRedirectsMock.mockRejectedValueOnce(new Error('socket hang up'));

    const result = await callFetchWeb();

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toBe('网页提取失败：socket hang up');
  });
});
