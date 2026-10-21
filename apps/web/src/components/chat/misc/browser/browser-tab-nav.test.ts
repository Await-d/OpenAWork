import { describe, expect, it } from 'vitest';
import { applyNavigatedUrl } from './browser-tab-nav.js';
import { HISTORY_LIMIT, type BrowserTab } from './browser-storage.js';

function makeTab(overrides: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: 'tab-1',
    url: 'http://localhost:5173/',
    title: 'localhost:5173',
    faviconUrl: '',
    history: ['http://localhost:5173/'],
    historyIndex: 0,
    ...overrides,
  };
}

describe('applyNavigatedUrl', () => {
  it('新地址压入历史并更新标题', () => {
    const next = applyNavigatedUrl(makeTab(), 'http://localhost:5173/about', 'About');

    expect(next.url).toBe('http://localhost:5173/about');
    expect(next.title).toBe('About');
    expect(next.history).toEqual(['http://localhost:5173/', 'http://localhost:5173/about']);
    expect(next.historyIndex).toBe(1);
  });

  it('地址已在历史中视为后退/前进：只移动指针，不新增条目', () => {
    const history = [
      'http://localhost:5173/a',
      'http://localhost:5173/b',
      'http://localhost:5173/c',
    ];
    const tab = makeTab({
      url: 'http://localhost:5173/c',
      history,
      historyIndex: 2,
    });

    const next = applyNavigatedUrl(tab, 'http://localhost:5173/a', 'A');

    expect(next.url).toBe('http://localhost:5173/a');
    expect(next.history).toEqual(history);
    expect(next.historyIndex).toBe(0);
  });

  it('地址没变时只补标题（SPA 在同一 url 上换 title）', () => {
    const tab = makeTab();

    const next = applyNavigatedUrl(tab, 'http://localhost:5173/', '首页');

    expect(next.url).toBe(tab.url);
    expect(next.title).toBe('首页');
    expect(next.history).toEqual(tab.history);
  });

  it('同一地址且标题未变时原样返回，避免无意义的重渲染', () => {
    const tab = makeTab();

    expect(applyNavigatedUrl(tab, 'http://localhost:5173/', '')).toBe(tab);
    expect(applyNavigatedUrl(tab, 'http://localhost:5173/', 'localhost:5173')).toBe(tab);
  });

  it('空地址不写回', () => {
    const tab = makeTab();

    expect(applyNavigatedUrl(tab, '', 'x')).toBe(tab);
  });

  it('历史超过上限时丢弃最旧条目', () => {
    const history = Array.from({ length: HISTORY_LIMIT }, (_, index) => `http://x.test/${index}`);
    const tab = makeTab({
      url: history[HISTORY_LIMIT - 1]!,
      history,
      historyIndex: HISTORY_LIMIT - 1,
    });

    const next = applyNavigatedUrl(tab, 'http://x.test/next', '');

    expect(next.history).toHaveLength(HISTORY_LIMIT);
    expect(next.history[0]).toBe('http://x.test/1');
    expect(next.history[next.history.length - 1]).toBe('http://x.test/next');
    expect(next.historyIndex).toBe(HISTORY_LIMIT - 1);
  });
});
