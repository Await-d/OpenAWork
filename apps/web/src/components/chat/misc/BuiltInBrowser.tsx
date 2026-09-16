import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { BrowserConsolePanel } from './browser/BrowserConsolePanel.js';
import { BrowserContentArea } from './browser/engines/browser-content-area.js';
import { insertTextIntoComposer } from './browser/browser-clipboard.js';
import {
  isPendingNetworkPayload,
  parseNetworkPayload,
} from './browser/browser-console-format.js';
import { upsertNetworkEntry } from './browser/live-console-bridge.js';
import type {
  ConsoleEntry,
  NetworkExchange,
  NetworkMessagePayload,
} from './browser/browser-console-types.js';
import { countErrorDigestProblems, sendErrorDigestToComposer } from './browser/error-digest.js';
import {
  DEFAULT_URL,
  TAB_LIMIT,
  deriveFaviconUrl,
  deriveTabTitle,
  loadBookmarks,
  loadPersistedState,
  makeTabId,
  persistState,
  saveBookmarks,
  type Bookmark,
  type BrowserTab,
} from './browser/browser-storage.js';
import { BrowserShortcutHints } from './browser/browser-shortcut-hints.js';
import { BrowserToolbar } from './browser/BrowserToolbar.js';
import { DEFAULT_DEVICE_PRESET_ID } from './browser/device-presets.js';
import { useEngineCapability } from './browser/hooks/use-engine-capability.js';
import { useBrowserLiveWiring } from './browser/hooks/use-browser-live-wiring.js';
import { useBrowserInspector } from './browser/hooks/use-browser-inspector.js';
import { useBrowserPreviewShortcutsWiring } from './browser/hooks/use-browser-preview-shortcuts-wiring.js';
import { useTauriWebview } from './browser/hooks/use-tauri-webview.js';
import { useWorkspaceIndexRefresh } from './browser/hooks/use-workspace-index-refresh.js';
import type { NetworkCaptureStatus } from './browser/NetworkWaterfall.js';

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
          next[op.tabId] = upsertNetworkEntry(list, op.exchange, {
            now: Date.now(),
            limit: CONSOLE_ENTRY_LIMIT,
          });
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
  const [pickArmed, setPickArmed] = useState(false);
  // 拾取意图：工具栏与检查器的「在页面中拾取」都下发 `pick`（结果进 composer），
  // 检查器的「获取完整样式」则下发 `node.styles`（只读样式，不写 composer）。
  const [pickIntent, setPickIntent] = useState<'composer' | 'styles'>('composer');
  // 实时引擎接线（可用性 + 事件 → 既有控制台状态）；Tauri 保留原生 webview 分支。
  const liveWiring = useBrowserLiveWiring({
    enabled: !isTauri,
    appendLog: appendLogToActiveTab,
    upsertNetwork: upsertNetworkExchange,
  });
  // 网关状态里与实时能力有关的两个布尔值只在这里派生一次；能力矩阵与各面板
  // 统一消费它们，避免「可用性判断」散落在多个 JSX 表达式里各自漂移。
  const liveAvailability = liveWiring.availability;
  const liveEngineAvailable = liveAvailability?.available === true;
  const liveScreencastAvailable = liveAvailability?.screencast === true;
  const liveUnavailable = liveAvailability !== null && liveAvailability.available === false;
  // 元素检查器：与控制台共用同一条实时通道（订阅是扇出的，不新开连接）。
  const inspector = useBrowserInspector({
    session: liveWiring.session,
    enabled: !isTauri,
    armPickForStyles: () => {
      setPickIntent('styles');
      setPickArmed(true);
    },
  });
  const armPickForComposer = useCallback(() => {
    setPickIntent('composer');
    setPickArmed(true);
  }, []);
  const disarmPick = useCallback(() => {
    setPickIntent('composer');
    setPickArmed(false);
  }, []);
  const engineCapability = useEngineCapability({
    engine: isTauri ? 'tauri-webview' : 'iframe',
    url: activeUrl,
    liveAvailable: liveEngineAvailable,
    liveScreencast: liveScreencastAvailable,
  });
  // 设备预览（预设视口 + 纯前端缩放）：CDP 实时与 iframe 回退共用，Tauri 原生 webview 不参与。
  const [devicePresetId, setDevicePresetId] = useState<string>(DEFAULT_DEVICE_PRESET_ID);
  const [zoom, setZoom] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  // 工作区文件变化（Agent 写盘 / 用户保存）时，通过既有的 refreshKey 机制强制重载预览。
  useWorkspaceIndexRefresh({
    enabled: !hidden && Boolean(workspacePath),
    workspacePath: workspacePath ?? null,
    onChange: () => setRefreshKey((value) => value + 1),
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // 预览快捷键接线：动作与工具栏控件读写同一份状态（缩放 / 预设算法见 wiring hook）。
  const previewShortcuts = useBrowserPreviewShortcutsWiring({
    hidden,
    surfaceRef: containerRef,
    devicePreviewEnabled: !isTauri,
    setRefreshKey,
    setConsoleOpen,
    setZoom,
    setDevicePresetId,
  });

  const generationRef = useRef(0);
  const { webviewReady, webviewError } = useTauriWebview({
    isTauri,
    activeUrl,
    refreshKey,
    hidden,
    containerRef,
    internalNavRef,
    activeTabIdRef,
    generationRef,
  });

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

  const handleSendProblems = useCallback(() => {
    sendErrorDigestToComposer(consoleLogs, { url: activeUrl, title: activeTab?.title ?? null });
  }, [consoleLogs, activeUrl, activeTab]);

  const errorCount = consoleLogs.filter((l) => l.level === 'error').length;
  const warnCount = consoleLogs.filter((l) => l.level === 'warn').length;
  const problemCount = countErrorDigestProblems(consoleLogs);

  // 网络瀑布视图的空态文案据此区分：Tauri 原生窗口没有实时引擎；建连中展示骨架屏。
  const livePhase = liveWiring.session.phase;
  const networkCaptureStatus: NetworkCaptureStatus = isTauri
    ? 'unavailable'
    : livePhase === 'connecting' || livePhase === 'reconnecting'
      ? 'loading'
      : 'ready';

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
      <BrowserToolbar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onAddTab={() => openNewTab()}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
        onRefresh={previewShortcuts.reload}
        addressInput={addressInput}
        onAddressChange={setAddressInput}
        onAddressKeyDown={handleKeyDown}
        isCurrentBookmarked={isCurrentBookmarked}
        onToggleBookmark={toggleBookmarkCurrent}
        bookmarks={bookmarks}
        bookmarksOpen={bookmarksOpen}
        onToggleBookmarks={() => setBookmarksOpen((v) => !v)}
        onCloseBookmarks={() => setBookmarksOpen(false)}
        onSelectBookmark={(url) => {
          setBookmarksOpen(false);
          navigateActiveTab(url);
          setAddressInput(url);
        }}
        onRemoveBookmark={removeBookmark}
        onCopyUrl={handleCopyUrl}
        onOpenExternal={handleOpenExternal}
        onSendToChat={handleSendToChat}
        onNavigate={() => handleNavigate()}
        consoleOpen={consoleOpen}
        onToggleConsole={previewShortcuts.toggleConsole}
        errorCount={errorCount}
        warnCount={warnCount}
        problemCount={problemCount}
        onSendProblems={handleSendProblems}
        capability={engineCapability}
        pickArmed={pickArmed}
        onTogglePick={() => {
          setPickIntent('composer');
          setPickArmed((value) => !value);
        }}
        devicePresetId={devicePresetId}
        onDevicePresetChange={setDevicePresetId}
        zoom={zoom}
        onZoomChange={setZoom}
        devicePreviewEnabled={!isTauri}
      />

      {!hidden && <BrowserShortcutHints shortcuts={previewShortcuts.active} />}

      {liveWiring.unavailableHint !== null && (
        <div
          role="status"
          style={{
            padding: '5px 10px',
            borderBottom:
              '1px solid color-mix(in oklch, var(--warning) 30%, var(--border-default))',
            background: 'color-mix(in oklch, var(--warning) 10%, var(--bg-overlay))',
            color: 'var(--fg-default)',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {liveWiring.unavailableHint}
        </div>
      )}

      <BrowserContentArea
        containerRef={containerRef}
        isTauri={isTauri}
        webviewReady={webviewReady}
        webviewError={webviewError}
        activeUrl={activeUrl}
        iframeRef={iframeRef}
        activeTabId={activeTabId}
        refreshKey={refreshKey}
        hidden={hidden}
        appendLogToActiveTab={appendLogToActiveTab}
        consoleOpen={consoleOpen}
        onRefreshRequested={previewShortcuts.reload}
        liveActive={engineCapability.liveView}
        liveSession={liveWiring.session}
        liveAvailable={liveEngineAvailable}
        pickArmed={pickArmed}
        onPickConsumed={disarmPick}
        onPickCancel={disarmPick}
        pickIntent={pickIntent}
        onPickPoint={inspector.recordPickPoint}
        devicePresetId={devicePresetId}
        zoom={zoom}
      />

      {consoleOpen && (
        <BrowserConsolePanel
          logs={consoleLogs}
          endRef={consoleEndRef}
          onClear={clearActiveTabConsole}
          onClose={() => setConsoleOpen(false)}
          tauriMode={isTauri}
          liveAvailable={liveEngineAvailable}
          pageUrl={activeUrl}
          pageTitle={activeTab?.title ?? null}
          networkCaptureStatus={networkCaptureStatus}
          inspector={{
            dom: inspector.dom,
            a11y: inspector.a11y,
            node: inspector.node,
            domStatus: inspector.domStatus,
            a11yStatus: inspector.a11yStatus,
            nodeStatus: inspector.nodeStatus,
            errorMessage: inspector.errorMessage,
            unavailable: isTauri || liveUnavailable,
            unavailableHint: liveWiring.unavailableHint,
            pickArmed,
            onRequestDom: inspector.requestDom,
            onRequestA11y: inspector.requestA11y,
            onRequestFullStyles: inspector.requestFullStyles,
            onArmPick: armPickForComposer,
            onDisarmPick: disarmPick,
          }}
        />
      )}
    </div>
  );
}
