import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useWorkspaceReadIdentity } from '../../../stores/ui/uiState.js';
import { BrowserConsolePanel } from './browser/BrowserConsolePanel.js';
import type { BrowserInspectorPanelProps } from './browser/BrowserInspectorPanel.js';
import { BrowserContentArea } from './browser/engines/browser-content-area.js';
import { copyTextToClipboard, insertTextIntoComposer } from './browser/browser-clipboard.js';
import { isPendingNetworkPayload, parseNetworkPayload } from './browser/browser-console-format.js';
import { applyConsoleOps, type ConsoleBatchOp } from './browser/live-console-bridge.js';
import { attributeNavReport } from './browser/browser-nav-attribution.js';
import type {
  ConsoleEntry,
  NetworkExchange,
  NetworkMessagePayload,
} from './browser/browser-console-types.js';
import { countErrorDigestProblems, sendErrorDigestToComposer } from './browser/error-digest.js';
import {
  DEFAULT_URL,
  HISTORY_LIMIT,
  TAB_LIMIT,
  deriveFaviconUrl,
  deriveTabTitle,
  loadBookmarks,
  loadNativeRenderPreference,
  isWorkspaceStorageReady,
  loadPersistedState,
  loadQualityPresetPreference,
  makeTabId,
  migrateDefaultWorkspaceTabs,
  persistState,
  saveBookmarks,
  saveNativeRenderPreference,
  saveQualityPresetPreference,
  type Bookmark,
  type BrowserTab,
} from './browser/browser-storage.js';
import { resolveQualityPreset } from './browser/quality-presets.js';
import { applyNavigatedUrl } from './browser/browser-tab-nav.js';
import { collectRecentLinks, isStartPageUrl } from './browser/browser-start-page.js';
import { BrowserStartPage } from './browser/BrowserStartPage.js';
import { BrowserShortcutHints } from './browser/browser-shortcut-hints.js';
import { BrowserTabContextMenu } from './browser/BrowserTabContextMenu.js';
import { BrowserToolbar } from './browser/BrowserToolbar.js';
import { InstallBrowserProgress } from './browser/InstallBrowserProgress.js';
import { DEFAULT_DEVICE_PRESET_ID } from './browser/device-presets.js';
import { useEngineCapability } from './browser/hooks/use-engine-capability.js';
import { useBrowserLiveWiring } from './browser/hooks/use-browser-live-wiring.js';
import { useBrowserLiveNavigation } from './browser/hooks/use-browser-live-navigation.js';
import { useBrowserInspector } from './browser/hooks/use-browser-inspector.js';
import { useBrowserPreviewShortcutsWiring } from './browser/hooks/use-browser-preview-shortcuts-wiring.js';
import { useTauriWebview } from './browser/hooks/use-tauri-webview.js';
import { useWorkspaceIndexRefresh } from './browser/hooks/use-workspace-index-refresh.js';
import type { NetworkCaptureStatus } from './browser/NetworkWaterfall.js';

const isTauriEnv = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const OPEN_URL_EVENT = 'openawork:browser:open-url';
/** 每个 tab 控制台保留的最大条目数，超出丢弃最旧的。 */
const CONSOLE_ENTRY_LIMIT = 200;

/** 工具栏徽章用的控制台摘要：面板关闭时唯一的 React 状态出口。 */
interface ConsoleLogCounts {
  error: number;
  warn: number;
  problem: number;
}

const EMPTY_LOG_COUNTS: ConsoleLogCounts = { error: 0, warn: 0, problem: 0 };

/** 只做一次遍历得到三档计数；「问题」口径复用错误摘要（error / 网络失败 / 4xx-5xx）。 */
function summarizeConsoleLogs(logs: readonly ConsoleEntry[]): ConsoleLogCounts {
  let error = 0;
  let warn = 0;
  for (const entry of logs) {
    if (entry.level === 'error') {
      error += 1;
    } else if (entry.level === 'warn') {
      warn += 1;
    }
  }
  return { error, warn, problem: countErrorDigestProblems([...logs]) };
}

/** 摘要相等时保留原对象引用：flush 频率高，避免无意义的 React 调度。 */
function equalLogCounts(left: ConsoleLogCounts, right: ConsoleLogCounts): boolean {
  return left.error === right.error && left.warn === right.warn && left.problem === right.problem;
}

/**
 * 控制台待处理操作。网络请求分三段到达，需要 `upsertNetwork` 把后到的
 * 响应/响应体并进同一行；普通日志与错误则是纯追加。
 *
 * 形状直接复用批处理入口的 `ConsoleBatchOp`，避免两处联合类型各自漂移。
 */
type PendingConsoleOp = ConsoleBatchOp;

interface BuiltInBrowserProps {
  className?: string;
  style?: CSSProperties;
  /** When set, the browser navigates to this URL automatically (e.g. from dev-server detection). */
  previewUrl?: string | null;
  /**
   * 当前工作区作用域,用来按 workspace 隔离 tabs / history / activeTab 的持久化。
   * 跨 workspace 切会话时,sidebar 会传入新的 workspacePath,本组件会重建 tabs 状态。
   *
   * 注意:这是 UI 持久化作用域,无工作目录的会话会落成 `__session__:<id>` 这类非路径
   * 键。索引版本轮询遇到非路径作用域时会交给网关回退到未绑定会话默认工作区。
   */
  workspacePath?: string | null;
  /**
   * When true the browser is kept alive but visually hidden (Tauri webview
   * is moved off-screen; iframe wrapper gets `display:none`).
   */
  hidden?: boolean;
}

/**
 * 优先操作 iframe 内部 history（保留页面 state）；跨域等异常返回 false，交给 React state
 * fallback 改 URL。
 *
 * 必须留在模块级：try 内的 `?.` / `typeof` 都是值块，会让编译器报
 * "Support value blocks … within a try/catch statement" 并放弃优化整个组件（实测）。
 */
function navigateEmbeddedIframeHistory(
  iframe: HTMLIFrameElement | null,
  direction: 'back' | 'forward',
): boolean {
  try {
    const win = iframe?.contentWindow;
    const navigate = direction === 'back' ? win?.history?.back : win?.history?.forward;
    if (win && typeof navigate === 'function') {
      navigate.call(win.history);
      return true;
    }
    return false;
  } catch {
    // 跨域 — 走 fallback
    return false;
  }
}

export function BuiltInBrowser({
  className,
  style,
  previewUrl,
  workspacePath,
  hidden = false,
}: BuiltInBrowserProps) {
  /**
   * SSH 读取身份（与主文件树同源）。
   *
   * 内置浏览器预览的自动刷新靠索引版本轮询，而该轮询遇 400/403 会永久停止 ——
   * 缺身份时远端 POSIX 路径被判本机越界，预览刷新与内容缓存失效广播都会停摆。
   */
  const storeReadIdentity = useWorkspaceReadIdentity();
  const workspaceReadIdentity = useMemo(
    () => ({
      ...(storeReadIdentity.sessionId ? { sessionId: storeReadIdentity.sessionId } : {}),
      ...(!storeReadIdentity.sessionId && storeReadIdentity.sshConnectionId
        ? { sshConnectionId: storeReadIdentity.sshConnectionId }
        : {}),
      ...(workspacePath ? { workspaceRoot: workspacePath } : {}),
    }),
    [storeReadIdentity.sessionId, storeReadIdentity.sshConnectionId, workspacePath],
  );
  // ── Tabs state (with persistence) ───────────────────────────────────
  /**
   * 构造「一个空白/预览标签」的初始状态。
   *
   * 抽出来是因为它在三个地方用：首次初始化、workspace 就绪后的首次加载、
   * 切到一个没有历史的 workspace。
   */
  const createInitialTab = useCallback(
    (initialUrl: string): BrowserTab => ({
      id: makeTabId(),
      url: initialUrl,
      title: deriveTabTitle(initialUrl),
      faviconUrl: deriveFaviconUrl(initialUrl),
      history: [initialUrl],
      historyIndex: 0,
    }),
    [],
  );

  // 初始化:从当前 workspace 的 storage 读取(若有);否则用 previewUrl 或 default。
  //
  // **只在 workspace 已知时读盘**：应用冷启动时 `workspacePath` 常先以 `null` 出现，
  // 此时按 `__default__` 读会读不到真实历史，随后又把「空白新标签」写进真实 key，
  // 把用户的历史覆盖掉——「重启后什么都没有了」就是这么来的。
  // 见 `isWorkspaceStorageReady` 的说明。
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    const ready = isWorkspaceStorageReady(workspacePath);
    if (!ready) return [];
    // 先迁移再读：早期版本可能把历史误写进 `__default__`，迁移必须在首次读盘之前
    // 完成，否则这一帧已经拿着「读不到」的结果建了占位标签。
    migrateDefaultWorkspaceTabs(workspacePath);
    const persisted = loadPersistedState(workspacePath);
    if (persisted) return persisted.tabs as BrowserTab[];
    return [createInitialTab(previewUrl || DEFAULT_URL)];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const ready = isWorkspaceStorageReady(workspacePath);
    const persisted = ready ? loadPersistedState(workspacePath) : null;
    if (persisted && persisted.tabs.find((t) => t.id === persisted.activeTabId)) {
      return persisted.activeTabId;
    }
    return tabs[0]?.id ?? '';
  });

  // 跨 workspace 切换时记录"已经 load 完毕的 workspace"。persist effect 用它判断
  // tabs 是否真已属于当前 workspacePath(避免在 ws-effect 还没替换 tabs 前就把旧
  // workspace 的 tabs 写到新 workspace 的 storage key)。
  const lastLoadedWorkspaceRef = useRef<string | null | undefined>(workspacePath);

  // 持久化(按 workspace key 写)。注意:workspacePath 变化时 ws-effect 会重新 load
  // 并 setTabs,这之前 tabs 还属于旧 workspace,绝不能在这一帧把旧 tabs 写到新 ws key,
  // 否则会污染目标 workspace 的持久化数据。
  //
  // 另外 workspace 未就绪（`null`）时也不写：那时落盘只会写进 `__default__` 或更糟——
  // 把占位标签写进真实桶。
  useEffect(() => {
    if (lastLoadedWorkspaceRef.current !== workspacePath) return;
    if (!isWorkspaceStorageReady(workspacePath)) return;
    if (tabs.length === 0) return;
    persistState(workspacePath, tabs, activeTabId);
  }, [workspacePath, tabs, activeTabId]);

  // 跨设备恢复由 `stores/ui/workspace-state-sync.ts` 统一负责：它在启动时把
  // 「工作台现场」快照（含按工作区的标签、书签、预览地址、面板布局）拉回来并写进
  // localStorage；本组件只负责把当前工作区的标签在内存与 localStorage 之间同步。
  // 两条链路同时写同一份标签会互相覆盖（旧实现正是如此），因此这里不再单独请求服务端。

  // 跨 workspace 切换:重新从 storage 加载该 workspace 的 tabs。
  // 避免上一个 workspace 的 tabs 残留在内存(从而通过持久化覆盖新 workspace 的状态)。
  //
  // 冷启动时 `workspacePath` 会先以 `null` 出现、随后才变成真实路径，因此这里必须
  // **等路径就绪**再加载：`null` 阶段不做任何事，避免把占位标签写进真实桶（见
  // `isWorkspaceStorageReady`）。就绪的那一刻顺带迁移早期误写进 `__default__` 的
  // 历史标签，让「重启后没了」的数据有机会回来。
  useEffect(() => {
    if (lastLoadedWorkspaceRef.current === workspacePath) return;
    if (!isWorkspaceStorageReady(workspacePath)) return;
    lastLoadedWorkspaceRef.current = workspacePath;
    migrateDefaultWorkspaceTabs(workspacePath);
    const persisted = loadPersistedState(workspacePath);
    if (persisted) {
      setTabs(persisted.tabs as BrowserTab[]);
      const validActive = persisted.tabs.find((t) => t.id === persisted.activeTabId)
        ? persisted.activeTabId
        : (persisted.tabs[0]?.id ?? makeTabId());
      setActiveTabId(validActive);
    } else {
      // 该 workspace 还没有 tabs:用 previewUrl 或默认 url 重建一个新 tab。
      const fresh = createInitialTab(previewUrl || DEFAULT_URL);
      setTabs([fresh]);
      setActiveTabId(fresh.id);
    }
  }, [workspacePath, previewUrl, createInitialTab]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );

  // 地址栏输入(每个 tab 独立)
  //
  // 占位页显示空值而不是 `about:blank`：新标签页里给用户看一个内部协议名既没有
  // 信息量，也和「开始页」的输入体验割裂。占位判定与开始页共用 `isStartPageUrl`。
  const [addressInput, setAddressInput] = useState<string>(() => {
    const initialUrl = activeTab?.url ?? DEFAULT_URL;
    return isStartPageUrl(initialUrl) ? '' : initialUrl;
  });
  useEffect(() => {
    const nextUrl = activeTab?.url ?? DEFAULT_URL;
    setAddressInput(isStartPageUrl(nextUrl) ? '' : nextUrl);
  }, [activeTabId, activeTab?.url]);

  const activeUrl = activeTab?.url ?? DEFAULT_URL;
  /** 占位地址（新标签页）：内容区由开始页顶替，而不是一块白板。 */
  const showStartPage = isStartPageUrl(activeUrl);
  /** 开始页的「最近访问」入口：从所有标签的历史派生，占位页 / 非 http(s) 已过滤。 */
  const recentLinks = useMemo(() => collectRecentLinks(tabs), [tabs]);

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

  // goBack / goForward 定义在 `liveWiring` 之后（实时分支要下发 CDP 历史指令）。

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
          const freshTab: BrowserTab = {
            id: makeTabId(),
            url: DEFAULT_URL,
            title: deriveTabTitle(DEFAULT_URL),
            faviconUrl: deriveFaviconUrl(DEFAULT_URL),
            history: [DEFAULT_URL],
            historyIndex: 0,
          };
          // 必须把激活标签同步到新 tab：`activeTabId` 留在已删除的 id 上时，
          // iframe 的 key（含 `activeTabId`）不变 → 旧文档不会被卸载，页面里的
          // 音视频继续播，用户看到的就是「标签都关了，内容还在放」。
          setActiveTabId(freshTab.id);
          return [freshTab];
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

  /** 标签右键菜单：只保留命中的标签，其余全部关闭。 */
  const closeOtherTabs = useCallback((tabId: string) => {
    setTabs((prev) => {
      const kept = prev.find((tab) => tab.id === tabId);
      if (!kept || prev.length <= 1) {
        return prev;
      }
      setActiveTabId(kept.id);
      return [kept];
    });
  }, []);

  /** 标签右键菜单：关闭命中标签右侧的全部标签。 */
  const closeTabsToRight = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((tab) => tab.id === tabId);
        if (index < 0 || index >= prev.length - 1) {
          return prev;
        }
        const next = prev.slice(0, index + 1);
        // 被关掉的可能是当前激活标签：回落到命中的标签，避免 iframe 仍指向已删除的 tab。
        if (!next.some((tab) => tab.id === activeTabId)) {
          setActiveTabId(tabId);
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

  // 标签栏右键菜单：坐标来自 contextmenu 事件，菜单本体 portal 到 body（tab bar 会裁剪内联菜单）。
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const tabMenuIndex = tabMenu ? tabs.findIndex((tab) => tab.id === tabMenu.tabId) : -1;

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
  //
  // 日志的**唯一真相**是 `consoleBufferByTabRef`：控制台面板关闭时，采集（iframe
  // 注入 + 网关 CDP）依然在源源上报，真实页面一次加载就会产生上百条 console /
  // network 事件。若每批（80ms）都写进 React 状态，整个浏览器 UI 会以 12 次/秒的
  // 节奏重渲染，直接和实时画面绘制、点击反馈抢主线程——表现就是「画面掉帧、点了
  // 要等一下才有反应」。
  //
  // 因此面板关闭时日志只进 ref，React 仅保留工具栏徽章所需的「错误 / 警告 / 问题
  // 条数」这一份轻量摘要；打开面板时再把缓冲整体回填一次。
  const [consoleOpen, setConsoleOpen] = useState(false);
  const consoleOpenRef = useRef(false);
  const [consoleLogsByTab, setConsoleLogsByTab] = useState<Record<string, ConsoleEntry[]>>({});
  /** 采集侧权威缓冲（含面板关闭期间的日志）；只在 flush / 打开面板时读。 */
  const consoleBufferByTabRef = useRef<Record<string, ConsoleEntry[]>>({});
  const [logCounts, setLogCounts] = useState<ConsoleLogCounts>(EMPTY_LOG_COUNTS);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeTabIdRef = useRef(activeTabId);
  // 同步刻意放进 effect：渲染期写 ref 会被 React Compiler 判定为
  // "Cannot access refs during render" 而放弃优化本组件。读取点全在异步路径
  // （iframe message / 网络上报 flush），effect 必先于它们执行。
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  /** 当前激活标签的地址：`nav` 归属判定要读它，同样只能走 effect 同步。 */
  const activeTabUrlRef = useRef(activeUrl);
  /** 其它标签的地址集合：用于识别「这条 nav 是别的标签的回报」。 */
  const otherTabUrlsRef = useRef<readonly string[]>([]);
  /** 当前标签已接受的导航代次：更旧的回报一律丢弃。 */
  const acceptedNavGenerationRef = useRef<number | null>(null);
  useEffect(() => {
    activeTabUrlRef.current = activeUrl;
    otherTabUrlsRef.current = tabs.filter((tab) => tab.id !== activeTabId).map((tab) => tab.url);
  }, [activeUrl, activeTabId, tabs]);
  // 切标签就是「换了一个页面实例」：上一轮页面的代次与当前标签无关，必须复位，
  // 否则新标签的首条 nav（代次往往更小）会被当成迟到回报丢掉，地址栏永远不更新。
  useEffect(() => {
    acceptedNavGenerationRef.current = null;
  }, [activeTabId]);
  useEffect(() => {
    consoleOpenRef.current = consoleOpen;
  }, [consoleOpen]);
  // 标记"上一次 url 更新来自 iframe 内部 navigate",webview lifecycle 据此跳过重建。
  const internalNavRef = useRef<{ tabId: string; url: string } | null>(null);

  const consoleLogs = consoleLogsByTab[activeTabId] ?? [];

  // 打开面板：把关闭期间累积的缓冲整体回填（面板只在打开时渲染，提前同步没有意义）。
  useEffect(() => {
    if (!consoleOpen) return;
    setConsoleLogsByTab(consoleBufferByTabRef.current);
  }, [consoleOpen]);

  // 切 tab 时徽章数字必须跟着切到该 tab 的缓冲；值相同则保持引用，避免空转渲染。
  useEffect(() => {
    const nextCounts = summarizeConsoleLogs(consoleBufferByTabRef.current[activeTabId] ?? []);
    setLogCounts((previous) => (equalLogCounts(previous, nextCounts) ? previous : nextCounts));
  }, [activeTabId]);

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
      // 整批一次归并：逐条调用会让「操作数 × 表长」的主线程搬运量在首屏日志洪峰时
      // 涨到几十万次，直接和画面解码抢 CPU（见 `applyConsoleOps` 的说明）。
      const next = applyConsoleOps(consoleBufferByTabRef.current, queued, {
        now: Date.now(),
        limit: CONSOLE_ENTRY_LIMIT,
      });
      consoleBufferByTabRef.current = next;

      // 关闭状态下只有徽章数字需要进 React；数字没变就保持原引用，不触发任何渲染。
      const activeLogs = next[activeTabIdRef.current] ?? [];
      const nextCounts = summarizeConsoleLogs(activeLogs);
      setLogCounts((previous) => (equalLogCounts(previous, nextCounts) ? previous : nextCounts));

      // 面板打开时同步全量日志；关闭时留在缓冲里，等下一次打开再整体回填。
      if (consoleOpenRef.current) {
        setConsoleLogsByTab(next);
      }
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
          prev.map((t) => (t.id === tid ? applyNavigatedUrl(t, nextUrl, nextTitle) : t)),
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

  // 关闭某个 tab 时,顺便清掉它的日志缓存(避免内存泄露)。缓冲是唯一真相，
  // 面板打开时再把裁剪后的结果同步进 React 状态。
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id));
    const previous = consoleBufferByTabRef.current;
    const leftover = Object.keys(previous).filter((id) => !tabIds.has(id));
    // 纯导航（tabs 里的 url/title 变化）不涉及关闭，直接跳过，避免白白重渲染。
    if (leftover.length === 0) return;
    const next: Record<string, ConsoleEntry[]> = { ...previous };
    for (const id of leftover) {
      delete next[id];
    }
    consoleBufferByTabRef.current = next;
    if (consoleOpenRef.current) {
      setConsoleLogsByTab(next);
    }
    const nextCounts = summarizeConsoleLogs(next[activeTabIdRef.current] ?? []);
    setLogCounts((current) => (equalLogCounts(current, nextCounts) ? current : nextCounts));
  }, [tabs]);

  // 清空当前 tab 的日志
  const clearActiveTabConsole = useCallback(() => {
    const next: Record<string, ConsoleEntry[]> = {
      ...consoleBufferByTabRef.current,
      [activeTabIdRef.current]: [],
    };
    consoleBufferByTabRef.current = next;
    setConsoleLogsByTab(next);
    setLogCounts(EMPTY_LOG_COUNTS);
  }, []);

  const [isTauri] = useState(isTauriEnv);
  /**
   * 渲染模式：
   * - `false`：CDP 实时画面，地址 / 拾取 / 设备模拟全部可用，但每帧要经编码 → 传输
   *   → 解码，帧率受链路限制；
   * - `true`：原生 iframe 渲染，浏览器自己合成（60fps、输入零额外延迟），代价是
   *   跨域页面的地址栏无法自动同步（浏览器不允许读取跨域 iframe 的 location）。
   */
  const [nativeRender, setNativeRender] = useState<boolean>(loadNativeRenderPreference);
  const setNativeRenderMode = useCallback((value: boolean) => {
    saveNativeRenderPreference(value);
    setNativeRender(value);
  }, []);
  /**
   * 实时画面画质档位（流畅 / 均衡 / 清晰 / 无损）：决定帧盒倍数与编码格式。
   * 只对 CDP 实时画面生效——Tauri 原生 webview 与 iframe 由浏览器自己合成，改它没有意义。
   */
  const [qualityPresetId, setQualityPresetId] = useState<string>(
    () => resolveQualityPreset(loadQualityPresetPreference()).id,
  );
  const setQualityPreset = useCallback((nextId: string) => {
    const normalized = resolveQualityPreset(nextId).id;
    saveQualityPresetPreference(normalized);
    setQualityPresetId(normalized);
  }, []);
  const [pickArmed, setPickArmed] = useState(false);
  // 拾取意图：工具栏与检查器的「在页面中拾取」都下发 `pick`（结果进 composer），
  // 检查器的「获取完整样式」则下发 `node.styles`（只读样式，不写 composer）。
  const [pickIntent, setPickIntent] = useState<'composer' | 'styles'>('composer');
  /**
   * 页面代次门槛（控制台 / 网络 / 画面三处共用同一份）。
   *
   * 三类事件都会在快速切标签时「晚到」：旧页面的日志、请求、帧可能在新导航之后才
   * 到达。统一按网关回报的精确代次过滤，晚到的旧事件一律丢弃——否则它们会被记到
   * 当前激活标签上，表现为「新标签里冒出上一个页面的日志」。
   */
  const minGenerationRef = useRef<number | null>(null);

  // 实时引擎接线（可用性 + 事件 → 既有控制台状态）。Tauri 原生窗口同样接入：
  // 画面仍是系统 webview，控制台 / 网络由网关侧 CDP 采集（见
  // `useBrowserLiveNavigation` 的导航同步）。
  const liveWiring = useBrowserLiveWiring({
    appendLog: appendLogToActiveTab,
    upsertNetwork: upsertNetworkExchange,
    minGenerationRef,
  });
  // 网关状态里与实时能力有关的两个布尔值只在这里派生一次；能力矩阵与各面板
  // 统一消费它们，避免「可用性判断」散落在多个 JSX 表达式里各自漂移。
  const liveAvailability = liveWiring.availability;
  const liveEngineAvailable = liveAvailability?.available === true;
  const liveScreencastAvailable = liveAvailability?.screencast === true;
  const liveUnavailable = liveAvailability !== null && liveAvailability.available === false;
  // 本文件未被 React Compiler 接管（`check:react-compiler` 实测 compiled 0 / bailout 1，
  // 原因是对比的 try/catch，属编译器能力缺口），因此下面这几个引用稳定化只能手写：
  // 它们一路透传到 `BrowserConsolePanel`（memo 组件），引用一变面板就整片重刷。
  const armPickForStyles = useCallback(() => {
    setPickIntent('styles');
    setPickArmed(true);
  }, []);
  // 元素检查器：与控制台共用同一条实时通道（订阅是扇出的，不新开连接）。
  const inspector = useBrowserInspector({
    session: liveWiring.session,
    enabled: !isTauri,
    armPickForStyles,
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
  /** 实时画面是否真的接管内容区（能力可用 **且** 用户没切到原生渲染）。 */
  const liveRendering = engineCapability.liveView && !nativeRender;
  const liveSession = liveWiring.session;
  const liveSubscribe = liveSession.subscribe;

  // CDP 实时分支的导航同步：页面跑在网关侧 Chromium 里，前端**没有 iframe** 可读，
  // 所以「点击链接 / 页面内跳转 / 网关侧重定向 / 后退前进」只能靠 `nav` 事件写回
  // 标签。不消费它，地址栏、持久化、后退前进按钮与收藏会一直停在旧地址上。
  useEffect(() => {
    return liveSubscribe((envelope) => {
      if (envelope.ch !== 'nav') return;
      const payload = envelope.payload as
        { url?: unknown; title?: unknown; generation?: unknown } | null | undefined;
      if (payload === null || payload === undefined) return;
      const nextUrl = typeof payload.url === 'string' ? payload.url : '';
      if (nextUrl.length === 0) return;
      const nextTitle = typeof payload.title === 'string' ? payload.title : '';
      const tid = activeTabIdRef.current;

      // 归属判定：`nav` 是延迟回报（网关要等主文档提交 + 150ms settle + 读 title），
      // 用户在这个窗口里切标签，旧标签的回报就会晚于切换到达。无条件写回激活标签时，
      // 表现就是「切回空白标签，它被替换成上一个标签的地址」。
      const verdict = attributeNavReport(
        {
          url: nextUrl,
          ...(typeof payload.generation === 'number' ? { generation: payload.generation } : {}),
        },
        {
          activeUrl: activeTabUrlRef.current,
          otherTabUrls: otherTabUrlsRef.current,
          acceptedGeneration: acceptedNavGenerationRef.current,
        },
      );
      if (!verdict.accept) return;
      if (verdict.generation !== null) {
        acceptedNavGenerationRef.current = verdict.generation;
      }

      // 标记"这是来自远端页面的同步信号"，webview lifecycle 据此跳过重建。
      internalNavRef.current = { tabId: tid, url: nextUrl };
      setTabs((prev) =>
        prev.map((t) => (t.id === tid ? applyNavigatedUrl(t, nextUrl, nextTitle) : t)),
      );
    });
  }, [liveSubscribe]);

  /** 最近一次前端记录的地址：兜底判定「CDP 指令到底有没有生效」。 */
  const activeUrlRef = useRef(activeUrl);
  useEffect(() => {
    activeUrlRef.current = activeUrl;
  }, [activeUrl]);

  const historyFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (historyFallbackTimerRef.current !== null) {
        clearTimeout(historyFallbackTimerRef.current);
        historyFallbackTimerRef.current = null;
      }
    },
    [],
  );

  /** 纯前端历史回退：CDP 无能为力时至少让按钮有反应（整页重载）。 */
  const navigateHistoryFallback = useCallback(
    (direction: 'back' | 'forward') => {
      updateActiveTab((tab) => {
        const nextIndex = direction === 'back' ? tab.historyIndex - 1 : tab.historyIndex + 1;
        if (nextIndex < 0 || nextIndex >= tab.history.length) return tab;
        const nextUrl = tab.history[nextIndex] ?? tab.url;
        return {
          ...tab,
          url: nextUrl,
          title: deriveTabTitle(nextUrl),
          faviconUrl: deriveFaviconUrl(nextUrl),
          historyIndex: nextIndex,
        };
      });
    },
    [updateActiveTab],
  );

  /** 实时分支：先下发 CDP 历史；网关不支持 / 无历史时退回前端历史，避免「点了没反应」。 */
  const requestLiveHistory = useCallback(
    (direction: 'back' | 'forward') => {
      const before = activeUrlRef.current;
      liveSession.send({ ch: 'control', action: direction === 'back' ? 'goBack' : 'goForward' });
      if (historyFallbackTimerRef.current !== null) {
        clearTimeout(historyFallbackTimerRef.current);
      }
      historyFallbackTimerRef.current = setTimeout(() => {
        historyFallbackTimerRef.current = null;
        if (activeUrlRef.current === before) {
          navigateHistoryFallback(direction);
        }
      }, 700);
    },
    [liveSession, navigateHistoryFallback],
  );

  const goBack = useCallback(() => {
    // 实时分支没有 iframe：页面历史在网关侧，必须走 CDP（保留 SPA state）。
    if (liveRendering) {
      requestLiveHistory('back');
      return;
    }
    // 优先操作 iframe 内部 history(保留页面 state),失败时 fallback 到 React state 改 URL。
    // iframe 访问（含跨域 try/catch 与值块）下沉到模块级 `navigateEmbeddedIframeHistory`。
    if (navigateEmbeddedIframeHistory(iframeRef.current, 'back')) {
      return;
    }
    navigateHistoryFallback('back');
  }, [liveRendering, navigateHistoryFallback, requestLiveHistory]);

  const goForward = useCallback(() => {
    if (liveRendering) {
      requestLiveHistory('forward');
      return;
    }
    if (navigateEmbeddedIframeHistory(iframeRef.current, 'forward')) {
      return;
    }
    navigateHistoryFallback('forward');
  }, [liveRendering, navigateHistoryFallback, requestLiveHistory]);

  // 实时分支的历史在网关侧，前端的 history 只是同步副本（可能还没收到 nav 事件）：
  // 不能据此把按钮禁用，否则用户看到的永远是点了没反应的灰按钮。
  const canGoBack = liveRendering || (activeTab?.historyIndex ?? 0) > 0;
  const canGoForward = liveRendering
    ? true
    : activeTab !== undefined && activeTab.historyIndex < activeTab.history.length - 1;
  // 设备预览（预设视口 + 纯前端缩放）：CDP 实时与 iframe 回退共用，Tauri 原生 webview 不参与。
  const [devicePresetId, setDevicePresetId] = useState<string>(DEFAULT_DEVICE_PRESET_ID);
  const [zoom, setZoom] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  // 工作区文件变化（Agent 写盘 / 用户保存）时，通过既有的 refreshKey 机制强制重载预览。
  useWorkspaceIndexRefresh({
    enabled: !hidden && Boolean(workspacePath),
    workspacePath: workspacePath ?? null,
    onChange: () => setRefreshKey((value) => value + 1),
    // SSH 远端工作区必须下发身份：该 hook 遇 400/403 会 stop() 永久停轮询，
    // 缺身份时远端路径被判本机越界 → 预览自动刷新永久失效。
    readIdentity: workspaceReadIdentity,
  });
  // Tauri 原生窗口没有 `CdpLiveEngine` 来同步 URL：由这个 hook 把当前标签页的
  // 地址 / 刷新信号下发给远端采集页面，否则采集到的永远是空白页。不可见时不下发
  // （不为没人在看的预览白白拉起采集页面），重新可见时补发。
  useBrowserLiveNavigation({
    session: liveWiring.session,
    // 原生渲染时画面由 iframe 自己加载，但网关侧页面仍要跟随 URL：控制台 / 网络
    // 采集与元素拾取都跑在网关侧那份页面上。
    enabled: (isTauri || nativeRender) && !hidden,
    url: activeUrl,
    refreshKey,
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

  // 刷新反馈：静态页面重载后画面一模一样，用户无法判断「到底刷没刷」。点击后给
  // 图标一段短暂旋转，明确表达动作已生效（真实重载仍走 refreshKey / CDP reload）。
  const [refreshing, setRefreshing] = useState(false);
  const refreshFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshFeedbackTimerRef.current !== null) {
        clearTimeout(refreshFeedbackTimerRef.current);
        refreshFeedbackTimerRef.current = null;
      }
    },
    [],
  );
  const handleRefresh = useCallback(() => {
    previewShortcuts.reload();
    setRefreshing(true);
    if (refreshFeedbackTimerRef.current !== null) {
      clearTimeout(refreshFeedbackTimerRef.current);
    }
    refreshFeedbackTimerRef.current = setTimeout(() => {
      refreshFeedbackTimerRef.current = null;
      setRefreshing(false);
    }, 600);
  }, [previewShortcuts.reload]);

  const generationRef = useRef(0);
  const { webviewReady, webviewError } = useTauriWebview({
    isTauri,
    // 开始页不创建原生表面：它永远盖在 HTML 之上，会连开始页一起挡掉。
    enabled: !showStartPage,
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

  // 摘要从缓冲读：面板关闭时 `consoleLogs` 不会跟随采集更新，读它会把过期内容发出去。
  const handleSendProblems = useCallback(() => {
    sendErrorDigestToComposer(consoleBufferByTabRef.current[activeTabIdRef.current] ?? [], {
      url: activeUrl,
      title: activeTab?.title ?? null,
    });
  }, [activeUrl, activeTab]);

  const { error: errorCount, warn: warnCount, problem: problemCount } = logCounts;

  // 网络瀑布视图的空态文案据此区分：引擎声明不可用 → 未开始录制；建连中 → 骨架屏。
  // Tauri 原生窗口与 Web 模式共用同一条采集通道，判定不再按平台分叉。
  const livePhase = liveWiring.session.phase;
  const networkCaptureStatus: NetworkCaptureStatus = liveUnavailable
    ? 'unavailable'
    : livePhase === 'connecting' || livePhase === 'reconnecting'
      ? 'loading'
      : 'ready';

  const closeConsole = useCallback(() => setConsoleOpen(false), []);
  // 检查器视图的 props 同理：每次渲染新建对象会让 `BrowserConsolePanel` 的 memo 整片失效。
  // 本文件未被编译器接管，只能手工稳定；依赖里都是原始值或上面已稳定的引用。
  const inspectorProps = useMemo<BrowserInspectorPanelProps>(
    () => ({
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
    }),
    [
      inspector.dom,
      inspector.a11y,
      inspector.node,
      inspector.domStatus,
      inspector.a11yStatus,
      inspector.nodeStatus,
      inspector.errorMessage,
      inspector.requestDom,
      inspector.requestA11y,
      inspector.requestFullStyles,
      isTauri,
      liveUnavailable,
      liveWiring.unavailableHint,
      pickArmed,
      armPickForComposer,
      disarmPick,
    ],
  );

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        // `height: 100%` 只在宿主高度可解析时生效（块级父容器 / 显式高度）。
        // 停靠面板这类 flex 宿主的高度可能从 `min-height` 派生，百分比会解析成
        // auto——此时组件按内容收缩（chrome 145px），内容区被压成 0，画面整块消失。
        // `flex: 1 1 auto` 保证在 flex 宿主里吃掉剩余高度，`minHeight: 0` 允许收缩。
        flex: '1 1 auto',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
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
        onTabContextMenu={(tabId, x, y) => setTabMenu({ tabId, x, y })}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        nativeRender={nativeRender}
        onToggleNativeRender={
          // 只有实时引擎可用时切换才有意义（Tauri 原生 webview 本来就是原生渲染）。
          engineCapability.liveView ? () => setNativeRenderMode(!nativeRender) : undefined
        }
        addressInput={addressInput}
        onAddressChange={setAddressInput}
        onAddressKeyDown={handleKeyDown}
        isCurrentBookmarked={isCurrentBookmarked}
        bookmarkDisabled={showStartPage}
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
        qualityPresetId={qualityPresetId}
        onQualityPresetChange={setQualityPreset}
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
          <InstallBrowserProgress controller={liveWiring.install} />
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
        frameScopeKey={workspacePath ?? ''}
        hidden={hidden}
        appendLogToActiveTab={appendLogToActiveTab}
        consoleOpen={consoleOpen}
        onRefreshRequested={previewShortcuts.reload}
        liveActive={liveRendering}
        liveSession={liveWiring.session}
        liveAvailable={liveEngineAvailable}
        pickArmed={pickArmed}
        onPickConsumed={disarmPick}
        onPickCancel={disarmPick}
        pickIntent={pickIntent}
        onPickPoint={inspector.recordPickPoint}
        devicePresetId={devicePresetId}
        qualityPresetId={qualityPresetId}
        zoom={zoom}
        onRequestNativeRender={() => setNativeRenderMode(true)}
        minGenerationRef={minGenerationRef}
        startPage={
          showStartPage ? (
            <BrowserStartPage
              onNavigate={handleNavigate}
              bookmarks={bookmarks}
              recentLinks={recentLinks}
              previewUrl={previewUrl ?? null}
            />
          ) : undefined
        }
      />

      {consoleOpen && (
        <BrowserConsolePanel
          logs={consoleLogs}
          endRef={consoleEndRef}
          onClear={clearActiveTabConsole}
          onClose={closeConsole}
          tauriMode={isTauri}
          liveAvailable={liveEngineAvailable}
          pageUrl={activeUrl}
          pageTitle={activeTab?.title ?? null}
          networkCaptureStatus={networkCaptureStatus}
          inspector={inspectorProps}
        />
      )}

      {tabMenu && tabMenuIndex >= 0 ? (
        <BrowserTabContextMenu
          active={tabMenu.tabId === activeTabId}
          index={tabMenuIndex}
          tabCount={tabs.length}
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          onReload={previewShortcuts.reload}
          onCopyUrl={() => {
            const target = tabs.find((tab) => tab.id === tabMenu.tabId);
            if (target) void copyTextToClipboard(target.url);
          }}
          onCloseTab={() => closeTab(tabMenu.tabId)}
          onCloseOtherTabs={() => closeOtherTabs(tabMenu.tabId)}
          onCloseTabsToRight={() => closeTabsToRight(tabMenu.tabId)}
        />
      ) : null}
    </div>
  );
}
