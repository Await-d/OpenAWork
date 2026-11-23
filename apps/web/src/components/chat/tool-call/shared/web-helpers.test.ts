import { describe, expect, it } from 'vitest';
import { extractWebSummary, isSearchToolName, isWebToolName } from './web-helpers.js';

/** 正文来自抓取类工具（`webfetch`）：页面内容，不做搜索结果识别。 */
const WEBFETCH = { searchTool: false };
/** 正文来自搜索类工具（`websearch` / `web_search` / `google_search`）。 */
const SEARCH = { searchTool: true };

describe('isWebToolName', () => {
  it('覆盖抓取与三种搜索入口（含 agent-core 的 web_search）', () => {
    expect(isWebToolName('webfetch')).toBe(true);
    expect(isWebToolName('websearch')).toBe(true);
    expect(isWebToolName('google_search')).toBe(true);
    expect(isWebToolName('web_search')).toBe(true);
  });

  it('大小写 / 空白不敏感', () => {
    expect(isWebToolName('  WEB_SEARCH ')).toBe(true);
  });

  it('非 web 工具不命中', () => {
    expect(isWebToolName('codesearch')).toBe(false);
    expect(isWebToolName('bash')).toBe(false);
    expect(isWebToolName('fetch_web')).toBe(false);
  });
});

describe('extractWebSummary', () => {
  it('marks image webfetch output as previewable when imageUrl is present', () => {
    const summary = extractWebSummary(
      {
        url: 'https://cdn.example.com/cat.png',
        status: 200,
        contentType: 'image/png',
        format: 'markdown',
        mediaKind: 'image',
        imageUrl: 'https://cdn.example.com/cat.png',
        content: '![Fetched image](https://cdn.example.com/cat.png)',
      },
      WEBFETCH,
    );

    expect(summary).toMatchObject({
      url: 'https://cdn.example.com/cat.png',
      status: 200,
      contentType: 'image/png',
      format: 'markdown',
      mediaKind: 'image',
      imageUrl: 'https://cdn.example.com/cat.png',
    });
  });

  it('falls back to url for legacy image outputs that only set mediaKind', () => {
    const summary = extractWebSummary(
      {
        url: 'https://cdn.example.com/legacy.webp',
        contentType: 'image/webp',
        mediaKind: 'image',
        content: '',
      },
      WEBFETCH,
    );

    expect(summary.imageUrl).toBe('https://cdn.example.com/legacy.webp');
  });

  it('does not expose non-http image URLs as previewable images', () => {
    const unsupportedUrls = [
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      'javascript:alert(1)',
      'file:///tmp/cat.png',
      'ftp://cdn.example.com/cat.png',
    ];

    for (const imageUrl of unsupportedUrls) {
      const summary = extractWebSummary(
        {
          url: imageUrl,
          contentType: 'image/svg+xml',
          mediaKind: 'image',
          imageUrl,
          content: '',
        },
        WEBFETCH,
      );

      expect(summary.imageUrl).toBeUndefined();
    }
  });

  it('解析 agent-core web_search 的纯文本结果（1. 标题 / 摘要 / URL）', () => {
    const output = [
      '1. TypeScript 5.7 发布',
      '   新增对 import attributes 的支持',
      '   https://example.com/ts',
      '2. Bun 1.2',
      '   更快的测试运行器',
      '   https://example.com/bun',
    ].join('\n');

    const summary = extractWebSummary(output, SEARCH);

    expect(summary.searchResults).toHaveLength(2);
    expect(summary.searchResults?.[0]?.title).toBe('TypeScript 5.7 发布');
    expect(summary.searchResults?.[0]?.url).toBe('https://example.com/ts');
    expect(summary.searchResults?.[1]?.snippet).toBe('更快的测试运行器');
  });
});

/**
 * `webfetch` 抓 HTML 页时，网关用 turndown 把正文转成 Markdown（`format` 默认就是
 * `markdown`，见 `services/agent-gateway/src/tools/web-tools.ts`）。Markdown 的段落、
 * 列表、代码块全靠**空行与行首缩进**表达，所以它不能走那套面向 HTML 的清洗
 * （`cleanWebContent` 会删空行、压平缩进），否则整页会被解析成同一个段落、挤成一坨。
 */
describe('extractWebSummary · Markdown 正文的结构必须保留', () => {
  const fetchOutput = (content: string) => ({
    url: 'https://news.ycombinator.com/',
    format: 'markdown',
    status: 200,
    contentType: 'text/html; charset=utf-8',
    content,
  });

  it('保留段间空行（空行就是 Markdown 的段落分隔）', () => {
    const content = ['第一段', '', '第二段', '', '第三段'].join('\n');

    const summary = extractWebSummary(fetchOutput(content), WEBFETCH);

    expect(summary.isMarkdown).toBe(true);
    expect(summary.cleanedContent).toBe(content);
  });

  it('保留行首缩进（列表续行与代码块靠缩进）', () => {
    const content = ['1. 标题', '   续行说明', '2. 另一个', '   续行说明'].join('\n');

    const summary = extractWebSummary(fetchOutput(content), WEBFETCH);

    expect(summary.cleanedContent).toContain('\n   续行说明');
  });

  it('`format: markdown` 时不做 HTML 式清洗（不删空行、不压缩进）', () => {
    const content = [
      '**[Hacker News](news)**[new](newest) | [past](front)',
      '',
      'login',
      '',
      '1. [The Internals of PostgreSQL](http://www.interdb.jp/pg/)',
      '   115 points by [ibobev](user?id=ibobev)',
    ].join('\n');

    const summary = extractWebSummary(fetchOutput(content), WEBFETCH);

    // 曾经这里空行数会被削成 0，于是 `login` 与 `1. …` 连成同一段
    expect((summary.cleanedContent.match(/\n\n/g) ?? []).length).toBe(2);
    expect(summary.cleanedContent).toContain('login\n\n1. [The Internals');
    expect(summary.cleanedContent).toContain('\n   115 points by');
  });

  it('非 Markdown 的正文仍走原来的 HTML 清洗', () => {
    const summary = extractWebSummary(
      {
        url: 'https://example.com/',
        format: 'text',
        status: 200,
        contentType: 'text/plain',
        content: '<div>hello</div>\n\n\n\n{ "noise": 1 }',
      },
      WEBFETCH,
    );

    expect(summary.isMarkdown).toBe(false);
    expect(summary.cleanedContent).not.toContain('<div>');
    expect(summary.cleanedContent).not.toContain('noise');
  });
});

/**
 * 「搜索结果」识别必须按**工具意图**开关，不能只看内容形状。
 *
 * 抓正文与抓 SERP 页面产出的是同一种形状（网关都是抓一个 URL 再转文本），靠内容区分不了。
 * HN 首页就是这个坑的实例：它自己的编号链接被拆成 `title + snippet + url`，
 * snippet 全是错位的积分与作者行。
 */
describe('extractWebSummary · 搜索结果识别按工具意图开关', () => {
  /** 页面自己的编号列表（HN 首页那种）。 */
  const PAGE_WITH_LIST = [
    'Hacker News',
    '',
    '1. The Internals of PostgreSQL (interdb.jp)',
    '   115 points by ibobev 4 hours ago',
    '2. Stringman, an $800 open-source gripper robot (neufangled.com)',
    '   387 points by nharada 9 hours ago',
  ].join('\n');

  const pageOutput = {
    url: 'https://news.ycombinator.com/',
    format: 'text',
    status: 200,
    contentType: 'text/html; charset=utf-8',
    content: PAGE_WITH_LIST,
  };

  it('抓取类（webfetch）：页面自己的编号列表不算搜索结果', () => {
    expect(extractWebSummary(pageOutput, WEBFETCH).searchResults).toBeNull();
  });

  it('搜索类：同一段内容就是结果列表', () => {
    const summary = extractWebSummary(pageOutput, SEARCH);

    expect(summary.searchResults).toHaveLength(2);
    expect(summary.searchResults?.[0]?.title).toBe('The Internals of PostgreSQL (interdb.jp)');
  });

  it('纯字符串形态同样按意图开关', () => {
    expect(extractWebSummary(PAGE_WITH_LIST, WEBFETCH).searchResults).toBeNull();
    expect(extractWebSummary(PAGE_WITH_LIST, SEARCH).searchResults).toHaveLength(2);
  });

  it('isSearchToolName 只认搜索工具，抓取类不算', () => {
    expect(isSearchToolName('websearch')).toBe(true);
    expect(isSearchToolName('web_search')).toBe(true);
    expect(isSearchToolName('google_search')).toBe(true);
    expect(isSearchToolName('  WEB_SEARCH ')).toBe(true);
    expect(isSearchToolName('webfetch')).toBe(false);
    expect(isSearchToolName('read')).toBe(false);
  });
});
