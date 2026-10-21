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
/**
 * 本地浏览器现场发生变化的通知事件。
 *
 * 标签页 / 书签没有独立的 store，写盘函数是唯一的变化出口；工作台状态同步模块
 * 通过这个事件触发去抖推送，不必让 `BuiltInBrowser` 反向依赖同步模块。
 */
export const BROWSER_STATE_CHANGED_EVENT = 'openawork:browser-state-changed';

export type BrowserStateChangeKind = 'tabs' | 'bookmarks';

function notifyBrowserStateChanged(kind: BrowserStateChangeKind): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BROWSER_STATE_CHANGED_EVENT, { detail: { kind } }));
}
/** 渲染模式偏好：`1` = 原生渲染（iframe，流畅优先），缺省 = CDP 实时画面。 */
// v3 恢复 CDP 为默认路径；原生渲染仍可通过工具栏显式切换。
export const NATIVE_RENDER_KEY = 'openawork:builtin-browser:native-render:v3';
/** 实时画面画质档位偏好（含 `lossless` 无损档），缺省按均衡档。 */
export const QUALITY_PRESET_KEY = 'openawork:builtin-browser:quality:v1';
/** 标签页数量上限——工具栏与 tab bar 都要用，放在这里避免两处各写一份。 */
export const TAB_LIMIT = 12;
/** 单个标签的导航历史深度上限（超出丢弃最旧的条目）。 */
export const HISTORY_LIMIT = 50;
/**
 * 同步到服务端的标签数量上限。
 *
 * 与 `TAB_LIMIT` 分开：本机上限是「界面上最多开几个」，服务端存的是「换设备后要恢复
 * 上次打开什么」，不需要无上限增长（也避免单行 JSON 过大）。
 */
export const BROWSER_TABS_SERVER_LIMIT = 20;

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

/**
 * 读取渲染模式偏好。
 *
 * CDP 实时画面是默认路径：它提供跨域页面、设备模拟、元素拾取和远端自动化能力。
 * 用户显式选择原生渲染（`1`）时才切换 iframe；storage 不可用时按 CDP 处理。
 */
export function loadNativeRenderPreference(): boolean {
  try {
    const stored = localStorage.getItem(NATIVE_RENDER_KEY);
    return stored === '1';
  } catch {
    return false;
  }
}

export function saveNativeRenderPreference(value: boolean): void {
  try {
    localStorage.setItem(NATIVE_RENDER_KEY, value ? '1' : '0');
  } catch {
    // 偏好写不进去不影响本次会话的渲染选择，静默跳过。
  }
}

/** 读取画质档位偏好；未设置 / storage 不可用时返回 null（由调用方回落默认档）。 */
export function loadQualityPresetPreference(): string | null {
  try {
    return localStorage.getItem(QUALITY_PRESET_KEY);
  } catch {
    return null;
  }
}

export function saveQualityPresetPreference(id: string): void {
  try {
    localStorage.setItem(QUALITY_PRESET_KEY, id);
  } catch {
    // 偏好写不进去不影响本次会话的画质，静默跳过。
  }
}

export function getStorageKey(workspacePath: string | null | undefined): string {
  // 按 workspace 区分持久化的 tabs;无 workspace 时用 __default__,避免互相污染。
  const key = workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
  return `${STORAGE_KEY_PREFIX}:${key}`;
}

/**
 * 该 workspace 的持久化是否已经可以安全读写。
 *
 * 应用刚启动时 `workspacePath` 往往先以 `null` 出现（工作目录还没从会话 / 设置里解析
 * 出来），随即才变成真实路径。若在 `null` 阶段就按 `__default__` 读写，会得到两个后果：
 *
 * 1. **读错桶**：真实 workspace 的 tabs 存在 `…:<path>` 下，此时读 `…:__default__`
 *    读不到 → 界面回落成「一个空白新标签」；
 * 2. **写坏桶**：随后那个「空白的默认标签」被持久化 effect 写进**真实 workspace 的
 *    key**，把用户的历史标签整个覆盖掉——重启后「什么都没有了」就是这么来的。
 *
 * 因此只有已知 workspace 时才允许读写；`null` / 空白视为「尚未就绪」，调用方应跳过
 * 初始化与落盘，等真实路径到位后一次性加载。
 */
export function isWorkspaceStorageReady(workspacePath: string | null | undefined): boolean {
  return typeof workspacePath === 'string' && workspacePath.trim().length > 0;
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

/**
 * 把 `__default__` 桶里残留的 tabs 迁移到真实 workspace 名下。
 *
 * 用于收拾「启动早期 `workspacePath` 还是 `null`」留下的现场：那些标签被写进了
 * `__default__`。迁移只在**目标桶为空**时进行，避免覆盖真实数据；迁移成功后清掉
 * 临时桶，防止下次又搬一次。
 *
 * @returns 是否有数据被迁移。
 */
export function migrateDefaultWorkspaceTabs(workspacePath: string | null | undefined): boolean {
  if (!isWorkspaceStorageReady(workspacePath)) return false;
  if (typeof window === 'undefined') return false;
  try {
    const targetKey = getStorageKey(workspacePath);
    if (window.localStorage.getItem(targetKey) !== null) return false;

    const fallbackKey = getStorageKey(null);
    const raw = window.localStorage.getItem(fallbackKey);
    if (raw === null) return false;

    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1 || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return false;
    }
    // 只有一个「空白新标签」不算有效历史：那是初始化占位，搬过去只会让用户以为
    // 自己以前打开过它。
    const hasRealHistory = parsed.tabs.some((tab) => tab.url !== DEFAULT_URL);
    if (!hasRealHistory) return false;

    window.localStorage.setItem(targetKey, raw);
    window.localStorage.removeItem(fallbackKey);
    return true;
  } catch {
    return false;
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
        // 图标必须一起存：`PersistedState` 的类型里本来就有这一项，漏写会让重启后
        // 所有标签都退化成没有图标的纯文字，直到逐个重新访问才恢复。
        ...(t.faviconUrl !== undefined ? { faviconUrl: t.faviconUrl } : {}),
        history: t.history,
        historyIndex: t.historyIndex,
      })),
      activeTabId,
    };
    window.localStorage.setItem(getStorageKey(workspacePath), JSON.stringify(data));
    notifyBrowserStateChanged('tabs');
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
    notifyBrowserStateChanged('bookmarks');
  } catch {
    /* noop */
  }
}
