/**
 * 「页面自己发生的导航」写回标签的纯函数。
 *
 * 两条来源必须走同一份实现，否则地址栏 / 持久化 / 后退前进 / 收藏会各说各话：
 * - iframe 分支：注入脚本 postMessage 的 `oaw-navigate`；
 * - CDP 实时分支：网关 `nav` 事件（页面在网关侧 Chromium 里，前端**没有 iframe**
 *   可读，只能靠这条事件）。
 */

import {
  HISTORY_LIMIT,
  deriveFaviconUrl,
  deriveTabTitle,
  type BrowserTab,
} from './browser-storage.js';

/**
 * 把一次导航写回标签。
 *
 * - 地址没变：只补标题（SPA 常在同一个 url 上换 title）；
 * - 地址在既有 history 中：视为 back/forward，移动指针而不截断；
 * - 新地址：截断 forward 后压入新条目。
 */
export function applyNavigatedUrl(
  tab: BrowserTab,
  nextUrl: string,
  nextTitle: string = '',
): BrowserTab {
  if (nextUrl.length === 0) return tab;
  const trimmedTitle = nextTitle.trim();

  if (tab.url === nextUrl) {
    if (trimmedTitle.length > 0 && trimmedTitle !== tab.title) {
      return { ...tab, title: trimmedTitle };
    }
    return tab;
  }

  const existingIndex = tab.history.indexOf(nextUrl);
  if (existingIndex >= 0) {
    return {
      ...tab,
      url: nextUrl,
      title: trimmedTitle || deriveTabTitle(nextUrl),
      faviconUrl: deriveFaviconUrl(nextUrl),
      historyIndex: existingIndex,
    };
  }

  const truncated = tab.history.slice(0, tab.historyIndex + 1);
  const nextHistory = [...truncated, nextUrl].slice(-HISTORY_LIMIT);
  return {
    ...tab,
    url: nextUrl,
    title: trimmedTitle || deriveTabTitle(nextUrl),
    faviconUrl: deriveFaviconUrl(nextUrl),
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
  };
}
