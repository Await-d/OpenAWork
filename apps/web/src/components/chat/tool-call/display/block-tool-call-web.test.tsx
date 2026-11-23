// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BlockToolCall } from './block-tool-call.js';

const SEARCH_URL = 'https://api.github.com/search/repositories?q=workbuddy&register&per_page=5';

const REPO = {
  name: 'workbuddy',
  full_name: 'darker2016/workbuddy',
  owner: { login: 'darker2016' },
  html_url: 'https://github.com/darker2016/workbuddy',
  description: '本地优先的 AI 工作台。',
  language: 'TypeScript',
  stargazers_count: 1243,
  forks_count: 87,
  open_issues_count: 12,
};

/** 默认折叠，展开体需要真的点一下标题栏才会出现。 */
function expand(container: HTMLElement): void {
  const header = container.querySelector('.tool-call-block-header');
  if (!header) throw new Error('未渲染折叠行');
  fireEvent.click(header);
}

function renderWebfetch(content: string) {
  return render(
    <BlockToolCall
      toolName="webfetch"
      input={{ url: SEARCH_URL, format: 'text' }}
      output={{
        url: SEARCH_URL,
        status: 200,
        contentType: 'application/json',
        format: 'text',
        content,
      }}
      status="completed"
      durationMs={820}
    />,
  );
}

afterEach(cleanup);

describe('BlockToolCall · web 折叠行摘要', () => {
  it('把状态码 / 域名 / 结果量压在标题后一行', () => {
    const { container } = renderWebfetch(JSON.stringify({ total_count: 1284, items: [REPO] }));

    expect(container.querySelector('.tool-call-block-web-status')?.textContent).toBe('200');
    expect(container.querySelector('.tool-call-block-web-host')?.textContent).toBe(
      'api.github.com',
    );
    expect(container.querySelector('.tool-call-block-web-count')?.textContent).toBe(
      '共 1284 个仓库',
    );
  });

  it('2xx 时不再重复挂「✓ 已找到」徽章', () => {
    const { container } = renderWebfetch(JSON.stringify({ total_count: 1284, items: [REPO] }));

    expect(container.querySelector('.tool-search-badge')).toBeNull();
  });
});

describe('BlockToolCall · 结构化结果', () => {
  it('展开后渲染结果卡片而不是原始 JSON 平铺', () => {
    const { container } = renderWebfetch(JSON.stringify({ total_count: 1284, items: [REPO] }));
    expand(container);

    const cards = container.querySelectorAll('.tool-call-block-web-result');
    expect(cards).toHaveLength(1);
    expect(container.querySelector('.tool-call-block-web-result-name')?.textContent).toBe(
      'workbuddy',
    );
    expect(container.querySelector('.tool-call-block-web-result-owner')?.textContent).toBe(
      'darker2016',
    );
    expect(container.querySelector('.tool-call-block-web-result-desc')?.textContent).toBe(
      '本地优先的 AI 工作台。',
    );
    expect(container.querySelector('.tool-call-block-web-result-chip')?.textContent).toBe(
      'TypeScript',
    );

    // 原始 JSON 不再作为正文出现，改由「原始响应」抽屉承载
    expect(container.querySelector('.tool-output-pre')).toBeNull();
    expect(container.querySelector('.tool-call-block-web-meta')).toBeNull();
    expect(screen.getByText(/原始响应/)).toBeTruthy();
  });

  it('正文被前端截断时，原始响应区标明「已截断」', () => {
    const longDescription = 'x'.repeat(2000);
    const items = Array.from({ length: 5 }, (_, index) => ({
      ...REPO,
      name: `repo-${index}`,
      description: longDescription,
    }));

    const { container } = renderWebfetch(JSON.stringify({ items }));
    expand(container);

    const summary = container.querySelector('.tool-call-block-web-raw > summary');
    expect(summary?.textContent).toContain('已截断');
  });

  it('卡片链接指向 html_url 且新窗口打开', () => {
    const { container } = renderWebfetch(JSON.stringify({ total_count: 1284, items: [REPO] }));
    expand(container);

    const link = container.querySelector<HTMLAnchorElement>('a.tool-call-block-web-result');
    expect(link?.getAttribute('href')).toBe('https://github.com/darker2016/workbuddy');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('认不出的 JSON 回落到原路径：保留 URL 行与文本输出', () => {
    // 注意别用 `{"foo":"bar"}` 当样本：`cleanWebContent` 会把 `{...}` 整段剥掉，
    // 结果是空正文、连 output 块都不渲染。这里用一个清洗后仍有内容的 JSON。
    const { container } = renderWebfetch('[1, 2, 3]');
    expand(container);

    expect(container.querySelector('.tool-call-block-web-result')).toBeNull();
    expect(container.querySelector('.tool-call-block-web-meta')).not.toBeNull();
    expect(container.querySelector('.tool-call-block-web-url')?.textContent).toBe(SEARCH_URL);
    expect(container.querySelector('.tool-output-pre')?.textContent).toContain('[1, 2, 3]');
  });

  it('web 工具的参数抽屉默认收起，不重复铺 URL', () => {
    const { container } = renderWebfetch(JSON.stringify({ total_count: 1284, items: [REPO] }));
    expand(container);

    const params = container.querySelector('.tool-call-block-params');
    expect(params).not.toBeNull();
    expect(params?.hasAttribute('open')).toBe(false);
  });
});

describe('BlockToolCall · 内置 MCP 抓取通道', () => {
  it('mcp__open_websearch__fetch_web 复用网页结果卡片', () => {
    const content = JSON.stringify({ total_count: 1284, items: [REPO] });
    const { container } = render(
      <BlockToolCall
        toolName="mcp__open_websearch__fetch_web"
        input={{ url: SEARCH_URL }}
        output={{
          content: [{ type: 'text', text: content }],
          structuredContent: { url: SEARCH_URL, contentType: 'application/json', content },
        }}
        status="completed"
        durationMs={700}
      />,
    );
    expand(container);

    // 归一化成 webfetch 后走同一条渲染链路
    expect(container.querySelector('.tool-call-block-web-result-name')?.textContent).toBe(
      'workbuddy',
    );
    expect(container.querySelector('.tool-call-block-web-host')?.textContent).toBe(
      'api.github.com',
    );

    // 折叠标题仍按原口径，不把内部的 MCP server / 工具名暴露给用户
    expect(container.querySelector('.tool-call-block-title')?.textContent).toBe('调用了 MCP 工具');
  });

  it('没有内置对应的 MCP 工具不受影响（保持纯文本输出）', () => {
    const { container } = render(
      <BlockToolCall
        toolName="mcp__grep_app__search"
        input={{ q: 'useState' }}
        output={{ content: [{ type: 'text', text: 'no adapter' }] }}
        status="completed"
      />,
    );
    expand(container);

    expect(container.querySelector('.tool-call-block-web-result')).toBeNull();
    expect(container.querySelector('.mcp-result')).not.toBeNull();
  });

  it('mcp__open_websearch__search 渲染成搜索结果列表', () => {
    const payload = {
      query: 'openawork',
      totalResults: 42,
      results: [
        { title: 'OpenAWork 发布', url: 'https://example.com/a', snippet: '本地优先的工作台' },
      ],
    };
    const { container } = render(
      <BlockToolCall
        toolName="mcp__open_websearch__search"
        input={{ query: 'openawork' }}
        output={{
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: payload,
        }}
        status="completed"
        durationMs={900}
      />,
    );
    expand(container);

    expect(container.querySelector('.tool-call-block-web-result-name')?.textContent).toBe(
      'OpenAWork 发布',
    );
    expect(container.querySelector('.tool-call-block-web-count')?.textContent).toBe('共 42 条记录');
  });
});

/**
 * `webfetch` 抓 HTML 页时，网关用 turndown 把正文转成 Markdown（`format` 默认就是
 * `markdown`）。这组用例守的是**展开体真的渲染成 Markdown 结构**——曾经正文被
 * `cleanWebContent` 删掉了全部空行与行首缩进，于是相邻行被并成同一个段落，
 * 整页挤成一坨（见 `shared/web-helpers.ts` 的 `cleanMarkdownContent`）。
 */
describe('BlockToolCall · webfetch 抓 HTML 页（Markdown 正文）', () => {
  const HN_MARKDOWN = [
    '**[Hacker News](news)**[new](newest) | [past](front)',
    '',
    'login',
    '',
    '1. [The Internals of PostgreSQL](http://www.interdb.jp/pg/)',
    '   115 points by [ibobev](user?id=ibobev)',
  ].join('\n');

  function renderMarkdownPage(content: string) {
    return render(
      <BlockToolCall
        toolName="webfetch"
        input={{ url: 'https://news.ycombinator.com/' }}
        output={{
          url: 'https://news.ycombinator.com/',
          format: 'markdown',
          status: 200,
          contentType: 'text/html; charset=utf-8',
          content,
        }}
        status="completed"
        durationMs={640}
      />,
    );
  }

  it('段间空行保住了 —— 相邻内容不会被并成同一个段落', () => {
    const { container } = renderMarkdownPage(HN_MARKDOWN);
    expand(container);

    const markdown = container.querySelector('.tool-call-block-web-markdown');
    expect(markdown).not.toBeNull();

    // 空行即段落分隔：导航行、login 各自成段；`1. …` 另起一个有序列表。
    // 空白被删时这些会全部并进同一个段落，`p` 只剩 1 个、也不会出现 `ol`。
    expect(markdown?.querySelectorAll('p')).toHaveLength(2);
    expect(markdown?.querySelectorAll('ol li')).toHaveLength(1);
    // 曾经这里会因为空行被删而把 `login` 与列表项接到一行里
    expect(markdown?.textContent).not.toContain('login1.');
  });

  it('走 Markdown 分支而不是纯文本兜底', () => {
    const { container } = renderMarkdownPage(HN_MARKDOWN);
    expand(container);

    expect(container.querySelector('.tool-call-block-web-markdown')).not.toBeNull();
    expect(screen.queryByText(/展开全部/)).toBeNull();
  });
});
