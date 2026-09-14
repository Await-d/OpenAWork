import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { BrowserReadinessBar } from './browser/BrowserReadinessBar.js';
import { usePageReadiness } from './browser/use-page-readiness.js';
import { BrowserConsolePanel } from './browser/BrowserConsolePanel.js';
import { injectConsoleProxy } from './browser/console-proxy.js';
import { insertTextIntoComposer } from './browser/browser-clipboard.js';
import {
  formatNetworkEntryMessage,
  isPendingNetworkPayload,
  mergeNetworkIntoEntry,
  parseNetworkPayload,
} from './browser/browser-console-format.js';
import type {
  ConsoleEntry,
  NetworkExchange,
  NetworkMessagePayload,
} from './browser/browser-console-types.js';
import {
  DEFAULT_URL,
  TAB_LIMIT,
  deriveFaviconUrl,
  deriveTabTitle,
  isLocalhostUrl,
  loadBookmarks,
  loadPersistedState,
  makeTabId,
  persistState,
  saveBookmarks,
  type Bookmark,
  type BrowserTab,
} from './browser/browser-storage.js';
import { BrowserBookmarksDropdown, BrowserTabBar, NavButton } from './browser/browser-chrome.js';

const isTauriEnv = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const HISTORY_LIMIT = 50;
const OPEN_URL_EVENT = 'openawork:browser:open-url';
/** 每个 tab 控制台保留的最大条目数，超出丢弃最旧的。 */
const CONSOLE_ENTRY_LIMIT = 200;

/**
 * 控制台待处理操作。网络请求分三段到达，需要 `upsertNetwork` 把后到的
 * 响应/响应体并进同一行；普通日志与错误则是纯追加。
 */
type PendingConsoleOp =
  | { kind: 'append'; tabId: string; entry: ConsoleEntry }
  | { kind: 'upsertNetwork'; tabId: string; exchange: NetworkExchange };

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
        { url?: string; mode?: 'newTab' | 'currentTab' } | undefined;
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
  /**
   * 记录"iframe 已经成功加载过哪个 URL"。页面就绪探测成功后据此判断
   * 是否需要重新加载：只有当当前 URL 从没加载成功过（典型的"服务还没
   * 起来就先加载了"）才刷新，正常情况不会多打一次请求。
   */
  const iframeLoadedUrlRef = useRef<string | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // 标记"上一次 url 更新来自 iframe 内部 navigate",webview lifecycle 据此跳过重建。
  const internalNavRef = useRef<{ tabId: string; url: string } | null>(null);

  const consoleLogs = consoleLogsByTab[activeTabId] ?? [];

  // 缓冲 + 节流:iframe 内的 console proxy 短时间内会发出大量 message 事件
  // (dev server 启动、SPA 路由切换、多次 fetch 等)。直接每条都 setState 会让
  // React 同步重渲染上百次,触发 "[Violation] 'message' handler took 157ms"。
  // 这里用 ref 缓存待处理操作,每 80ms flush 一次到 state。
  //
  // 网络请求是**分三段**上报的（request → response → body），队列里除 append
  // 外还有 upsert：按 networkId 把新字段并进已有那一行，而不是一个请求占三行。
  const pendingConsoleOpsRef = useRef<PendingConsoleOp[]>([]);
  const pendingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLogFlush = useCallback(() => {
    if (pendingFlushTimerRef.current !== null) return;
    pendingFlushTimerRef.current = setTimeout(() => {
      pendingFlushTimerRef.current = null;
      const queued = pendingConsoleOpsRef.current;
      if (queued.length === 0) return;
      pendingConsoleOpsRef.current = [];
      setConsoleLogsByTab((prev) => {
        const next: Record<string, ConsoleEntry[]> = { ...prev };
        for (const op of queued) {
          const list = next[op.tabId] ?? [];
          if (op.kind === 'append') {
            next[op.tabId] = [...list.slice(-CONSOLE_ENTRY_LIMIT), op.entry];
            continue;
          }
          const index = list.findIndex(
            (entry) => entry.network?.networkId === op.exchange.networkId,
          );
          next[op.tabId] =
            index >= 0
              ? list.map((entry, i) =>
                  i === index ? mergeNetworkIntoEntry(entry, op.exchange) : entry,
                )
              : [
                  ...list.slice(-CONSOLE_ENTRY_LIMIT),
                  {
                    id: `net-${op.exchange.networkId}`,
                    level: 'network',
                    message: formatNetworkEntryMessage(op.exchange),
                    timestamp: Date.now(),
                    network: op.exchange,
                  },
                ];
        }
        return next;
      });
    }, 80);
  }, []);

  const appendLogToActiveTab = useCallback(
    (entry: ConsoleEntry) => {
      pendingConsoleOpsRef.current.push({
        kind: 'append',
        tabId: activeTabIdRef.current,
        entry,
      });
      scheduleLogFlush();
    },
    [scheduleLogFlush],
  );

  /** 归并一段网络上报：同一个 networkId 始终落在同一行。 */
  const upsertNetworkExchange = useCallback(
    (exchange: NetworkExchange) => {
      pendingConsoleOpsRef.current.push({
        kind: 'upsertNetwork',
        tabId: activeTabIdRef.current,
        exchange,
      });
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
      // 结构化网络上报：request / response / body 三段，按 networkId 归并。
      if (event.data && event.data.type === 'oaw-network') {
        const payload = event.data as NetworkMessagePayload;
        const exchange = parseNetworkPayload(payload);
        if (exchange) {
          if (isPendingNetworkPayload(payload)) {
            exchange.pending = true;
          }
          upsertNetworkExchange(exchange);
        }
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
  }, [appendLogToActiveTab, upsertNetworkExchange]);

  useEffect(() => {
    if (!consoleOpen) return;
    // scrollIntoView 并非所有环境都实现（部分内嵌 webview / 测试环境），
    // 缺失时静默跳过即可，不该让自动滚动把控制台搞崩。
    consoleEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
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

  // ── 页面就绪探测 ────────────────────────────────────────────────────
  // dev server 从启动到开始监听端口有几秒空窗，这段时间加载必然是错误页。
  // 这里主动探活，就绪后如果当前 URL 还没加载成功过就自动重载一次，
  // 用户不必再手动刷新；探测期间顶部状态条给出明确反馈。
  // Tauri 原生 webview 由宿主管理加载，不参与探测。
  const pageReadiness = usePageReadiness({
    url: activeUrl,
    enabled: !isTauri,
    onReady: () => {
      if (iframeLoadedUrlRef.current === activeUrl) return;
      setRefreshKey((key) => key + 1);
    },
  });

  // URL 变化时重置"已加载"标记，让新地址重新走一次就绪判断。
  useEffect(() => {
    iframeLoadedUrlRef.current = null;
  }, [activeUrl]);

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
    insertTextIntoComposer(`[${title}](${activeTab.url})`);
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
        let rect = container.getBoundingClientRect();

        // 容器尚未完成布局(display:none 或零尺寸)时,用 ResizeObserver 等待
        // 它变为可见且有尺寸后再创建 webview,避免 Tauri 原生 webview 初始化失败。
        if (rect.width < 1 || rect.height < 1) {
          await new Promise<void>((resolve) => {
            const wait = new ResizeObserver(() => {
              const r = container.getBoundingClientRect();
              if (r.width >= 1 && r.height >= 1) {
                wait.disconnect();
                resolve();
              }
            });
            wait.observe(container);
            // 安全超时:5s 后即使容器仍零尺寸也继续(用 Math.max 兜底)。
            const timer = setTimeout(() => {
              wait.disconnect();
              resolve();
            }, 5000);
            // 清理:组件卸载或 generation 变化时中止等待。
            const check = setInterval(() => {
              if (disposed || gen !== generationRef.current) {
                clearInterval(check);
                clearTimeout(timer);
                wait.disconnect();
                resolve();
              }
            }, 200);
          });
          if (disposed || gen !== generationRef.current) return;
          rect = container.getBoundingClientRect();
        }

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
          const raw =
            typeof e === 'object' && e !== null && 'payload' in e
              ? (e as Record<string, unknown>).payload
              : e;
          const msg =
            raw instanceof Error
              ? raw.message
              : typeof raw === 'object' && raw !== null && 'message' in raw
                ? String((raw as Record<string, unknown>).message)
                : typeof raw === 'string'
                  ? raw
                  : String(raw);
          console.error('[BuiltInBrowser] webview error:', msg);
          webview = null;
          activeWebviewRef.current = null;
          setWebviewError(msg);
        });
      } catch (err) {
        if (!disposed && gen === generationRef.current) {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === 'object' && err !== null && 'message' in err
                ? String((err as Record<string, unknown>).message)
                : String(err);
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
          background: 'var(--bg-overlay)',
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
            background: 'var(--bg-base)',
            color: 'var(--fg-strong)',
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
              ? '1px solid color-mix(in oklch, var(--warning) 40%, var(--border-default))'
              : '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: isCurrentBookmarked
              ? 'color-mix(in oklch, var(--warning) 12%, transparent)'
              : 'transparent',
            color: isCurrentBookmarked ? 'var(--warning)' : 'var(--fg-default)',
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
            border: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))',
            background: 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))',
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
              errorCount > 0
                ? 'var(--danger)'
                : consoleOpen
                  ? 'var(--accent)'
                  : 'var(--fg-default)',
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
                color: 'var(--fg-on-accent)',
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
                  color: 'var(--fg-muted)',
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
                  color: 'var(--fg-muted)',
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
            <BrowserReadinessBar
              state={pageReadiness.state}
              attempt={pageReadiness.attempt}
              nextRetryInMs={pageReadiness.nextRetryInMs}
              url={activeUrl}
              onRetry={pageReadiness.retry}
            />
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
                display: hidden ? 'none' : undefined,
              }}
              onLoad={() => {
                iframeLoadedUrlRef.current = activeUrl;
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
                  background: 'color-mix(in oklch, var(--bg-overlay) 95%, var(--warning) 5%)',
                  border:
                    '1px solid color-mix(in oklch, var(--warning) 30%, var(--border-default))',
                  fontSize: 10,
                  color: 'var(--fg-default)',
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
