/**
 * 内置浏览器开始页（新标签页）的纯函数：占位页判定 + 快捷入口派生。
 *
 * 新标签的地址是占位页 `about:blank`（不能换成网关根地址——那会请求一个只提供
 * API 的根路径并渲染成错误页）。以前这个地址直接落到 iframe / 原生 webview 上，
 * 用户看到的就是一块白板；开始页只在占位地址上出现，判定与入口派生集中在这里，
 * 组件只负责渲染，便于单测。
 */

import {
  DEFAULT_URL,
  deriveFaviconUrl,
  deriveTabTitle,
  type Bookmark,
  type BrowserTab,
} from './browser-storage.js';
import { NAVIGABLE_URL_PATTERN } from './browser-url.js';

/** 开始页「快速打开」最多展示多少个入口。 */
export const START_PAGE_QUICK_LINK_LIMIT = 8;
/** 书签入口单独截断：最近 6 个足够，避免开始页被书签淹没。 */
export const START_PAGE_BOOKMARK_LIMIT = 6;

export interface BrowserQuickLink {
  readonly url: string;
  readonly title: string;
  readonly faviconUrl?: string;
}

/**
 * 是否应展示开始页：空地址与 `about:blank` 都算「还没有页面」。
 *
 * 空字符串同样命中，是因为地址栏在开始页显示空值（见 `BuiltInBrowser` 的
 * `addressInput`），组件不能只认 `DEFAULT_URL` 而漏掉这条路径。
 */
export function isStartPageUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return true;
  return url.trim().length === 0 || url.trim() === DEFAULT_URL;
}

/** 地址 → 快捷入口（标题 / favicon 与标签栏同源，避免两处各自派生）。 */
export function toQuickLink(url: string): BrowserQuickLink {
  const faviconUrl = deriveFaviconUrl(url);
  return {
    url,
    title: deriveTabTitle(url),
    ...(faviconUrl !== undefined ? { faviconUrl } : {}),
  };
}

/** 书签 → 快捷入口：最近收藏优先，保留用户自定义标题。 */
export function bookmarksToQuickLinks(
  bookmarks: readonly Bookmark[],
  limit: number = START_PAGE_BOOKMARK_LIMIT,
): BrowserQuickLink[] {
  return bookmarks
    .filter((bookmark) => NAVIGABLE_URL_PATTERN.test(bookmark.url))
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
    .map((bookmark) => ({
      url: bookmark.url,
      title: bookmark.title.trim() || deriveTabTitle(bookmark.url),
      ...(bookmark.faviconUrl !== undefined && bookmark.faviconUrl.length > 0
        ? { faviconUrl: bookmark.faviconUrl }
        : {}),
    }));
}

/**
 * 从所有标签的历史里挑出「最近访问」。
 *
 * 没有全局访问时间戳，只能约定：数组末尾的标签更新 → 从后往前遍历；每个标签从
 * 当前指针往前取（`historyIndex` 之后的是前进分支，不属于当前访问历史）。地址相同
 * 的只保留最近一次，占位页与非 http(s) 地址不进列表。
 */
export function collectRecentLinks(
  tabs: readonly BrowserTab[],
  limit: number = START_PAGE_QUICK_LINK_LIMIT,
): BrowserQuickLink[] {
  const seen = new Set<string>();
  const links: BrowserQuickLink[] = [];

  for (let tabIndex = tabs.length - 1; tabIndex >= 0; tabIndex -= 1) {
    const tab = tabs[tabIndex];
    if (tab === undefined) continue;
    const newestIndex = Math.min(tab.historyIndex, tab.history.length - 1);
    for (let historyIndex = newestIndex; historyIndex >= 0; historyIndex -= 1) {
      if (links.length >= limit) return links;
      const url = tab.history[historyIndex];
      if (url === undefined || seen.has(url) || !NAVIGABLE_URL_PATTERN.test(url)) continue;
      seen.add(url);
      // 当前页有标签标题时优先用它：历史条目只存 URL，退化成主机名会让「最近访问」
      // 里每一张卡片都长得一样（尤其是同一站点的多个页面）。
      const tabTitle = tab.url === url && typeof tab.title === 'string' ? tab.title.trim() : '';
      const link = toQuickLink(url);
      links.push(tabTitle.length > 0 ? { ...link, title: tabTitle } : link);
    }
  }

  return links;
}

/** 按组归并快捷入口：先到先得（调用方把「本地预览 / 书签」放在前面），按 URL 去重。 */
export function dedupeQuickLinks(
  groups: readonly (readonly BrowserQuickLink[])[],
  limit: number = START_PAGE_QUICK_LINK_LIMIT,
): BrowserQuickLink[] {
  const seen = new Set<string>();
  const merged: BrowserQuickLink[] = [];

  for (const group of groups) {
    for (const link of group) {
      if (merged.length >= limit) return merged;
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      merged.push(link);
    }
  }

  return merged;
}

/**
 * 卡片副标题用的紧凑地址：去掉 scheme、`www.` 与尾部 `/`，过长截断。
 *
 * 开始页卡片宽度有限，完整 URL 只会被 CSS 截成「https://…」，反而看不出是哪一站。
 */
export function compactLinkUrl(url: string, maxLength: number = 42): string {
  let compact = url;
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    compact = `${host}${path}${parsed.search}`;
  } catch {
    compact = url;
  }
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1))}…`;
}
