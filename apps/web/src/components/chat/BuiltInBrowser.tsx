import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

const isTauriEnv = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const DEFAULT_URL = 'http://localhost:3000';

const STORAGE_KEY_PREFIX = 'openawork:builtin-browser:tabs:v1';
const HISTORY_LIMIT = 50;
const TAB_LIMIT = 12;

function getStorageKey(workspacePath: string | null | undefined): string {
  // 按 workspace 区分持久化的 tabs;无 workspace 时用 __default__,避免互相污染。
  const key = workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
  return `${STORAGE_KEY_PREFIX}:${key}`;
}

interface BrowserTab {
  id: string;
  url: string;
  title?: string;
  faviconUrl?: string;
  history: string[]; // navigation stack, newest at end
  historyIndex: number; // pointer into history (current entry)
}

interface PersistedState {
  version: 1;
  tabs: Array<Pick<BrowserTab, 'id' | 'url' | 'title' | 'faviconUrl' | 'history' | 'historyIndex'>>;
  activeTabId: string;
}

interface Bookmark {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  createdAt: number;
}

const BOOKMARKS_KEY = 'openawork:builtin-browser:bookmarks:v1';
const OPEN_URL_EVENT = 'openawork:browser:open-url';

function isLocalhostUrl(url: string): boolean {
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

function makeTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadPersistedState(workspacePath: string | null | undefined): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(workspacePath));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1 || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistState(
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

function deriveTabTitle(url: string): string {
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

function deriveFaviconUrl(url: string): string | undefined {
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

function loadBookmarks(): Bookmark[] {
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

function saveBookmarks(bookmarks: Bookmark[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    /* noop */
  }
}

interface BuiltInBrowserProps {
  className?: string;
  style?: CSSProperties;
  /** When set, the browser navigates to this URL automatically (e.g. from dev-server detection). */
  previewUrl?: string | null;
  /**
   * 当前工作区路径,用来按 workspace 隔离 tabs / history / activeTab 的持久化。
   * 跨 workspace 切会话时,sidebar 会传入新的 workspacePath,本组件会重建 tabs 状态。
   */
  workspacePath?: string | null;
  /**
   * When true the browser is kept alive but visually hidden (Tauri webview
   * is moved off-screen; iframe wrapper gets `display:none`).
   */
  hidden?: boolean;
}

export function BuiltInBrowser({
  className,
  style,
  previewUrl,
  workspacePath,
  hidden = false,
}: BuiltInBrowserProps) {
  // ── Tabs state (with persistence) ───────────────────────────────────
  // 初始化:从当前 workspace 的 storage 读取(若有);否则用 previewUrl 或 default。
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    const persisted = loadPersistedState(workspacePath);
    if (persisted) return persisted.tabs as BrowserTab[];
    const initialUrl = previewUrl || DEFAULT_URL;
    const id = makeTabId();
    return [
      {
        id,
        url: initialUrl,
        title: deriveTabTitle(initialUrl),
        faviconUrl: deriveFaviconUrl(initialUrl),
        history: [initialUrl],
        historyIndex: 0,
      },
    ];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const persisted = loadPersistedState(workspacePath);
    if (persisted && persisted.tabs.find((t) => t.id === persisted.activeTabId)) {
      return persisted.activeTabId;
    }
    return tabs[0]?.id ?? makeTabId();
  });

  // 跨 workspace 切换时记录"已经 load 完毕的 workspace"。persist effect 用它判断
  // tabs 是否真已属于当前 workspacePath(避免在 ws-effect 还没替换 tabs 前就把旧
  // workspace 的 tabs 写到新 workspace 的 storage key)。
  const lastLoadedWorkspaceRef = useRef<string | null | undefined>(workspacePath);

  // 持久化(按 workspace key 写)。注意:workspacePath 变化时 ws-effect 会重新 load
  // 并 setTabs,这之前 tabs 还属于旧 workspace,绝不能在这一帧把旧 tabs 写到新 ws key,
  // 否则会污染目标 workspace 的持久化数据。
  useEffect(() => {
    if (lastLoadedWorkspaceRef.current !== workspacePath) return;
    persistState(workspacePath, tabs, activeTabId);
  }, [workspacePath, tabs, activeTabId]);

  // 跨 workspace 切换:重新从 storage 加载该 workspace 的 tabs。
  // 避免上一个 workspace 的 tabs 残留在内存(从而通过持久化覆盖新 workspace 的状态)。
  useEffect(() => {
    if (lastLoadedWorkspaceRef.current === workspacePath) return;
    lastLoadedWorkspaceRef.current = workspacePath;
    const persisted = loadPersistedState(workspacePath);
    if (persisted) {
      setTabs(persisted.tabs as BrowserTab[]);
      const validActive = persisted.tabs.find((t) => t.id === persisted.activeTabId)
        ? persisted.activeTabId
        : (persisted.tabs[0]?.id ?? makeTabId());
      setActiveTabId(validActive);
    } else {
      // 该 workspace 还没有 tabs:用 previewUrl 或默认 url 重建一个新 tab。
      const initialUrl = previewUrl || DEFAULT_URL;
      const id = makeTabId();
      setTabs([
        {
          id,
          url: initialUrl,
          title: deriveTabTitle(initialUrl),
          faviconUrl: deriveFaviconUrl(initialUrl),
          history: [initialUrl],
          historyIndex: 0,
        },
      ]);
      setActiveTabId(id);
    }
  }, [workspacePath, previewUrl]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );

  // 地址栏输入(每个 tab 独立)
  const [addressInput, setAddressInput] = useState<string>(activeTab?.url ?? DEFAULT_URL);
  useEffect(() => {
    setAddressInput(activeTab?.url ?? DEFAULT_URL);
  }, [activeTabId, activeTab?.url]);

  const activeUrl = activeTab?.url ?? DEFAULT_URL;

  // ── Helpers: tab mutations ──────────────────────────────────────────
  const updateActiveTab = useCallback(
    (updater: (tab: BrowserTab) => BrowserTab) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? updater(t) : t)));
    },
    [activeTabId],
  );

  const navigateActiveTab = useCallback(
    (nextUrl: string) => {
      updateActiveTab((tab) => {
        const truncated = tab.history.slice(0, tab.historyIndex + 1);
        const nextHistory = [...truncated, nextUrl].slice(-HISTORY_LIMIT);
        return {
          ...tab,
          url: nextUrl,
          title: deriveTabTitle(nextUrl),
          faviconUrl: deriveFaviconUrl(nextUrl),
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      });
    },
    [updateActiveTab],
  );

  const goBack = useCallback(() => {
    // 优先操作 iframe 内部 history(保留页面 state),失败时 fallback 到 React state 改 URL。
    try {
      const win = iframeRef.current?.contentWindow;
      if (win && typeof win.history?.back === 'function') {
        win.history.back();
        return;
      }
    } catch {
      // 跨域 — 走 fallback
    }
    updateActiveTab((tab) => {
      if (tab.historyIndex <= 0) return tab;
      const nextIndex = tab.historyIndex - 1;
      const nextUrl = tab.history[nextIndex] ?? tab.url;
      return {
        ...tab,
        url: nextUrl,
        title: deriveTabTitle(nextUrl),
        faviconUrl: deriveFaviconUrl(nextUrl),
        historyIndex: nextIndex,
      };
    });
  }, [updateActiveTab]);

  const goForward = useCallback(() => {
    try {
      const win = iframeRef.current?.contentWindow;
      if (win && typeof win.history?.forward === 'function') {
        win.history.forward();
        return;
      }
    } catch {
      // 跨域
    }
    updateActiveTab((tab) => {
      if (tab.historyIndex >= tab.history.length - 1) return tab;
      const nextIndex = tab.historyIndex + 1;
      const nextUrl = tab.history[nextIndex] ?? tab.url;
      return {
        ...tab,
        url: nextUrl,
        title: deriveTabTitle(nextUrl),
        faviconUrl: deriveFaviconUrl(nextUrl),
        historyIndex: nextIndex,
      };
    });
  }, [updateActiveTab]);

  const canGoBack = (activeTab?.historyIndex ?? 0) > 0;
  const canGoForward = activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false;

  const openNewTab = useCallback((url?: string) => {
    setTabs((prev) => {
      if (prev.length >= TAB_LIMIT) return prev;
      const id = makeTabId();
      const finalUrl = url ?? DEFAULT_URL;
      const next: BrowserTab = {
        id,
        url: finalUrl,
        title: deriveTabTitle(finalUrl),
        faviconUrl: deriveFaviconUrl(finalUrl),
        history: [finalUrl],
        historyIndex: 0,
      };
      setActiveTabId(id);
      return [...prev, next];
    });
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) {
          // 永远保留至少一个 tab。重置为默认。
          return [
            {
              id: makeTabId(),
              url: DEFAULT_URL,
              title: deriveTabTitle(DEFAULT_URL),
              faviconUrl: deriveFaviconUrl(DEFAULT_URL),
              history: [DEFAULT_URL],
              historyIndex: 0,
            },
          ];
        }
        const closingIndex = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        // 如果关的是当前 tab,激活相邻 tab
        if (id === activeTabId) {
          const fallback = next[Math.min(closingIndex, next.length - 1)];
          if (fallback) setActiveTabId(fallback.id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  // 外部 previewUrl 注入 — 仅当 previewUrl 是"新值"时才 navigate(刷新时 ChatPage
  // 会重新把 store 中持久化的 url 作为 previewUrl 传入,但此时 tabs 已经从
  // localStorage 恢复完毕,不应被 previewUrl 强制 navigate 覆盖。
  // 因此用 previewUrl 作为初始值,避免首次 effect 把恢复的 url 推回成 previewUrl。
  const appliedPreviewUrlRef = useRef<string | null>(previewUrl ?? null);
  useEffect(() => {
    if (previewUrl && previewUrl !== appliedPreviewUrlRef.current) {
      appliedPreviewUrlRef.current = previewUrl;
      navigateActiveTab(previewUrl);
    }
  }, [previewUrl, navigateActiveTab]);

  // 监听全局 "open url" 事件:其他模块(agent / dev-server detect / chat 命令)
  // 派发 window.dispatchEvent(new CustomEvent('openawork:browser:open-url',
  // { detail: { url, mode: 'newTab' | 'currentTab' } })) 即可在浏览器里打开。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { url?: string; mode?: 'newTab' | 'currentTab' }
        | undefined;
      const url = detail?.url;
      if (typeof url !== 'string' || url.length === 0) return;
      if (detail?.mode === 'currentTab') {
        navigateActiveTab(url);
      } else {
        openNewTab(url);
      }
    };
    window.addEventListener(OPEN_URL_EVENT, handler);
    return () => window.removeEventListener(OPEN_URL_EVENT, handler);
  }, [navigateActiveTab, openNewTab]);

  // ── Bookmarks ───────────────────────────────────────────────────────
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks());
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  const isCurrentBookmarked = useMemo(
    () => bookmarks.some((b) => b.url === activeTab?.url),
    [bookmarks, activeTab?.url],
  );

  const toggleBookmarkCurrent = useCallback(() => {
    if (!activeTab) return;
    setBookmarks((prev) => {
      const idx = prev.findIndex((b) => b.url === activeTab.url);
      if (idx >= 0) {
        return prev.filter((_, i) => i !== idx);
      }
      return [
        ...prev,
        {
          id: makeTabId(),
          url: activeTab.url,
          title: activeTab.title || deriveTabTitle(activeTab.url),
          faviconUrl: activeTab.faviconUrl,
          createdAt: Date.now(),
        },
      ];
    });
  }, [activeTab]);

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // ── Console panel state(本地,不持久化;每个 tab 独立缓存)─────────
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleLogsByTab, setConsoleLogsByTab] = useState<Record<string, ConsoleEntry[]>>({});
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // 标记"上一次 url 更新来自 iframe 内部 navigate",webview lifecycle 据此跳过重建。
  const internalNavRef = useRef<{ tabId: string; url: string } | null>(null);

  const consoleLogs = consoleLogsByTab[activeTabId] ?? [];

  // 缓冲 + 节流:iframe 内的 console proxy 短时间内会发出大量 message 事件
  // (dev server 启动、SPA 路由切换、多次 fetch 等)。直接每条都 setState 会让
  // React 同步重渲染上百次,触发 "[Violation] 'message' handler took 157ms"。
  // 这里用 ref 缓存待处理 entries,每 80ms flush 一次到 state。
  const pendingLogEntriesRef = useRef<Array<{ tabId: string; entry: ConsoleEntry }>>([]);
  const pendingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLogFlush = useCallback(() => {
    if (pendingFlushTimerRef.current !== null) return;
    pendingFlushTimerRef.current = setTimeout(() => {
      pendingFlushTimerRef.current = null;
      const queued = pendingLogEntriesRef.current;
      if (queued.length === 0) return;
      pendingLogEntriesRef.current = [];
      setConsoleLogsByTab((prev) => {
        const next: Record<string, ConsoleEntry[]> = { ...prev };
        for (const { tabId, entry } of queued) {
          const list = next[tabId] ?? [];
          next[tabId] = [...list.slice(-200), entry];
        }
        return next;
      });
    }, 80);
  }, []);

  const appendLogToActiveTab = useCallback(
    (entry: ConsoleEntry) => {
      pendingLogEntriesRef.current.push({ tabId: activeTabIdRef.current, entry });
      scheduleLogFlush();
    },
    [scheduleLogFlush],
  );

  // 卸载时清掉 timer
  useEffect(() => {
    return () => {
      if (pendingFlushTimerRef.current !== null) {
        clearTimeout(pendingFlushTimerRef.current);
        pendingFlushTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'oaw-console') {
        appendLogToActiveTab({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          level: event.data.level || 'log',
          message: event.data.message || '',
          timestamp: Date.now(),
          source: event.data.source,
        });
      }
      if (event.data && event.data.type === 'oaw-error') {
        appendLogToActiveTab({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          level: 'error',
          message: `${event.data.message || 'Error'}${event.data.filename ? ` (${event.data.filename}:${event.data.lineno})` : ''}`,
          timestamp: Date.now(),
          source: event.data.filename,
        });
      }
      if (event.data && event.data.type === 'oaw-navigate') {
        const nextUrl = typeof event.data.url === 'string' ? event.data.url : '';
        const nextTitle = typeof event.data.title === 'string' ? event.data.title : '';
        if (nextUrl.length === 0) return;
        const tid = activeTabIdRef.current;
        // 标记"这是来自 iframe 内部的同步信号",而不是用户手动 navigate;
        // webview lifecycle effect 据此跳过 webview 重建,保留页面状态。
        internalNavRef.current = { tabId: tid, url: nextUrl };
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tid) return t;
            // url 没变,可能只是 title 更新
            if (t.url === nextUrl) {
              const trimmedTitle = nextTitle.trim();
              if (trimmedTitle && trimmedTitle !== t.title) {
                return { ...t, title: trimmedTitle };
              }
              return t;
            }
            // 检查 nextUrl 是否已经在 history 中(说明是 back/forward 同步)
            const existingIndex = t.history.indexOf(nextUrl);
            if (existingIndex >= 0) {
              return {
                ...t,
                url: nextUrl,
                title: nextTitle.trim() || deriveTabTitle(nextUrl),
                faviconUrl: deriveFaviconUrl(nextUrl),
                historyIndex: existingIndex,
                // history 不变
              };
            }
            // 新地址:截断 forward,push 新条目
            const truncated = t.history.slice(0, t.historyIndex + 1);
            const nextHistory = [...truncated, nextUrl].slice(-HISTORY_LIMIT);
            return {
              ...t,
              url: nextUrl,
              title: nextTitle.trim() || deriveTabTitle(nextUrl),
              faviconUrl: deriveFaviconUrl(nextUrl),
              history: nextHistory,
              historyIndex: nextHistory.length - 1,
            };
          }),
        );
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [appendLogToActiveTab]);

  useEffect(() => {
    if (consoleOpen && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs.length, consoleOpen]);

  // 关闭某个 tab 时,顺便清掉它的日志缓存(避免内存泄露)。
  useEffect(() => {
    setConsoleLogsByTab((prev) => {
      const tabIds = new Set(tabs.map((t) => t.id));
      const next: Record<string, ConsoleEntry[]> = {};
      for (const id of Object.keys(prev)) {
        if (tabIds.has(id)) next[id] = prev[id]!;
      }
      return next;
    });
  }, [tabs]);

  // 清空当前 tab 的日志
  const clearActiveTabConsole = useCallback(() => {
    setConsoleLogsByTab((prev) => ({ ...prev, [activeTabIdRef.current]: [] }));
  }, []);

  const [isTauri] = useState(isTauriEnv);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const generationRef = useRef(0);
  const activeWebviewRef = useRef<any>(null);
  const tauriDpiRef = useRef<{ LogicalPosition: any; LogicalSize: any } | null>(null);

  const normalizeUrl = useCallback((raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return DEFAULT_URL;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
    return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
  }, []);

  const handleNavigate = useCallback(
    (urlOrQuery?: string) => {
      const next = normalizeUrl(urlOrQuery ?? addressInput);
      setAddressInput(next);
      navigateActiveTab(next);
    },
    [addressInput, normalizeUrl, navigateActiveTab],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleNavigate();
      }
    },
    [handleNavigate],
  );

  const handleCopyUrl = useCallback(() => {
    if (!activeUrl) return;
    void navigator.clipboard?.writeText(activeUrl).catch(() => undefined);
  }, [activeUrl]);

  const handleOpenExternal = useCallback(() => {
    if (!activeUrl) return;
    // 在 Tauri 环境下,window.open 会被 Tauri 默认拦截到系统浏览器;在 web 环境下,
    // window.open 会打开一个新窗口/标签。这两种行为对用户都符合预期"在外部打开"。
    window.open(activeUrl, '_blank', 'noopener,noreferrer');
  }, [activeUrl]);

  const handleSendToChat = useCallback(() => {
    if (!activeTab) return;
    const title = activeTab.title || deriveTabTitle(activeTab.url);
    // 用 markdown 链接格式塞进 composer,便于 LLM 直接读懂"参考此页"。
    const snippet = `[${title}](${activeTab.url})`;
    window.dispatchEvent(
      new CustomEvent('openawork:composer:insert', {
        detail: { text: snippet, mode: 'append' },
      }),
    );
  }, [activeTab]);

  // ── Tauri native webview lifecycle ──────────────────────────────────
  useEffect(() => {
    if (!isTauri || !containerRef.current || !activeUrl) return;

    // 内部 navigate 同步:iframe/webview 已经在新 url,只是 React state 落后。
    // 这种情况不要重建 webview(否则页面状态丢失)。
    const internalNav = internalNavRef.current;
    if (
      internalNav &&
      internalNav.tabId === activeTabIdRef.current &&
      internalNav.url === activeUrl
    ) {
      internalNavRef.current = null;
      return;
    }

    const gen = ++generationRef.current;
    let webview: any = null;
    let observer: ResizeObserver | null = null;
    let rafId = 0;
    let disposed = false;

    setWebviewReady(false);
    setWebviewError(null);

    async function create() {
      try {
        const [{ Webview }, { getCurrentWindow }, dpi] = await Promise.all([
          import('@tauri-apps/api/webview'),
          import('@tauri-apps/api/window'),
          import('@tauri-apps/api/dpi'),
        ]);

        const { LogicalPosition, LogicalSize } = dpi;
        if (disposed || gen !== generationRef.current) return;
        tauriDpiRef.current = { LogicalPosition, LogicalSize };

        const container = containerRef.current;
        if (!container) return;

        const appWindow = getCurrentWindow();
        const rect = container.getBoundingClientRect();
        const label = `browser-${Date.now().toString(36)}`;

        webview = new Webview(appWindow, label, {
          url: activeUrl,
          x: rect.x,
          y: rect.y,
          width: Math.max(rect.width, 100),
          height: Math.max(rect.height, 100),
          focus: false,
        });

        webview.once('tauri://created', () => {
          if (disposed || gen !== generationRef.current) {
            if (webview) {
              webview.close().catch(() => {});
              webview = null;
            }
            return;
          }

          activeWebviewRef.current = webview;
          setWebviewReady(true);

          const syncPosition = () => {
            if (!webview || !container) return;
            const r = container.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) {
              webview.setPosition(new LogicalPosition(-9999, -9999)).catch(() => {});
              return;
            }
            webview.setPosition(new LogicalPosition(r.x, r.y)).catch(() => {});
            webview
              .setSize(new LogicalSize(Math.max(r.width, 1), Math.max(r.height, 1)))
              .catch(() => {});
          };

          observer = new ResizeObserver(() => {
            if (disposed) return;
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(syncPosition);
          });
          observer.observe(container);
        });

        webview.once('tauri://error', (e: unknown) => {
          if (disposed || gen !== generationRef.current) return;
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[BuiltInBrowser] webview error:', msg);
          webview = null;
          activeWebviewRef.current = null;
          setWebviewError(msg);
        });
      } catch (err) {
        if (!disposed && gen === generationRef.current) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[BuiltInBrowser] init error:', msg);
          setWebviewError(msg);
        }
      }
    }

    void create();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      activeWebviewRef.current = null;
      if (webview) {
        webview.close().catch(() => {});
        webview = null;
      }
    };
  }, [isTauri, activeUrl, refreshKey]);

  // ── 切 tab 不重建 webview 的优化:Tauri webview 仍然要重建,因为它绑定 url。
  // 已通过 activeUrl 依赖驱动。

  // ── Visibility toggle ───────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri) return;
    const wv = activeWebviewRef.current;
    const dpi = tauriDpiRef.current;
    if (!wv || !dpi) return;

    if (hidden) {
      wv.setPosition(new dpi.LogicalPosition(-9999, -9999)).catch(() => {});
    } else {
      const container = containerRef.current;
      if (!container) return;
      const r = container.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        wv.setPosition(new dpi.LogicalPosition(r.x, r.y)).catch(() => {});
        wv.setSize(new dpi.LogicalSize(Math.max(r.width, 1), Math.max(r.height, 1))).catch(
          () => {},
        );
      }
    }
  }, [isTauri, hidden]);

  const errorCount = consoleLogs.filter((l) => l.level === 'error').length;
  const warnCount = consoleLogs.filter((l) => l.level === 'warn').length;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 0,
        ...style,
      }}
    >
      {/* Tab bar */}
      <BrowserTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onAddTab={() => openNewTab()}
        canAddTab={tabs.length < TAB_LIMIT}
      />

      {/* Address bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '5px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--header-bg)',
          flexShrink: 0,
        }}
      >
        <NavButton
          title="后退"
          disabled={!canGoBack}
          onClick={goBack}
          icon={
            <>
              <polyline points="15 18 9 12 15 6" />
            </>
          }
        />
        <NavButton
          title="前进"
          disabled={!canGoForward}
          onClick={goForward}
          icon={
            <>
              <polyline points="9 18 15 12 9 6" />
            </>
          }
        />
        <NavButton
          title="刷新"
          onClick={() => setRefreshKey((k) => k + 1)}
          icon={
            <>
              <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.6" />
              <path d="M21 3v6h-6" />
            </>
          }
        />
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入网址或搜索…"
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            padding: '0 10px',
            borderRadius: 13,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 11,
            outline: 'none',
            fontFamily: 'var(--font-mono, monospace)',
            transition: 'border-color 100ms ease, box-shadow 100ms ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-muted)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <button
          type="button"
          title={isCurrentBookmarked ? '取消收藏' : '收藏当前页'}
          onClick={toggleBookmarkCurrent}
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: isCurrentBookmarked
              ? '1px solid color-mix(in oklch, var(--warning) 40%, var(--border))'
              : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: isCurrentBookmarked
              ? 'color-mix(in oklch, var(--warning) 12%, transparent)'
              : 'transparent',
            color: isCurrentBookmarked ? 'var(--warning)' : 'var(--text-2)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 0,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill={isCurrentBookmarked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <BrowserBookmarksDropdown
          bookmarks={bookmarks}
          open={bookmarksOpen}
          onToggle={() => setBookmarksOpen((v) => !v)}
          onClose={() => setBookmarksOpen(false)}
          onSelect={(url) => {
            setBookmarksOpen(false);
            navigateActiveTab(url);
            setAddressInput(url);
          }}
          onRemove={removeBookmark}
        />
        <NavButton
          title="复制 URL"
          onClick={handleCopyUrl}
          icon={
            <>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          }
        />
        <NavButton
          title="在系统浏览器中打开"
          onClick={handleOpenExternal}
          icon={
            <>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </>
          }
        />
        <NavButton
          title="发送到对话"
          onClick={handleSendToChat}
          icon={
            <>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </>
          }
        />
        <button
          type="button"
          onClick={() => handleNavigate()}
          style={{
            height: 26,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border))',
            background: 'color-mix(in oklch, var(--accent) 14%, var(--surface))',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          前往
        </button>
        {/* Console toggle button */}
        <button
          type="button"
          title={consoleOpen ? '关闭控制台' : '打开控制台'}
          onClick={() => setConsoleOpen((v) => !v)}
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: consoleOpen
              ? '1px solid var(--accent)'
              : errorCount > 0
                ? '1px solid var(--danger)'
                : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: consoleOpen
              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
              : errorCount > 0
                ? 'color-mix(in oklch, var(--danger) 8%, transparent)'
                : 'transparent',
            color:
              errorCount > 0 ? 'var(--danger)' : consoleOpen ? 'var(--accent)' : 'var(--text-2)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 0,
            position: 'relative',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M7 15h4" />
            <path d="M7 9l3 3-3 3" />
          </svg>
          {(errorCount > 0 || warnCount > 0) && (
            <span
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                minWidth: 12,
                height: 12,
                borderRadius: 6,
                background: errorCount > 0 ? 'var(--danger)' : 'var(--warning)',
                color: 'var(--accent-text)',
                fontSize: 8,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 2px',
              }}
            >
              {errorCount || warnCount}
            </span>
          )}
        </button>
      </div>

      {/* Webview / iframe area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {isTauri ? (
          <>
            {!webviewReady && !webviewError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-3)',
                  fontSize: 12,
                }}
              >
                正在加载 Webview…
              </div>
            )}
            {webviewError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: 16,
                  color: 'var(--text-3)',
                  fontSize: 11,
                  textAlign: 'center',
                }}
              >
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Webview 创建失败</span>
                <span style={{ maxWidth: 260, wordBreak: 'break-word' }}>{webviewError}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <iframe
              ref={iframeRef}
              key={`${activeTabId}-${refreshKey}`}
              src={activeUrl}
              title="内置浏览器"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              allow="clipboard-read; clipboard-write"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              onLoad={() => {
                try {
                  const iframeWindow = iframeRef.current?.contentWindow;
                  if (iframeWindow) {
                    injectConsoleProxy(iframeWindow);
                  }
                } catch {
                  appendLogToActiveTab({
                    id: `${Date.now()}-info`,
                    level: 'info',
                    message: `页面已加载: ${activeUrl}（跨域页面无法捕获控制台输出）`,
                    timestamp: Date.now(),
                  });
                }
              }}
              onError={() => {
                appendLogToActiveTab({
                  id: `${Date.now()}-err`,
                  level: 'error',
                  message: `无法加载: ${activeUrl}`,
                  timestamp: Date.now(),
                });
              }}
            />
            {activeUrl && !isLocalhostUrl(activeUrl) && !consoleOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 8,
                  right: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'color-mix(in oklch, var(--surface) 95%, var(--warning) 5%)',
                  border: '1px solid color-mix(in oklch, var(--warning) 30%, var(--border))',
                  fontSize: 10,
                  color: 'var(--text-2)',
                  pointerEvents: 'none',
                  opacity: 0.9,
                }}
              >
                💡 提示：大多数外部网站禁止在 iframe
                中加载。本地开发服务器（localhost）可正常预览，外部站点请用「在系统浏览器中打开」。
              </div>
            )}
          </>
        )}
      </div>

      {consoleOpen && (
        <BrowserConsolePanel
          logs={consoleLogs}
          endRef={consoleEndRef}
          onClear={clearActiveTabConsole}
          onClose={() => setConsoleOpen(false)}
          tauriMode={isTauri}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab Bar
// ---------------------------------------------------------------------------

function BrowserTabBar(props: {
  tabs: BrowserTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  canAddTab: boolean;
}) {
  const { tabs, activeTabId, onSelectTab, onCloseTab, onAddTab, canAddTab } = props;
  return (
    <div
      data-testid="browser-tab-bar"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        padding: '4px 6px 0',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg)',
        flexShrink: 0,
        overflowX: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
            title={tab.url}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              minWidth: 0,
              maxWidth: 180,
              padding: '0 4px 0 9px',
              height: 24,
              borderRadius: '6px 6px 0 0',
              border: '1px solid var(--border-subtle)',
              borderBottom: isActive ? 'none' : '1px solid var(--border-subtle)',
              marginBottom: -1,
              background: isActive ? 'var(--header-bg)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--text-3)',
              fontSize: 10.5,
              fontWeight: isActive ? 600 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            {tab.faviconUrl ? (
              <img
                src={tab.faviconUrl}
                alt=""
                width={14}
                height={14}
                style={{
                  flexShrink: 0,
                  borderRadius: 2,
                  objectFit: 'contain',
                }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : null}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                maxWidth: 140,
              }}
            >
              {tab.title || deriveTabTitle(tab.url)}
            </span>
            <button
              type="button"
              aria-label="关闭标签"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="ui-hover-icon-pop"
              style={{
                width: 16,
                height: 16,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: 4,
                background: 'transparent',
                color: 'var(--text-3)',
                fontSize: 11,
                lineHeight: 1,
                cursor: 'pointer',
                opacity: 0.7,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAddTab}
        title={canAddTab ? '新建标签页' : `已达上限 (${TAB_LIMIT})`}
        disabled={!canAddTab}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-3)',
          fontSize: 13,
          lineHeight: 1,
          cursor: canAddTab ? 'pointer' : 'not-allowed',
          opacity: canAddTab ? 1 : 0.4,
          marginBottom: -1,
          flexShrink: 0,
        }}
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 通用 nav 按钮
// ---------------------------------------------------------------------------

function NavButton(props: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
}) {
  const { title, onClick, disabled, icon } = props;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 26,
        height: 26,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        background: 'transparent',
        color: disabled ? 'var(--text-4)' : 'var(--text-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        fontSize: 0,
      }}
      className="ui-hover-icon-pop"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bookmarks Dropdown
// ---------------------------------------------------------------------------

function BrowserBookmarksDropdown(props: {
  bookmarks: Bookmark[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  const { bookmarks, open, onToggle, onClose, onSelect, onRemove } = props;
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapRef.current && wrapRef.current.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        title="书签"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: 26,
          height: 26,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: open ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
          borderRadius: 6,
          background: open ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--text-2)',
          cursor: 'pointer',
          fontSize: 0,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="14" y2="18" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: 320,
            overflowY: 'auto',
            padding: '4px 0',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {bookmarks.length === 0 ? (
            <div
              style={{
                padding: '14px 16px',
                color: 'var(--text-3)',
                fontSize: 11,
                textAlign: 'center',
              }}
            >
              暂无书签 · 点击地址栏星形图标收藏
            </div>
          ) : (
            bookmarks
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((bm) => (
                <div
                  key={bm.id}
                  role="menuitem"
                  onClick={() => onSelect(bm.url)}
                  className="ui-hover-icon-pop"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  {bm.faviconUrl ? (
                    <img
                      src={bm.faviconUrl}
                      alt=""
                      width={14}
                      height={14}
                      style={{ flexShrink: 0, borderRadius: 2 }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span style={{ width: 14, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {bm.title}
                    </div>
                    <div
                      style={{
                        fontSize: 9.5,
                        color: 'var(--text-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    >
                      {bm.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="删除书签"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(bm.id);
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      borderRadius: 4,
                      background: 'transparent',
                      color: 'var(--text-3)',
                      fontSize: 11,
                      lineHeight: 1,
                      cursor: 'pointer',
                      opacity: 0.7,
                      flexShrink: 0,
                    }}
                    className="ui-hover-icon-pop"
                    data-tone="danger"
                  >
                    ✕
                  </button>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Console Panel Types & Components
// ---------------------------------------------------------------------------

interface ConsoleEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'network';
  message: string;
  timestamp: number;
  source?: string;
}

const LEVEL_COLORS: Record<ConsoleEntry['level'], string> = {
  log: 'var(--text-2)',
  info: 'var(--accent)',
  warn: 'var(--warning)',
  error: 'var(--danger)',
  debug: 'oklch(0.7 0.16 290)',
  network: 'oklch(0.7 0.16 220)',
};

const LEVEL_BG: Record<ConsoleEntry['level'], string> = {
  log: 'transparent',
  info: 'transparent',
  warn: 'color-mix(in oklch, var(--warning) 6%, transparent)',
  error: 'color-mix(in oklch, var(--danger) 6%, transparent)',
  debug: 'transparent',
  network: 'color-mix(in oklch, oklch(0.7 0.16 220) 4%, transparent)',
};

function BrowserConsolePanel({
  logs,
  endRef,
  onClear,
  onClose,
  tauriMode,
}: {
  logs: ConsoleEntry[];
  endRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onClose: () => void;
  tauriMode?: boolean;
}) {
  const [filter, setFilter] = useState<ConsoleEntry['level'] | 'all'>('all');

  const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.level === filter);
  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  return (
    <div
      data-testid="browser-console-panel"
      style={{
        flexShrink: 0,
        height: 'clamp(120px, 28vh, 220px)',
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)', marginRight: 4 }}>
          控制台
        </span>

        <FilterPill
          label="全部"
          count={logs.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterPill
          label="错误"
          count={errorCount}
          active={filter === 'error'}
          onClick={() => setFilter('error')}
          color="var(--danger)"
        />
        <FilterPill
          label="警告"
          count={warnCount}
          active={filter === 'warn'}
          onClick={() => setFilter('warn')}
          color="var(--warning)"
        />
        <FilterPill
          label="日志"
          count={logs.filter((l) => l.level === 'log').length}
          active={filter === 'log'}
          onClick={() => setFilter('log')}
        />
        <FilterPill
          label="网络"
          count={logs.filter((l) => l.level === 'network').length}
          active={filter === 'network'}
          onClick={() => setFilter('network')}
          color="oklch(0.7 0.16 220)"
        />

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onClear}
          title="清空控制台"
          style={{
            height: 20,
            padding: '0 6px',
            borderRadius: 4,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-3)',
            fontSize: 9,
            cursor: 'pointer',
          }}
        >
          清空
        </button>
        <button
          type="button"
          onClick={onClose}
          title="关闭控制台"
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-3)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '2px 0',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {filteredLogs.length === 0 ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--text-4)',
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            {tauriMode ? (
              <>
                Tauri 原生窗口模式下无法监听页面控制台与网络
                <br />
                <span style={{ opacity: 0.7 }}>
                  建议在浏览器(Web)模式下使用控制台,或在 dev tools 中查看
                </span>
              </>
            ) : logs.length === 0 ? (
              '暂无控制台输出 · 跨域页面(非 localhost)无法注入,只能展示同源页面的日志'
            ) : (
              '当前过滤条件下无匹配'
            )}
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                padding: '2px 8px',
                borderBottom:
                  '1px solid color-mix(in oklch, var(--border-subtle) 50%, transparent)',
                background: LEVEL_BG[entry.level],
                minHeight: 20,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: LEVEL_COLORS[entry.level],
                  textTransform: 'uppercase',
                  width: 32,
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                {entry.level === 'error'
                  ? '❌'
                  : entry.level === 'warn'
                    ? '⚠️'
                    : entry.level === 'info'
                      ? 'ℹ️'
                      : entry.level === 'network'
                        ? '🌐'
                        : '›'}
              </span>
              <span
                style={{
                  flex: 1,
                  color: LEVEL_COLORS[entry.level],
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {entry.message}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--text-4)',
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                {formatTime(entry.timestamp)}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 18,
        padding: '0 5px',
        borderRadius: 9,
        border: active ? `1px solid ${color || 'var(--accent)'}` : '1px solid var(--border-subtle)',
        background: active
          ? `color-mix(in oklch, ${color || 'var(--accent)'} 12%, transparent)`
          : 'transparent',
        color: active ? color || 'var(--accent)' : 'var(--text-3)',
        fontSize: 9,
        fontWeight: 500,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {label}
      {count > 0 && <span style={{ fontWeight: 700 }}>{count}</span>}
    </button>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

/**
 * Inject a console proxy into the iframe window that forwards
 * console.log/warn/error/info to the parent via postMessage.
 */
function injectConsoleProxy(iframeWindow: Window): void {
  try {
    const script = iframeWindow.document.createElement('script');
    script.textContent = `
      (function() {
        // 防御策略:每段独立 try-catch,任何一段失败都不影响其他;
        // 不覆盖 history.pushState/replaceState(很多 userscript 也猴补丁这俩,
        // 重复 wrap 会破坏链式调用),改用 location 轮询。
        var marker = '__OAW_PROXY_INSTALLED__';
        if (window[marker]) return;
        try { Object.defineProperty(window, marker, { value: true, configurable: false }); }
        catch(e) { window[marker] = true; }

        // ── console 代理 ────────────────────────────────────────────
        try {
          var origConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug
          };
          function stringify(args) {
            return Array.from(args).map(function(a) {
              if (a === null) return 'null';
              if (a === undefined) return 'undefined';
              if (typeof a === 'object') {
                try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
              }
              return String(a);
            }).join(' ');
          }
          ['log','info','warn','error','debug'].forEach(function(level) {
            var orig = origConsole[level];
            console[level] = function() {
              try { orig.apply(console, arguments); } catch(e) {}
              try {
                parent.postMessage({ type: 'oaw-console', level: level, message: stringify(arguments) }, '*');
              } catch(e) {}
            };
          });
        } catch(e) {}

        // ── 错误捕获(addEventListener 而非 onerror,避免覆盖现有 handler)──
        try {
          window.addEventListener('error', function(e) {
            try {
              parent.postMessage({
                type: 'oaw-error',
                message: String(e && e.message || 'Error'),
                filename: (e && e.filename) || '',
                lineno: (e && e.lineno) || 0
              }, '*');
            } catch(_) {}
          });
          window.addEventListener('unhandledrejection', function(e) {
            try {
              parent.postMessage({
                type: 'oaw-error',
                message: 'Unhandled Promise Rejection: ' + (e && e.reason ? String(e.reason.message || e.reason) : 'unknown'),
                filename: '',
                lineno: 0
              }, '*');
            } catch(_) {}
          });
        } catch(e) {}

        // ── 导航监听(轮询 location,避免动 history.pushState 的猴补丁)──
        try {
          var lastHref = location.href;
          var lastTitle = document.title;
          function notify(reason) {
            try {
              parent.postMessage({
                type: 'oaw-navigate',
                url: location.href,
                title: document.title || '',
                reason: reason || 'change'
              }, '*');
            } catch(e) {}
          }
          setInterval(function() {
            if (location.href !== lastHref) {
              lastHref = location.href;
              lastTitle = document.title;
              notify('poll');
            } else if (document.title !== lastTitle) {
              lastTitle = document.title;
              notify('title');
            }
          }, 500);
          window.addEventListener('popstate', function() {
            if (location.href !== lastHref) {
              lastHref = location.href;
              notify('popstate');
            }
          });
          window.addEventListener('hashchange', function() {
            if (location.href !== lastHref) {
              lastHref = location.href;
              notify('hashchange');
            }
          });
          // 初次:发送一次让 parent 知道真正的 location
          setTimeout(function() {
            try {
              parent.postMessage({
                type: 'oaw-navigate',
                url: location.href,
                title: document.title || '',
                reason: 'load'
              }, '*');
              lastHref = location.href;
              lastTitle = document.title;
            } catch(e) {}
          }, 0);
        } catch(e) {}

        // ── fetch 钩子(检测是否已被其他扩展 wrap) ──────────────────
        try {
          var origFetch = window.fetch;
          if (typeof origFetch === 'function' && !origFetch.__oawWrapped) {
            var newFetch = function() {
              var args = Array.prototype.slice.call(arguments);
              var input = args[0];
              var init = args[1] || {};
              var method = (init.method || (input && input.method) || 'GET').toUpperCase();
              var url = typeof input === 'string' ? input : (input && input.url) || String(input);
              var startedAt = Date.now();
              var pre = method + ' ' + url;
              try {
                parent.postMessage({ type: 'oaw-console', level: 'network', message: '⟶ ' + pre }, '*');
              } catch(e) {}
              return origFetch.apply(this, args).then(function(res) {
                var dt = Date.now() - startedAt;
                try {
                  parent.postMessage({
                    type: 'oaw-console',
                    level: 'network',
                    message: '⟵ ' + res.status + ' ' + pre + ' · ' + dt + 'ms'
                  }, '*');
                } catch(e) {}
                return res;
              }, function(err) {
                var dt = Date.now() - startedAt;
                try {
                  parent.postMessage({
                    type: 'oaw-console',
                    level: 'network',
                    message: '✗ ' + pre + ' · ' + dt + 'ms · ' + (err && err.message || err)
                  }, '*');
                } catch(e) {}
                throw err;
              });
            };
            try { newFetch.__oawWrapped = true; } catch(e) {}
            window.fetch = newFetch;
          }
        } catch(e) {}

        // ── XHR 钩子 ────────────────────────────────────────────────
        try {
          if (typeof window.XMLHttpRequest === 'function') {
            var OrigXHR = window.XMLHttpRequest;
            var origOpen = OrigXHR.prototype.open;
            var origSend = OrigXHR.prototype.send;
            if (typeof origOpen === 'function' && !origOpen.__oawWrapped) {
              var newOpen = function(method, url) {
                this.__oawMethod = method;
                this.__oawUrl = url;
                return origOpen.apply(this, arguments);
              };
              try { newOpen.__oawWrapped = true; } catch(e) {}
              OrigXHR.prototype.open = newOpen;
            }
            if (typeof origSend === 'function' && !origSend.__oawWrapped) {
              var newSend = function() {
                var self = this;
                var startedAt = Date.now();
                var pre = (self.__oawMethod || 'GET') + ' ' + (self.__oawUrl || '');
                try {
                  parent.postMessage({ type: 'oaw-console', level: 'network', message: '⟶ ' + pre + ' (XHR)' }, '*');
                } catch(e) {}
                try {
                  self.addEventListener('loadend', function() {
                    var dt = Date.now() - startedAt;
                    try {
                      parent.postMessage({
                        type: 'oaw-console',
                        level: 'network',
                        message: '⟵ ' + (self.status || 0) + ' ' + pre + ' · ' + dt + 'ms (XHR)'
                      }, '*');
                    } catch(e) {}
                  });
                } catch(e) {}
                return origSend.apply(this, arguments);
              };
              try { newSend.__oawWrapped = true; } catch(e) {}
              OrigXHR.prototype.send = newSend;
            }
          }
        } catch(e) {}
      })();
    `;
    iframeWindow.document.head.appendChild(script);
  } catch {
    // Cross-origin — can't inject
  }
}
