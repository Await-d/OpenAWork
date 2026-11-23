import { describe, expect, it } from 'vitest';
import { extractWebStructuredResults, formatWebResultCount } from './web-structured-results.js';

/** GitHub 用户对象——取自真实抓取结果（截图里那坨 JSON 的来源）。 */
const GITHUB_USER = {
  login: 'darker2016',
  id: 1234567,
  avatar_url: 'https://avatars.githubusercontent.com/u/1234567?v=4',
  html_url: 'https://github.com/darker2016',
  type: 'User',
  site_admin: false,
  name: 'Darker',
  bio: '本地优先的工具链。',
  public_repos: 32,
  followers: 120,
  gists_url: 'https://api.github.com/users/darker2016/gists{/gist_id}',
  starred_url: 'https://api.github.com/users/darker2016/starred{/owner}{/repo}',
  subscriptions_url: 'https://api.github.com/users/darker2016/subscriptions',
};

const GITHUB_REPO = {
  id: 741236,
  name: 'workbuddy',
  full_name: 'darker2016/workbuddy',
  owner: { login: 'darker2016', type: 'User' },
  html_url: 'https://github.com/darker2016/workbuddy',
  description: '本地优先的 AI 工作台。',
  language: 'TypeScript',
  stargazers_count: 1243,
  forks_count: 87,
  open_issues_count: 12,
};

describe('extractWebStructuredResults', () => {
  it('解析 GitHub 搜索信封：条目与命中总数', () => {
    const content = JSON.stringify({
      total_count: 1284,
      incomplete_results: false,
      items: [GITHUB_REPO],
    });

    const results = extractWebStructuredResults(content);

    expect(results?.totalCount).toBe(1284);
    expect(results?.items).toHaveLength(1);
    expect(results?.items[0]).toMatchObject({
      kind: 'repo',
      owner: 'darker2016',
      title: 'workbuddy',
      url: 'https://github.com/darker2016/workbuddy',
      language: 'TypeScript',
      stars: 1243,
      forks: 87,
      issues: 12,
    });
  });

  it('解析单个仓库对象（/repos/:owner/:name）', () => {
    const results = extractWebStructuredResults(JSON.stringify(GITHUB_REPO));

    expect(results?.items).toHaveLength(1);
    expect(results?.items[0]?.kind).toBe('repo');
    expect(results?.totalCount).toBeUndefined();
  });

  it('解析用户对象，并以 login 作为标题', () => {
    const results = extractWebStructuredResults(JSON.stringify(GITHUB_USER));

    expect(results?.items[0]).toMatchObject({
      kind: 'user',
      title: 'darker2016',
      url: 'https://github.com/darker2016',
      description: '本地优先的工具链。',
      repositoryCount: 32,
      followers: 120,
    });
  });

  it('解析顶层数组，并识别通用记录', () => {
    const content = JSON.stringify([
      {
        title: 'TypeScript 5.7 发布',
        url: 'https://example.com/ts',
        summary: '新增 import attributes',
      },
      { title: 'Bun 1.2', url: 'https://example.com/bun' },
    ]);

    const results = extractWebStructuredResults(content);

    expect(results?.items).toHaveLength(2);
    expect(results?.items[0]).toMatchObject({
      kind: 'record',
      title: 'TypeScript 5.7 发布',
      url: 'https://example.com/ts',
      description: '新增 import attributes',
    });
  });

  it('非 JSON 文本直接放弃', () => {
    expect(extractWebStructuredResults('# 标题\n\n一段 markdown 正文')).toBeNull();
    expect(extractWebStructuredResults('')).toBeNull();
    expect(extractWebStructuredResults('{ 这不是合法 JSON')).toBeNull();
  });

  it('认不出的 JSON 返回 null，交给原始文本路径', () => {
    expect(extractWebStructuredResults(JSON.stringify({ foo: 'bar', count: 3 }))).toBeNull();
    // 有 name 但既无链接也无描述 → 与「任意 JSON 对象」无从区分，拒绝
    expect(extractWebStructuredResults(JSON.stringify({ name: 'something' }))).toBeNull();
  });

  it('数组内只要有一条认不出，整组放弃（避免漏字段）', () => {
    const content = JSON.stringify([GITHUB_REPO, { unrelated: true }]);

    expect(extractWebStructuredResults(content)).toBeNull();
  });

  it('超过扫描上限的正文直接放弃，不为它做一次 JSON.parse', () => {
    const huge = JSON.stringify({ items: [GITHUB_REPO], padding: 'x'.repeat(600 * 1024) });

    expect(extractWebStructuredResults(huge)).toBeNull();
  });

  it('识别搜索引擎结果信封（results + totalResults）', () => {
    const content = JSON.stringify({
      query: 'openawork',
      engines: ['bing', 'duckduckgo'],
      totalResults: 42,
      partialFailures: [],
      results: [
        { title: 'OpenAWork 发布', url: 'https://example.com/a', snippet: '本地优先的工作台' },
        { title: 'Bun 1.2', url: 'https://example.com/b' },
      ],
    });

    const results = extractWebStructuredResults(content);

    expect(results?.totalCount).toBe(42);
    expect(results?.items).toHaveLength(2);
    expect(results?.items[0]).toMatchObject({
      kind: 'record',
      title: 'OpenAWork 发布',
      url: 'https://example.com/a',
      description: '本地优先的工作台',
    });
  });

  it('最多只取 8 条', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      ...GITHUB_REPO,
      name: `repo-${index}`,
    }));

    const results = extractWebStructuredResults(JSON.stringify({ items }));

    expect(results?.items).toHaveLength(8);
  });

  it('拒绝非 http(s) 协议，避免渲染出可点击的注入点', () => {
    const content = JSON.stringify({
      items: [{ ...GITHUB_REPO, html_url: 'javascript:alert(1)' }],
    });

    const results = extractWebStructuredResults(content);

    expect(results?.items[0]?.url).toBeUndefined();
    // 条目本身仍然可识别，只是不给链接
    expect(results?.items[0]?.title).toBe('workbuddy');
  });
});

describe('formatWebResultCount', () => {
  it('结构化条目优先，搜索信封带命中总数时加「共」前缀', () => {
    const results = extractWebStructuredResults(
      JSON.stringify({ total_count: 1284, items: [GITHUB_REPO, GITHUB_REPO] }),
    );

    expect(formatWebResultCount(results, 0)).toBe('共 1284 个仓库');
  });

  it('单对象响应不带「共」前缀', () => {
    const results = extractWebStructuredResults(JSON.stringify(GITHUB_USER));

    expect(formatWebResultCount(results, 0)).toBe('1 个用户');
  });

  it('条目类型混合时退回中性单位', () => {
    const results = {
      items: [
        { kind: 'repo' as const, title: 'a' },
        { kind: 'user' as const, title: 'b' },
      ],
    };

    expect(formatWebResultCount(results, 0)).toBe('2 条记录');
  });

  it('没有结构化结果时退到文本搜索条数', () => {
    expect(formatWebResultCount(null, 5)).toBe('5 条结果');
    expect(formatWebResultCount(null, 0)).toBeUndefined();
  });
});
