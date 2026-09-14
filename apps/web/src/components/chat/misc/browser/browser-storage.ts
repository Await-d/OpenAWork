/**
 * 内置浏览器的持久化与 URL 派生工具。
 *
 * 从 `BuiltInBrowser.tsx` 抽出的纯函数部分：tabs / 书签的 localStorage
 * 读写、标题与 favicon 派生、tab id 生成。没有 React 依赖，便于单测。
 */

export const DEFAULT_URL = 'about:blank';
export const LEGACY_DEFAULT_URL = 'http://localhost:3000';
export const STORAGE_KEY_PREFIX = 'openawork:builtin-browser:tabs:v1';
export const BOOKMARKS_KEY = 'openawork:builtin-browser:bookmarks:v1';
/** 标签页数量上限——工具栏与 tab bar 都要用，放在这里避免两处各写一份。 */
export const TAB_LIMIT = 12;

export interface BrowserTab {
  id: string;
  url: string;
  title?: string;
  faviconUrl?: string;
  history: string[]; // navigation stack, newest at end
  historyIndex: number; // pointer into history (current entry)
}

export interface PersistedState {
  version: 1;
  tabs: Array<Pick<BrowserTab, 'id' | 'url' | 'title' | 'faviconUrl' | 'history' | 'historyIndex'>>;
  activeTabId: string;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  createdAt: number;
}

export function getStorageKey(workspacePath: string | null | undefined): string {
  // 按 workspace 区分持久化的 tabs;无 workspace 时用 __default__,避免互相污染。
  const key = workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
  return `${STORAGE_KEY_PREFIX}:${key}`;
}

export function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

export function makeTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function deriveTabTitle(url: string): string {
  if (url === DEFAULT_URL) return '新标签页';
  try {
    const u = new URL(url);
    if (isLocalhostUrl(url)) {
      return u.port ? `localhost:${u.port}` : 'localhost';
    }
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function deriveFaviconUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (isLocalhostUrl(url)) {
      // 本地 dev server 直接拿 /favicon.ico,失败的话浏览器自然 fallback
      return `${u.origin}/favicon.ico`;
    }
    // 远程站点用 Google s2 服务,跨域 OK 且无需鉴权
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
  } catch {
    return undefined;
  }
}

export function loadPersistedState(
  workspacePath: string | null | undefined,
): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(workspacePath));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1 || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }
    // 迁移旧版本自动保存的网关根地址，避免升级后仍因历史 tab 重复请求一个
    // 不存在的页面。用户后来手动输入的其他 localhost 地址不会受影响。
    const tabs = parsed.tabs.map((tab) => {
      if (tab.url !== LEGACY_DEFAULT_URL) return tab;
      return {
        ...tab,
        url: DEFAULT_URL,
        title: deriveTabTitle(DEFAULT_URL),
        faviconUrl: undefined,
        history: tab.history.map((entry) => (entry === LEGACY_DEFAULT_URL ? DEFAULT_URL : entry)),
      };
    });
    return { ...parsed, tabs };
  } catch {
    return null;
  }
}

export function persistState(
  workspacePath: string | null | undefined,
  tabs: BrowserTab[],
  activeTabId: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    const data: PersistedState = {
      version: 1,
      tabs: tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        history: t.history,
        historyIndex: t.historyIndex,
      })),
      activeTabId,
    };
    window.localStorage.setItem(getStorageKey(workspacePath), JSON.stringify(data));
  } catch {
    // quota exceeded or sandboxed — silently ignore
  }
}

export function loadBookmarks(): Bookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Bookmark[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b) => typeof b?.url === 'string');
  } catch {
    return [];
  }
}

export function saveBookmarks(bookmarks: Bookmark[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    /* noop */
  }
}
