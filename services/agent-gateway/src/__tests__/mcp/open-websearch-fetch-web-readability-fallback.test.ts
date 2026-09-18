import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildAxiosRequestOptionsMock, readabilityMockState, requestWithSafeRedirectsMock } =
  vi.hoisted(() => ({
    buildAxiosRequestOptionsMock: vi.fn(() => ({})),
    readabilityMockState: {
      mode: 'article' as 'article' | 'throw',
      textContent: '可读性采纳的正文',
      title: '可读性标题',
    },
    requestWithSafeRedirectsMock: vi.fn(),
  }));

vi.mock('open-websearch/build/utils/httpRequest.js', () => ({
  buildAxiosRequestOptions: buildAxiosRequestOptionsMock,
  requestWithSafeRedirects: requestWithSafeRedirectsMock,
}));

vi.mock('@mozilla/readability', () => ({
  Readability: class {
    constructor(_document: unknown) {
      if (readabilityMockState.mode === 'throw') {
        throw new Error('readability parser exploded');
      }
    }

    parse() {
      return {
        content: '<article><p>mock article</p></article>',
        textContent: readabilityMockState.textContent,
        title: readabilityMockState.title,
      };
    }
  },
}));

import { fetchOpenWebSearchPage } from '../../mcp/open-websearch-fetch-web.js';
import { extractReadableContent, extractTitle } from '../../mcp/open-websearch-html.js';

const NAV_MARKER = '导航文本标记';
const FOOTER_MARKER = '页脚文本标记';
const MAIN_TEXT = '主体内容标记文本，'.repeat(20);
const HTML = `<!doctype html>
<html lang="zh">
  <head><title>原始标题</title></head>
  <body>
    <nav>${NAV_MARKER}</nav>
    <main><p>${MAIN_TEXT}</p></main>
    <footer>${FOOTER_MARKER}</footer>
  </body>
</html>`;

function mockHtmlResponse(): void {
  requestWithSafeRedirectsMock.mockResolvedValueOnce({
    data: HTML,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    request: { res: { responseUrl: 'https://example.com/page' } },
    status: 200,
  });
}

describe('fetchOpenWebSearchPage readability fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAxiosRequestOptionsMock.mockReturnValue({});
    readabilityMockState.mode = 'article';
    readabilityMockState.textContent = '可读性采纳的正文';
    readabilityMockState.title = '可读性标题';
  });

  it('overrides title and content with the readability article', async () => {
    mockHtmlResponse();

    const result = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
      readability: true,
    });

    expect(result.readabilityApplied).toBe(true);
    expect(result.title).toBe('可读性标题');
    expect(result.content).toBe('可读性采纳的正文');
  });

  it('falls back to the parsed DOM body text when article textContent is empty', async () => {
    readabilityMockState.textContent = '';
    mockHtmlResponse();

    const result = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
      readability: true,
    });

    expect(result.readabilityApplied).toBe(true);
    expect(result.content).toContain(NAV_MARKER);
    expect(result.content).toContain(FOOTER_MARKER);
  });

  it('degrades to the container extractor when the parser throws', async () => {
    readabilityMockState.mode = 'throw';
    mockHtmlResponse();

    const result = await fetchOpenWebSearchPage({
      url: 'https://example.com/page',
      maxChars: 30_000,
      readability: true,
    });

    expect(result.readabilityApplied).toBe(false);
    expect(result.content).toBe(
      extractReadableContent({
        contentType: 'text/html; charset=utf-8',
        finalUrl: 'https://example.com/page',
        raw: HTML,
      }),
    );
    expect(result.title).toBe(extractTitle(HTML));
  });
});
