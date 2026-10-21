import { describe, expect, it } from 'vitest';
import type { Bookmark, BrowserTab } from './browser-storage.js';
import {
  bookmarksToQuickLinks,
  collectRecentLinks,
  compactLinkUrl,
  dedupeQuickLinks,
  isStartPageUrl,
  toQuickLink,
} from './browser-start-page.js';

function makeTab(partial: Partial<BrowserTab> & { url: string }): BrowserTab {
  return {
    id: partial.id ?? `tab-${partial.url}`,
    url: partial.url,
    title: partial.title,
    history: partial.history ?? [partial.url],
    historyIndex: partial.historyIndex ?? 0,
  };
}

function makeBookmark(partial: Partial<Bookmark> & { url: string; createdAt: number }): Bookmark {
  return {
    id: partial.id ?? `bm-${partial.url}`,
    url: partial.url,
    title: partial.title ?? '',
    ...(partial.faviconUrl !== undefined ? { faviconUrl: partial.faviconUrl } : {}),
    createdAt: partial.createdAt,
  };
}

describe('isStartPageUrl', () => {
  it('把 about:blank、空串与缺失值都当成开始页', () => {
    expect(isStartPageUrl('about:blank')).toBe(true);
    expect(isStartPageUrl('  about:blank  ')).toBe(true);
    expect(isStartPageUrl('')).toBe(true);
    expect(isStartPageUrl('   ')).toBe(true);
    expect(isStartPageUrl(null)).toBe(true);
    expect(isStartPageUrl(undefined)).toBe(true);
  });

  it('真实页面不算开始页', () => {
    expect(isStartPageUrl('https://example.test/')).toBe(false);
    expect(isStartPageUrl('http://localhost:5173')).toBe(false);
    expect(isStartPageUrl('file:///tmp/index.html')).toBe(false);
  });
});

describe('collectRecentLinks', () => {
  it('从最新标签的最新历史往前取，过滤占位页与非 http(s) 地址', () => {
    const tabs: BrowserTab[] = [
      makeTab({
        url: 'https://a.test/older',
        history: ['about:blank', 'https://a.test/older'],
        historyIndex: 1,
      }),
      makeTab({
        url: 'https://b.test/newest',
        history: ['https://b.test/newest'],
        historyIndex: 0,
      }),
    ];

    expect(collectRecentLinks(tabs).map((link) => link.url)).toEqual([
      'https://b.test/newest',
      'https://a.test/older',
    ]);
  });

  it('不把前进分支（historyIndex 之后）当成最近访问', () => {
    const tabs = [
      makeTab({
        url: 'https://a.test/current',
        history: ['https://a.test/current', 'https://a.test/forward'],
        historyIndex: 0,
      }),
    ];

    expect(collectRecentLinks(tabs).map((link) => link.url)).toEqual(['https://a.test/current']);
  });

  it('当前页有标签标题时优先展示标题', () => {
    const tabs = [
      makeTab({
        url: 'https://a.test/docs',
        title: '接口文档',
        history: ['https://a.test/docs'],
        historyIndex: 0,
      }),
    ];

    expect(collectRecentLinks(tabs)[0]?.title).toBe('接口文档');
  });

  it('跨标签去重并遵守数量上限', () => {
    const tabs = [
      makeTab({
        url: 'https://a.test/one',
        history: ['https://a.test/one', 'https://a.test/two'],
        historyIndex: 1,
      }),
      makeTab({ url: 'https://a.test/two', history: ['https://a.test/two'], historyIndex: 0 }),
      makeTab({ url: 'https://a.test/three', history: ['https://a.test/three'], historyIndex: 0 }),
    ];

    expect(collectRecentLinks(tabs, 2).map((link) => link.url)).toEqual([
      'https://a.test/three',
      'https://a.test/two',
    ]);
    expect(collectRecentLinks(tabs).map((link) => link.url)).toEqual([
      'https://a.test/three',
      'https://a.test/two',
      'https://a.test/one',
    ]);
  });
});

describe('bookmarksToQuickLinks', () => {
  it('最近收藏优先，保留自定义标题，过滤不可导航地址', () => {
    const bookmarks = [
      makeBookmark({ url: 'about:blank', title: '新标签页', createdAt: 1 }),
      makeBookmark({ url: 'https://a.test/', title: '案例', createdAt: 2 }),
      makeBookmark({ url: 'https://b.test/', title: '', createdAt: 3 }),
    ];

    const links = bookmarksToQuickLinks(bookmarks);

    expect(links.map((link) => link.url)).toEqual(['https://b.test/', 'https://a.test/']);
    expect(links[0]?.title).toBe('b.test');
    expect(links[1]?.title).toBe('案例');
  });
});

describe('dedupeQuickLinks', () => {
  it('按组顺序归并、按 URL 去重并截断', () => {
    const merged = dedupeQuickLinks(
      [
        [toQuickLink('https://a.test/')],
        [
          toQuickLink('https://a.test/'),
          toQuickLink('https://b.test/'),
          toQuickLink('https://c.test/'),
        ],
      ],
      2,
    );

    expect(merged.map((link) => link.url)).toEqual(['https://a.test/', 'https://b.test/']);
  });
});

describe('compactLinkUrl', () => {
  it('去掉 scheme / www / 根路径，保留查询串', () => {
    expect(compactLinkUrl('https://www.example.test/docs?page=2')).toBe('example.test/docs?page=2');
    expect(compactLinkUrl('http://localhost:5173/')).toBe('localhost:5173');
  });

  it('过长时截断并补省略号，非法地址原样返回', () => {
    const compact = compactLinkUrl('https://example.test/very/long/path/that/keeps/going', 16);
    expect(compact).toBe('example.test/ve…');
    expect(compactLinkUrl('not a url', 20)).toBe('not a url');
  });
});

describe('toQuickLink', () => {
  it('标题与 favicon 派生与标签栏保持一致', () => {
    const link = toQuickLink('http://localhost:5173');

    expect(link.title).toBe('localhost:5173');
    expect(link.faviconUrl).toBe('http://localhost:5173/favicon.ico');
  });
});
