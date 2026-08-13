import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Throttled localStorage adapter for the persist middleware.
 *
 * The persist middleware writes to storage on every `set()` call.
 * For high-frequency UI state (active file tab clicks, file tree
 * expand/collapse, sidebar toggle bursts) this means JSON.stringify
 * of the entire ~75-field state plus a synchronous localStorage.setItem
 * on every interaction — the source of `[Violation] 'click' handler
 * took XYZms` warnings on tab switches and similar.
 *
 * Strategy:
 *   - getItem / removeItem are synchronous pass-through (rare and
 *     ok-to-be-eager on the boot path).
 *   - setItem coalesces multiple writes per FLUSH_DELAY_MS window
 *     into one. The most recent value wins.
 *   - Pending write is flushed synchronously on `pagehide` /
 *     `beforeunload` so a fast click → close doesn't lose state.
 */
const FLUSH_DELAY_MS = 200;
let pendingKey: string | null = null;
let pendingValue: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPending(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingKey !== null && pendingValue !== null) {
    try {
      window.localStorage.setItem(pendingKey, pendingValue);
    } catch {
      /* quota / SecurityError — surface in console only */
    }
  }
  pendingKey = null;
  pendingValue = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPending);
  window.addEventListener('beforeunload', flushPending);
}

const throttledStorage = createJSONStorage(() => ({
  getItem: (name: string): string | null => {
    if (pendingKey === name && pendingValue !== null) return pendingValue;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    pendingKey = name;
    pendingValue = value;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPending, FLUSH_DELAY_MS);
  },
  removeItem: (name: string): void => {
    if (pendingKey === name) {
      pendingKey = null;
      pendingValue = null;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
}));

export type ChatView = 'home' | 'session';
export type SessionTabType = 'session' | 'draft';
export type WorkbenchLayoutMode = 'classic' | 'fusion';

export interface SessionTab {
  readonly id: string;
  readonly type: SessionTabType;
  readonly sessionId?: string;
  readonly title: string;
  readonly workspacePath?: string;
  readonly createdAt: number;
  readonly streaming?: boolean;
}

export interface UIStateStore {
  // Sidebar
  leftSidebarOpen: boolean;
  setLeftSidebarOpen: (v: boolean) => void;
  toggleLeftSidebar: () => void;

  /**
   * Whether the left navigation rail is in its expanded (icon + label) state.
   * `null` means "follow the viewport default" — the rail auto-expands on
   * wide screens (≥1920px) and collapses below. Once the user clicks the
   * toggle, this is pinned to an explicit boolean and persists across
   * sessions.
   */
  navRailExpanded: boolean | null;
  setNavRailExpanded: (v: boolean | null) => void;
  toggleNavRailExpanded: (viewportDefault: boolean) => void;

  sidebarTab: 'sessions' | 'files';
  setSidebarTab: (tab: 'sessions' | 'files') => void;
  sidebarViewMode: 'sessions' | 'files' | 'search';
  setSidebarViewMode: (mode: 'sessions' | 'files' | 'search') => void;
  sidebarPanelWidth: number;
  setSidebarPanelWidth: (width: number) => void;
  sidebarPanelOpened: boolean;
  setSidebarPanelOpened: (opened: boolean) => void;
  toggleSidebarPanelOpened: () => void;

  /** Team 编辑器分屏位置(百分比 20-80) */
  teamSplitPos: number;
  setTeamSplitPos: (pos: number) => void;
  /** Team 编辑器渲染模式 */
  teamEditorMode: 'overlay' | 'split';
  setTeamEditorMode: (mode: 'overlay' | 'split') => void;

  // Chat view
  workbenchLayoutMode: WorkbenchLayoutMode;
  setWorkbenchLayoutMode: (mode: WorkbenchLayoutMode) => void;
  chatView: ChatView;
  setChatView: (v: ChatView) => void;
  navigateToHome: () => void;
  navigateToSession: () => void;
  lastChatPath: string | null;
  setLastChatPath: (path: string | null) => void;
  tabs: SessionTab[];
  activeTabId: string | null;
  addSessionTab: (sessionId: string, title: string, workspacePath?: string) => string;
  addDraftTab: (workspacePath?: string) => string;
  closeTab: (tabId: string) => SessionTab | null;
  selectTab: (tabId: string) => SessionTab | null;
  selectAdjacentTab: (direction: 'previous' | 'next') => SessionTab | null;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  updateTabStreaming: (sessionId: string, streaming: boolean) => void;

  teamNewSessionSignal: { teamWorkspaceId: string; nonce: number } | null;
  triggerTeamNewSession: (teamWorkspaceId: string) => void;
  consumeTeamNewSessionSignal: () => void;

  teamNewWorkspaceSignal: { nonce: number } | null;
  triggerTeamNewWorkspace: () => void;
  consumeTeamNewWorkspaceSignal: () => void;

  teamSelectSessionSignal: { teamWorkspaceId: string; sessionId: string; nonce: number } | null;
  triggerTeamSelectSession: (teamWorkspaceId: string, sessionId: string) => void;
  consumeTeamSelectSessionSignal: () => void;
  activeTeamSessionId: string | null;
  setActiveTeamSessionId: (id: string | null) => void;

  /** 点击导航图标时回到欢迎页面的信号（Chat / Team 共用）。 */
  resetToWelcomeSignal: { route: 'chat' | 'team'; nonce: number } | null;
  triggerResetToWelcome: (route: 'chat' | 'team') => void;
  consumeResetToWelcomeSignal: () => void;

  // Pinned sessions (frontend-only)
  pinnedSessions: string[];
  togglePinSession: (id: string) => void;
  isPinned: (id: string) => boolean;

  // File tree
  expandedDirs: string[];
  setExpandedDirs: (dirs: string[]) => void;

  fileTreeRootPath: string | null;
  setFileTreeRootPath: (path: string | null) => void;
  workspaceTreeVersion: number;
  bumpWorkspaceTreeVersion: () => void;
  savedWorkspacePaths: string[];
  addSavedWorkspacePath: (path: string) => void;
  mergeSavedWorkspacePaths: (paths: readonly string[]) => void;
  removeSavedWorkspacePath: (path: string) => void;
  selectedWorkspacePath: string | null;
  setSelectedWorkspacePath: (path: string | null) => void;
  activeSessionWorkspace: {
    sessionId: string;
    path: string | null;
    version: number;
  } | null;
  setActiveSessionWorkspace: (sessionId: string, path: string | null) => void;
  clearActiveSessionWorkspace: (sessionId?: string) => void;

  /**
   * P3-PATH: when on, the sessions sidebar list is scoped to the
   * `selectedWorkspacePath` (or, when none is selected, to the
   * active chat session's workspace) via the `path=` query param
   * supported by `/sessions`. Off by default — the existing
   * workspace-grouping UI already covers the bulk of users.
   */
  sessionListPathFilterEnabled: boolean;
  setSessionListPathFilterEnabled: (v: boolean) => void;

  /**
   * P3-PATH (T-PATH-04): admin-style global kill switch for the
   * `/sessions?path=` query. When `false`, the sidebar toggle is
   * hidden entirely and the per-call `path` filter is dropped, even
   * when `sessionListPathFilterEnabled` is `true`. Defaults to
   * `true` so existing users keep the feature.
   */
  sessionListPathFilterFeatureEnabled: boolean;
  setSessionListPathFilterFeatureEnabled: (v: boolean) => void;

  /**
   * `/sessions` 页左侧列表栏宽度(像素)。可拖拽调整,持久化。范围 [260, 520]。
   */
  sessionsListPaneWidth: number;
  setSessionsListPaneWidth: (width: number) => void;

  /**
   * `/sessions` 页折叠的工作区分组 key 集合(`getWorkspaceGroupKey` 输出)。
   * 默认全部展开;用户折叠后会持久化,刷新后保持。
   */
  sessionsCollapsedWorkspaceGroups: string[];
  toggleSessionsCollapsedWorkspaceGroup: (groupKey: string) => void;
  setSessionsCollapsedWorkspaceGroups: (groupKeys: string[]) => void;

  /**
   * `/sessions` 页用于隔离展示「个人对话」与「团队对话」两类来源:
   *   - `scopeFilter` 控制顶部 scope tab 当前选择(`all` / `personal` / `team`)。
   *   - `collapsedScopes` 记录用户主动折叠掉的 scope 标题区(`personal` / `team`)。
   * 仅 UI 状态,持久化保留用户选择。
   */
  sessionsScopeFilter: 'all' | 'personal' | 'team';
  setSessionsScopeFilter: (scope: 'all' | 'personal' | 'team') => void;
  sessionsCollapsedScopes: Array<'personal' | 'team'>;
  toggleSessionsCollapsedScope: (scope: 'personal' | 'team') => void;

  // Editor mode
  editorMode: boolean;
  setEditorMode: (v: boolean) => void;

  /**
   * 编辑器/浏览器工作区是否占据整个内容区域(全屏模式)。
   * 与 `editorMode` 配合:`editorMode` 决定编辑器面板是否可见(分屏),
   * `editorFullScreen` 进一步让该面板铺满整个内容区、收起对话列与右侧面板。
   * 全局持久化,刷新后保持用户上次的视图选择。
   */
  editorFullScreen: boolean;
  setEditorFullScreen: (v: boolean) => void;

  splitPos: number;
  setSplitPos: (v: number) => void;

  /**
   * 按 workspace 路径记忆每个工作区打开的文件列表 + 当前激活文件,跨 workspace 切换
   * 时各自互不干扰。无 workspace 时归入 __default__ 桶。
   */
  openFilePathsByWorkspace: Record<string, string[]>;
  activeFilePathByWorkspace: Record<string, string | null>;
  setOpenFilePathsForWorkspace: (workspacePath: string | null, paths: string[]) => void;
  setActiveFilePathForWorkspace: (workspacePath: string | null, path: string | null) => void;

  // Editor pane right-tab (code / browser)— 按 workspace 持久化,跨 workspace
  // 切换时各自互不影响;无 workspace 时归入 __default__ 桶。
  editorPaneTabByWorkspace: Record<string, 'code' | 'browser'>;
  setEditorPaneTabForWorkspace: (workspacePath: string | null, tab: 'code' | 'browser') => void;

  // 内置浏览器最近访问的 URL(从 dev-server detect / 用户主动打开 / chat 命令进来),
  // 刷新后用此值重新挂载 BuiltInBrowser,让它从持久化 tabs 列表中加载
  browserPreviewUrl: string | null;
  setBrowserPreviewUrl: (url: string | null) => void;
  /** 浏览器面板当前是否激活(用户曾打开过浏览器),刷新后保持挂载 */
  browserActive: boolean;
  setBrowserActive: (v: boolean) => void;
  /**
   * 按 workspace 路径记忆每个工作区的 browser 预览 URL,切到该 workspace 下的任意
   * 会话时自动恢复;跨 workspace 切换时自动切到新 workspace 的 url(若无则为 null)。
   * 同一 workspace 下的多会话共享一个 url(浏览器属于工作区维度)。
   */
  browserPreviewUrlByWorkspace: Record<string, string>;
  setBrowserPreviewUrlForWorkspace: (workspacePath: string | null, url: string | null) => void;

  // 右侧面板(ChatRightPanel)开关与当前 tab,持久化让用户上次离开的状态刷新后还在。
  rightOpen: boolean;
  setRightOpen: (v: boolean) => void;
  toggleRightOpen: () => void;
  rightTab: string;
  setRightTab: (tab: string) => void;

  reviewPanelOpened: boolean;
  setReviewPanelOpened: (opened: boolean) => void;
  toggleReviewPanelOpened: () => void;
  reviewPanelWidth: number;
  setReviewPanelWidth: (width: number) => void;
  /**
   * Fusion 融合布局下，审查/文件/Context 侧栏停靠打开时，对话列占工作区总宽度的
   * 百分比（默认落在 30%-40% 区间，可拖拽调整，范围 20-55）。侍审查面板占用剩余宽度。
   */
  fusionDockSplitPos: number;
  setFusionDockSplitPos: (percent: number) => void;
  sidePanelActiveTab: 'review' | 'files' | 'context';
  setSidePanelActiveTab: (tab: 'review' | 'files' | 'context') => void;
  terminalPanelOpened: boolean;
  setTerminalPanelOpened: (opened: boolean) => void;
  toggleTerminalPanelOpened: () => void;
  terminalPanelHeight: number;
  setTerminalPanelHeight: (height: number) => void;

  /**
   * 快捷终端面板(VS Code 风格底部抽屉)是否开启,按 workspace 持久化。
   * 用户主动开/关,刷新后保留;无 workspace 时归入 __default__ 桶。
   */
  quickTerminalOpenByWorkspace: Record<string, boolean>;
  setQuickTerminalOpenForWorkspace: (workspacePath: string | null, open: boolean) => void;
  /** 抽屉高度(像素),全局共用一个值。 */
  quickTerminalHeight: number;
  setQuickTerminalHeight: (height: number) => void;
  /** 用户最后选中的终端 tab,按 workspace 记忆,刷新后自动激活回去。 */
  quickTerminalActiveIdByWorkspace: Record<string, string | null>;
  setQuickTerminalActiveIdForWorkspace: (
    workspacePath: string | null,
    terminalId: string | null,
  ) => void;
}

function normalizeWorkspacePath(path: string): string | null {
  const normalized = path.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeChatPath(path: string | null): string | null {
  if (!path) {
    return null;
  }

  const normalized = path.trim();
  if (!normalized.startsWith('/chat')) {
    return null;
  }

  return normalized;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isWorkbenchLayoutMode(value: unknown): value is WorkbenchLayoutMode {
  return value === 'classic' || value === 'fusion';
}

const SESSIONS_LIST_PANE_MIN_WIDTH = 260;
const SESSIONS_LIST_PANE_MAX_WIDTH = 520;
const SESSIONS_LIST_PANE_DEFAULT_WIDTH = 320;
const SIDEBAR_PANEL_MIN_WIDTH = 244;
const SIDEBAR_PANEL_MAX_WIDTH = 480;
const SIDEBAR_PANEL_DEFAULT_WIDTH = 288;
const REVIEW_PANEL_MIN_WIDTH = 300;
const REVIEW_PANEL_MAX_WIDTH = 640;
const REVIEW_PANEL_DEFAULT_WIDTH = 400;
const FUSION_DOCK_SPLIT_MIN_PERCENT = 20;
const FUSION_DOCK_SPLIT_MAX_PERCENT = 55;
const FUSION_DOCK_SPLIT_DEFAULT_PERCENT = 35;
const TERMINAL_PANEL_MIN_HEIGHT = 120;
const TERMINAL_PANEL_MAX_HEIGHT = 360;
const TERMINAL_PANEL_DEFAULT_HEIGHT = 160;

function createTabId(prefix: SessionTabType): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTabTitle(title: string, fallback: string): string {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function createSessionTab(
  id: string,
  sessionId: string,
  title: string,
  workspacePath: string | undefined,
): SessionTab {
  const baseTab = {
    id,
    type: 'session',
    sessionId,
    title: normalizeTabTitle(title, `会话 ${sessionId.slice(0, 8)}`),
    createdAt: Date.now(),
  } satisfies SessionTab;

  return workspacePath ? { ...baseTab, workspacePath } : baseTab;
}

function createDraftTab(id: string, workspacePath: string | undefined): SessionTab {
  const baseTab = {
    id,
    type: 'draft',
    title: '新会话',
    createdAt: Date.now(),
  } satisfies SessionTab;

  return workspacePath ? { ...baseTab, workspacePath } : baseTab;
}

function isSessionTab(value: unknown): value is SessionTab {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const type = Reflect.get(value, 'type');
  if (type !== 'session' && type !== 'draft') {
    return false;
  }

  if (
    typeof Reflect.get(value, 'id') !== 'string' ||
    typeof Reflect.get(value, 'title') !== 'string'
  ) {
    return false;
  }

  if (typeof Reflect.get(value, 'createdAt') !== 'number') {
    return false;
  }

  if (type === 'session' && typeof Reflect.get(value, 'sessionId') !== 'string') {
    return false;
  }

  const workspacePath = Reflect.get(value, 'workspacePath');
  return typeof workspacePath === 'undefined' || typeof workspacePath === 'string';
}

function normalizePersistedTabs(value: unknown): SessionTab[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isSessionTab).slice(0, 12);
}

export function clampSessionsListPaneWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SESSIONS_LIST_PANE_DEFAULT_WIDTH;
  }
  return Math.min(
    SESSIONS_LIST_PANE_MAX_WIDTH,
    Math.max(SESSIONS_LIST_PANE_MIN_WIDTH, Math.round(width)),
  );
}

export const SESSIONS_LIST_PANE_WIDTH_BOUNDS = {
  min: SESSIONS_LIST_PANE_MIN_WIDTH,
  max: SESSIONS_LIST_PANE_MAX_WIDTH,
  default: SESSIONS_LIST_PANE_DEFAULT_WIDTH,
} as const;

export function clampSidebarPanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_PANEL_DEFAULT_WIDTH;
  }

  return Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.max(SIDEBAR_PANEL_MIN_WIDTH, Math.round(width)));
}

export const SIDEBAR_PANEL_WIDTH_BOUNDS = {
  min: SIDEBAR_PANEL_MIN_WIDTH,
  max: SIDEBAR_PANEL_MAX_WIDTH,
  default: SIDEBAR_PANEL_DEFAULT_WIDTH,
} as const;

export function clampReviewPanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return REVIEW_PANEL_DEFAULT_WIDTH;
  }

  return Math.min(REVIEW_PANEL_MAX_WIDTH, Math.max(REVIEW_PANEL_MIN_WIDTH, Math.round(width)));
}

export const REVIEW_PANEL_WIDTH_BOUNDS = {
  min: REVIEW_PANEL_MIN_WIDTH,
  max: REVIEW_PANEL_MAX_WIDTH,
  default: REVIEW_PANEL_DEFAULT_WIDTH,
} as const;

export function clampFusionDockSplitPos(percent: number): number {
  if (!Number.isFinite(percent)) {
    return FUSION_DOCK_SPLIT_DEFAULT_PERCENT;
  }

  return Math.min(
    FUSION_DOCK_SPLIT_MAX_PERCENT,
    Math.max(FUSION_DOCK_SPLIT_MIN_PERCENT, Math.round(percent)),
  );
}

export const FUSION_DOCK_SPLIT_BOUNDS = {
  min: FUSION_DOCK_SPLIT_MIN_PERCENT,
  max: FUSION_DOCK_SPLIT_MAX_PERCENT,
  default: FUSION_DOCK_SPLIT_DEFAULT_PERCENT,
} as const;

export function clampTerminalPanelHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return TERMINAL_PANEL_DEFAULT_HEIGHT;
  }

  return Math.min(
    TERMINAL_PANEL_MAX_HEIGHT,
    Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.round(height)),
  );
}

export const TERMINAL_PANEL_HEIGHT_BOUNDS = {
  min: TERMINAL_PANEL_MIN_HEIGHT,
  max: TERMINAL_PANEL_MAX_HEIGHT,
  default: TERMINAL_PANEL_DEFAULT_HEIGHT,
} as const;

export const useUIStateStore = create<UIStateStore>()(
  persist(
    (set, get) => ({
      // Sidebar
      leftSidebarOpen: true,
      setLeftSidebarOpen: (v) => set({ leftSidebarOpen: v }),
      toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),

      navRailExpanded: null,
      setNavRailExpanded: (v) => set({ navRailExpanded: v }),
      toggleNavRailExpanded: (viewportDefault) =>
        set((s) => {
          // First click: pin the opposite of whatever the viewport default
          // would have produced. Subsequent clicks just flip the pinned value.
          const current = s.navRailExpanded ?? viewportDefault;
          return { navRailExpanded: !current };
        }),

      sidebarTab: 'sessions',
      setSidebarTab: (tab) => set({ sidebarTab: tab, sidebarViewMode: tab }),
      sidebarViewMode: 'sessions',
      setSidebarViewMode: (mode) =>
        set({ sidebarViewMode: mode, sidebarTab: mode === 'search' ? 'files' : mode }),
      sidebarPanelWidth: SIDEBAR_PANEL_DEFAULT_WIDTH,
      setSidebarPanelWidth: (width) => set({ sidebarPanelWidth: clampSidebarPanelWidth(width) }),
      sidebarPanelOpened: true,
      setSidebarPanelOpened: (opened) => set({ sidebarPanelOpened: opened }),
      toggleSidebarPanelOpened: () =>
        set((state) => ({ sidebarPanelOpened: !state.sidebarPanelOpened })),

      teamSplitPos: 50,
      setTeamSplitPos: (pos) => set({ teamSplitPos: Math.min(80, Math.max(20, pos)) }),
      teamEditorMode: 'overlay',
      setTeamEditorMode: (mode) => set({ teamEditorMode: mode }),

      // Chat view
      workbenchLayoutMode: 'fusion',
      setWorkbenchLayoutMode: (mode) => set({ workbenchLayoutMode: mode }),
      chatView: 'home',
      setChatView: (v) => set((state) => (state.chatView === v ? state : { chatView: v })),
      navigateToHome: () =>
        set((state) => (state.chatView === 'home' ? state : { chatView: 'home' })),
      navigateToSession: () =>
        set((state) => (state.chatView === 'session' ? state : { chatView: 'session' })),
      lastChatPath: null,
      setLastChatPath: (path) => set({ lastChatPath: normalizeChatPath(path) }),
      tabs: [],
      activeTabId: null,
      addSessionTab: (sessionId, title, workspacePath) => {
        const state = get();
        const existingTab = state.tabs.find(
          (tab) => tab.type === 'session' && tab.sessionId === sessionId,
        );
        const tabId = existingTab?.id ?? createTabId('session');
        const nextTab = createSessionTab(tabId, sessionId, title, workspacePath);
        set({
          tabs: existingTab
            ? state.tabs.map((tab) =>
                tab.id === tabId ? { ...nextTab, createdAt: tab.createdAt } : tab,
              )
            : [...state.tabs, nextTab],
          activeTabId: tabId,
        });
        return tabId;
      },
      addDraftTab: (workspacePath) => {
        const tabId = createTabId('draft');
        set((state) => ({
          tabs: [...state.tabs, createDraftTab(tabId, workspacePath)],
          activeTabId: tabId,
        }));
        return tabId;
      },
      closeTab: (tabId) => {
        const state = get();
        const closingIndex = state.tabs.findIndex((tab) => tab.id === tabId);
        if (closingIndex < 0) {
          return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
        }

        const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
        const nextActiveTab =
          state.activeTabId === tabId
            ? (nextTabs[Math.min(closingIndex, nextTabs.length - 1)] ?? null)
            : (nextTabs.find((tab) => tab.id === state.activeTabId) ?? null);
        set({
          tabs: nextTabs,
          activeTabId: nextActiveTab?.id ?? null,
        });
        return nextActiveTab;
      },
      selectTab: (tabId) => {
        const tab = get().tabs.find((entry) => entry.id === tabId) ?? null;
        if (tab) {
          set({ activeTabId: tab.id });
        }
        return tab;
      },
      selectAdjacentTab: (direction) => {
        const state = get();
        if (state.tabs.length === 0) {
          return null;
        }

        const currentIndex = Math.max(
          0,
          state.tabs.findIndex((tab) => tab.id === state.activeTabId),
        );
        const offset = direction === 'next' ? 1 : -1;
        const nextIndex = (currentIndex + offset + state.tabs.length) % state.tabs.length;
        const tab = state.tabs[nextIndex] ?? null;
        if (tab) {
          set({ activeTabId: tab.id });
        }
        return tab;
      },
      reorderTabs: (fromIndex, toIndex) =>
        set((state) => {
          if (
            fromIndex === toIndex ||
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= state.tabs.length ||
            toIndex >= state.tabs.length
          ) {
            return state;
          }

          const nextTabs = [...state.tabs];
          const [movingTab] = nextTabs.splice(fromIndex, 1);
          if (!movingTab) {
            return state;
          }
          nextTabs.splice(toIndex, 0, movingTab);
          return { tabs: nextTabs };
        }),
      updateTabTitle: (tabId, title) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, title: normalizeTabTitle(title, tab.title) } : tab,
          ),
        })),
      updateTabStreaming: (sessionId, streaming) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.type === 'session' && tab.sessionId === sessionId ? { ...tab, streaming } : tab,
          ),
        })),

      teamNewSessionSignal: null,
      triggerTeamNewSession: (teamWorkspaceId) =>
        set({
          teamNewSessionSignal: {
            teamWorkspaceId,
            nonce: Date.now(),
          },
        }),
      consumeTeamNewSessionSignal: () => set({ teamNewSessionSignal: null }),

      teamNewWorkspaceSignal: null,
      triggerTeamNewWorkspace: () =>
        set({
          teamNewWorkspaceSignal: {
            nonce: Date.now(),
          },
        }),
      consumeTeamNewWorkspaceSignal: () => set({ teamNewWorkspaceSignal: null }),

      teamSelectSessionSignal: null,
      triggerTeamSelectSession: (teamWorkspaceId, sessionId) =>
        set({
          teamSelectSessionSignal: {
            teamWorkspaceId,
            sessionId,
            nonce: Date.now(),
          },
        }),
      consumeTeamSelectSessionSignal: () => set({ teamSelectSessionSignal: null }),
      activeTeamSessionId: null,
      setActiveTeamSessionId: (id) => set({ activeTeamSessionId: id }),

      resetToWelcomeSignal: null,
      triggerResetToWelcome: (route) => set({ resetToWelcomeSignal: { route, nonce: Date.now() } }),
      consumeResetToWelcomeSignal: () => set({ resetToWelcomeSignal: null }),

      // Pinned sessions
      pinnedSessions: [],
      togglePinSession: (id) =>
        set((s) => ({
          pinnedSessions: s.pinnedSessions.includes(id)
            ? s.pinnedSessions.filter((p) => p !== id)
            : [...s.pinnedSessions, id],
        })),
      isPinned: (id) => get().pinnedSessions.includes(id),

      // File tree
      expandedDirs: [],
      setExpandedDirs: (dirs) => set({ expandedDirs: dirs }),

      fileTreeRootPath: null,
      setFileTreeRootPath: (path) => set({ fileTreeRootPath: path }),
      workspaceTreeVersion: 0,
      bumpWorkspaceTreeVersion: () =>
        set((state) => ({ workspaceTreeVersion: state.workspaceTreeVersion + 1 })),
      savedWorkspacePaths: [],
      addSavedWorkspacePath: (path) =>
        set((state) => {
          const normalized = normalizeWorkspacePath(path);
          if (!normalized) {
            return state;
          }

          return {
            savedWorkspacePaths: [
              normalized,
              ...state.savedWorkspacePaths.filter((entry) => entry !== normalized),
            ],
          };
        }),
      mergeSavedWorkspacePaths: (paths) =>
        set((state) => {
          const normalizedPaths = paths
            .map((path) => normalizeWorkspacePath(path))
            .filter((path): path is string => path !== null);
          if (normalizedPaths.length === 0) {
            return state;
          }

          const uniquePaths = Array.from(new Set(normalizedPaths));
          const nextSavedWorkspacePaths = [
            ...uniquePaths,
            ...state.savedWorkspacePaths.filter((entry) => !uniquePaths.includes(entry)),
          ];

          if (
            nextSavedWorkspacePaths.length === state.savedWorkspacePaths.length &&
            nextSavedWorkspacePaths.every(
              (entry, index) => entry === state.savedWorkspacePaths[index],
            )
          ) {
            return state;
          }

          return {
            savedWorkspacePaths: nextSavedWorkspacePaths,
          };
        }),
      removeSavedWorkspacePath: (path) =>
        set((state) => {
          const normalized = normalizeWorkspacePath(path);
          if (!normalized) {
            return state;
          }

          return {
            savedWorkspacePaths: state.savedWorkspacePaths.filter((entry) => entry !== normalized),
            selectedWorkspacePath:
              state.selectedWorkspacePath === normalized ? null : state.selectedWorkspacePath,
            fileTreeRootPath: state.fileTreeRootPath === normalized ? null : state.fileTreeRootPath,
          };
        }),
      selectedWorkspacePath: null,
      setSelectedWorkspacePath: (path) =>
        set({ selectedWorkspacePath: path ? normalizeWorkspacePath(path) : null }),
      activeSessionWorkspace: null,
      setActiveSessionWorkspace: (sessionId, path) =>
        set((state) => ({
          activeSessionWorkspace: {
            sessionId,
            path: path ? normalizeWorkspacePath(path) : null,
            version:
              state.activeSessionWorkspace?.sessionId === sessionId
                ? state.activeSessionWorkspace.version + 1
                : 1,
          },
        })),
      clearActiveSessionWorkspace: (sessionId) =>
        set((state) => {
          if (!state.activeSessionWorkspace) {
            return state;
          }

          if (sessionId && state.activeSessionWorkspace.sessionId !== sessionId) {
            return state;
          }

          return { activeSessionWorkspace: null };
        }),

      // P3-PATH session list scoping
      sessionListPathFilterEnabled: false,
      setSessionListPathFilterEnabled: (v) => set({ sessionListPathFilterEnabled: v }),
      sessionListPathFilterFeatureEnabled: true,
      setSessionListPathFilterFeatureEnabled: (v) =>
        set({ sessionListPathFilterFeatureEnabled: v }),

      // /sessions 页面布局
      sessionsListPaneWidth: 320,
      setSessionsListPaneWidth: (width) =>
        set({ sessionsListPaneWidth: clampSessionsListPaneWidth(width) }),
      sessionsCollapsedWorkspaceGroups: [],
      toggleSessionsCollapsedWorkspaceGroup: (groupKey) =>
        set((s) => {
          const set_ = new Set(s.sessionsCollapsedWorkspaceGroups);
          if (set_.has(groupKey)) set_.delete(groupKey);
          else set_.add(groupKey);
          return { sessionsCollapsedWorkspaceGroups: Array.from(set_) };
        }),
      setSessionsCollapsedWorkspaceGroups: (groupKeys) =>
        set({ sessionsCollapsedWorkspaceGroups: Array.from(new Set(groupKeys)) }),

      sessionsScopeFilter: 'all',
      setSessionsScopeFilter: (scope) => set({ sessionsScopeFilter: scope }),
      sessionsCollapsedScopes: [],
      toggleSessionsCollapsedScope: (scope) =>
        set((s) => {
          const set_ = new Set(s.sessionsCollapsedScopes);
          if (set_.has(scope)) set_.delete(scope);
          else set_.add(scope);
          return { sessionsCollapsedScopes: Array.from(set_) as Array<'personal' | 'team'> };
        }),

      // Editor
      editorMode: false,
      setEditorMode: (v) => set({ editorMode: v }),

      editorFullScreen: false,
      setEditorFullScreen: (v) => set({ editorFullScreen: v }),

      splitPos: 50,
      setSplitPos: (v) => set({ splitPos: v }),

      openFilePathsByWorkspace: {},
      activeFilePathByWorkspace: {},
      setOpenFilePathsForWorkspace: (workspacePath, paths) =>
        set((state) => {
          const key =
            workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
          const next = { ...state.openFilePathsByWorkspace };
          if (paths.length === 0) {
            delete next[key];
          } else {
            next[key] = paths;
          }
          return { openFilePathsByWorkspace: next };
        }),
      setActiveFilePathForWorkspace: (workspacePath, path) =>
        set((state) => {
          const key =
            workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
          const next = { ...state.activeFilePathByWorkspace };
          if (path) {
            next[key] = path;
          } else {
            delete next[key];
          }
          return { activeFilePathByWorkspace: next };
        }),

      editorPaneTabByWorkspace: {},
      setEditorPaneTabForWorkspace: (workspacePath, tab) =>
        set((state) => {
          const key =
            workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
          return {
            editorPaneTabByWorkspace: {
              ...state.editorPaneTabByWorkspace,
              [key]: tab,
            },
          };
        }),

      browserPreviewUrl: null,
      setBrowserPreviewUrl: (url) => set({ browserPreviewUrl: url }),
      browserActive: false,
      setBrowserActive: (v) => set({ browserActive: v }),
      browserPreviewUrlByWorkspace: {},
      setBrowserPreviewUrlForWorkspace: (workspacePath, url) =>
        set((state) => {
          // 无 workspace 时归入 __default__ 桶,跟 BuiltInBrowser 的默认 storage key 一致。
          const key =
            workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
          const next = { ...state.browserPreviewUrlByWorkspace };
          if (url) {
            next[key] = url;
          } else {
            delete next[key];
          }
          return { browserPreviewUrlByWorkspace: next };
        }),

      rightOpen: false,
      setRightOpen: (v) => set({ rightOpen: v }),
      toggleRightOpen: () => set((s) => ({ rightOpen: !s.rightOpen })),
      rightTab: 'overview',
      setRightTab: (tab) => set({ rightTab: tab }),
      reviewPanelOpened: false,
      setReviewPanelOpened: (opened) => set({ reviewPanelOpened: opened }),
      toggleReviewPanelOpened: () =>
        set((state) => ({ reviewPanelOpened: !state.reviewPanelOpened })),
      reviewPanelWidth: REVIEW_PANEL_WIDTH_BOUNDS.default,
      setReviewPanelWidth: (width) => set({ reviewPanelWidth: clampReviewPanelWidth(width) }),
      fusionDockSplitPos: FUSION_DOCK_SPLIT_BOUNDS.default,
      setFusionDockSplitPos: (percent) =>
        set({ fusionDockSplitPos: clampFusionDockSplitPos(percent) }),
      sidePanelActiveTab: 'review',
      setSidePanelActiveTab: (tab) => set({ sidePanelActiveTab: tab }),
      terminalPanelOpened: false,
      setTerminalPanelOpened: (opened) => set({ terminalPanelOpened: opened }),
      toggleTerminalPanelOpened: () =>
        set((state) => ({ terminalPanelOpened: !state.terminalPanelOpened })),
      terminalPanelHeight: TERMINAL_PANEL_HEIGHT_BOUNDS.default,
      setTerminalPanelHeight: (height) =>
        set({ terminalPanelHeight: clampTerminalPanelHeight(height) }),

      quickTerminalOpenByWorkspace: {},
      setQuickTerminalOpenForWorkspace: (workspacePath, open) =>
        set((state) => {
          const key =
            workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
          const next = { ...state.quickTerminalOpenByWorkspace };
          if (open) {
            next[key] = true;
          } else {
            delete next[key];
          }
          return { quickTerminalOpenByWorkspace: next };
        }),
      quickTerminalHeight: 280,
      setQuickTerminalHeight: (height) =>
        set({ quickTerminalHeight: Math.max(160, Math.min(720, Math.floor(height))) }),
      quickTerminalActiveIdByWorkspace: {},
      setQuickTerminalActiveIdForWorkspace: (workspacePath, terminalId) =>
        set((state) => {
          const key =
            workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
          const next = { ...state.quickTerminalActiveIdByWorkspace };
          if (terminalId) {
            next[key] = terminalId;
          } else {
            delete next[key];
          }
          return { quickTerminalActiveIdByWorkspace: next };
        }),
    }),
    {
      name: 'openAwork-ui-state',
      version: 21,
      // reviewPanelOpened / editorMode 不持久化——每次启动默认关闭。
      partialize: (state) => {
        const { reviewPanelOpened: _rp, editorMode: _em, ...rest } = state;
        return rest as typeof state;
      },
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as object) };
        merged.reviewPanelOpened = false;
        merged.editorMode = false;
        return merged as typeof currentState;
      },
      // Throttle storage writes to avoid JSON.stringify+setItem on
      // every fast UI mutation (tab clicks, expand/collapse). See
      // throttledStorage definition above.
      storage: throttledStorage,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;

        const nextState: Record<string, unknown> = { ...state };
        if (version < 2) {
          nextState.leftSidebarOpen = true;
          nextState.chatView = 'home' satisfies ChatView;
          nextState.pinnedSessions = [];
        }

        if (version < 4) {
          nextState.lastChatPath = null;
        }

        if (version < 5) {
          nextState.navRailExpanded = null;
        }

        if (version < 6) {
          nextState.editorPaneTab = 'code';
          nextState.browserPreviewUrl = null;
          nextState.browserActive = false;
          nextState.browserPreviewUrlBySession = {};
        }

        if (version < 7) {
          nextState.rightOpen = false;
          nextState.rightTab = 'overview';
        }

        // v8:历史上一些用户的 leftSidebarOpen 被意外置为 false 后无法找回会话列表;
        // 升级时强制恢复为 true,确保会话列表可见。用户后续手动收起仍正常持久化。
        if (version < 8) {
          nextState.leftSidebarOpen = true;
        }

        // v9:浏览器预览 URL 的归属从 session 改为 workspace,避免跨 workspace 切会话
        // 时看到上一个 workspace 的页面。旧字段 browserPreviewUrlBySession 不再使用,
        // 这里清掉,users 重新打开浏览器时会按 workspace 重新建立映射。
        if (version < 9) {
          delete nextState.browserPreviewUrlBySession;
          nextState.browserPreviewUrlByWorkspace = {};
        }

        // v10:openFilePaths / activeFilePath 也从全局改为按 workspace 持久化,跨
        // workspace 切换时各自互不干扰,切回旧 workspace 时自动恢复打开过的文件。
        if (version < 10) {
          const oldOpen = Array.isArray(nextState.openFilePaths)
            ? (nextState.openFilePaths as string[])
            : [];
          const oldActive =
            typeof nextState.activeFilePath === 'string' ? nextState.activeFilePath : null;
          delete nextState.openFilePaths;
          delete nextState.activeFilePath;
          // 旧的全局值归入 __default__ 桶,避免用户立刻丢上次打开的文件。
          nextState.openFilePathsByWorkspace = oldOpen.length > 0 ? { __default__: oldOpen } : {};
          nextState.activeFilePathByWorkspace = oldActive ? { __default__: oldActive } : {};
        }

        // v11:editorPaneTab(code / browser)也改为按 workspace 持久化,跨 workspace
        // 切换时不再被上一个 workspace 留下的视图覆盖。
        if (version < 11) {
          const oldTab = nextState.editorPaneTab === 'browser' ? 'browser' : 'code';
          delete nextState.editorPaneTab;
          nextState.editorPaneTabByWorkspace = { __default__: oldTab };
        }

        // v12:快捷终端面板字段。沿用 by-workspace + __default__ 兜底。
        if (version < 12) {
          nextState.quickTerminalOpenByWorkspace = {};
          nextState.quickTerminalHeight = 280;
          nextState.quickTerminalActiveIdByWorkspace = {};
        }

        // v13:`/sessions` 页面新增可拖拽列表宽度与可折叠工作区分组的持久化字段。
        if (version < 13) {
          nextState.sessionsListPaneWidth = SESSIONS_LIST_PANE_WIDTH_BOUNDS.default;
          nextState.sessionsCollapsedWorkspaceGroups = [];
          nextState.sessionsScopeFilter = 'all';
          nextState.sessionsCollapsedScopes = [];
        }

        // v14:编辑器/浏览器工作区全屏模式开关。默认关闭(保持原有分屏行为)。
        if (version < 14) {
          nextState.editorFullScreen = false;
        }

        // v15:sidebarTab 重命名为 sidebarViewMode,并新增 'search' 模式。
        // 旧值 'sessions' / 'files' 直接映射,其他值回退为 'sessions'。
        // 同时新增 Team 编辑器分屏相关字段。
        if (version < 15) {
          const oldTab = nextState.sidebarTab;
          delete nextState.sidebarTab;
          nextState.sidebarViewMode = oldTab === 'files' ? 'files' : 'sessions';
          nextState.teamSplitPos = 50;
          nextState.teamEditorMode = 'overlay';
        }

        // v16:OpenCode 布局借鉴引入顶部会话标签和 Rail+Panel 侧栏状态。
        if (version < 16) {
          nextState.sidebarPanelWidth = SIDEBAR_PANEL_WIDTH_BOUNDS.default;
          nextState.sidebarPanelOpened = true;
          nextState.tabs = [];
          nextState.activeTabId = null;
        }

        if (version < 17) {
          nextState.reviewPanelOpened = false;
          nextState.reviewPanelWidth = REVIEW_PANEL_WIDTH_BOUNDS.default;
          nextState.terminalPanelOpened = false;
          nextState.terminalPanelHeight = TERMINAL_PANEL_HEIGHT_BOUNDS.default;
        }

        if (version < 18) {
          nextState.workbenchLayoutMode = 'fusion' satisfies WorkbenchLayoutMode;
        }

        // v19:默认展开编辑器/文件预览面板，提供 IDE 式工作区视图。
        if (version < 19) {
          nextState.editorMode = true;
        }

        // v20:reviewPanelOpened / editorMode 不再持久化，每次启动强制关闭。
        if (version < 20) {
          nextState.reviewPanelOpened = false;
          nextState.editorMode = false;
        }

        // v21:Fusion 停靠侧栏改用百分比分栏（对话列默认占 35%），替代固定像素审查
        // 面板宽度独占剩余空间的旧机制。
        if (version < 21) {
          nextState.fusionDockSplitPos = FUSION_DOCK_SPLIT_BOUNDS.default;
        }

        if (!isStringArray(nextState.savedWorkspacePaths)) {
          nextState.savedWorkspacePaths = [];
        }

        if (typeof nextState.selectedWorkspacePath !== 'string') {
          nextState.selectedWorkspacePath = null;
        }

        if (typeof nextState.lastChatPath !== 'string') {
          nextState.lastChatPath = null;
        }

        if (!isWorkbenchLayoutMode(nextState.workbenchLayoutMode)) {
          nextState.workbenchLayoutMode = 'fusion' satisfies WorkbenchLayoutMode;
        }

        if (typeof nextState.sessionListPathFilterEnabled !== 'boolean') {
          nextState.sessionListPathFilterEnabled = false;
        }

        if (nextState.navRailExpanded !== null && typeof nextState.navRailExpanded !== 'boolean') {
          nextState.navRailExpanded = null;
        }

        nextState.sidebarPanelWidth = clampSidebarPanelWidth(
          typeof nextState.sidebarPanelWidth === 'number'
            ? nextState.sidebarPanelWidth
            : SIDEBAR_PANEL_WIDTH_BOUNDS.default,
        );

        if (typeof nextState.sidebarPanelOpened !== 'boolean') {
          nextState.sidebarPanelOpened = true;
        }

        nextState.reviewPanelWidth = clampReviewPanelWidth(
          typeof nextState.reviewPanelWidth === 'number'
            ? nextState.reviewPanelWidth
            : REVIEW_PANEL_WIDTH_BOUNDS.default,
        );

        nextState.fusionDockSplitPos = clampFusionDockSplitPos(
          typeof nextState.fusionDockSplitPos === 'number'
            ? nextState.fusionDockSplitPos
            : FUSION_DOCK_SPLIT_BOUNDS.default,
        );

        if (typeof nextState.reviewPanelOpened !== 'boolean') {
          nextState.reviewPanelOpened = false;
        }

        nextState.terminalPanelHeight = clampTerminalPanelHeight(
          typeof nextState.terminalPanelHeight === 'number'
            ? nextState.terminalPanelHeight
            : TERMINAL_PANEL_HEIGHT_BOUNDS.default,
        );

        if (typeof nextState.terminalPanelOpened !== 'boolean') {
          nextState.terminalPanelOpened = false;
        }

        nextState.tabs = normalizePersistedTabs(nextState.tabs);
        if (
          typeof nextState.activeTabId !== 'string' ||
          !(nextState.tabs as SessionTab[]).some((tab) => tab.id === nextState.activeTabId)
        ) {
          nextState.activeTabId = (nextState.tabs as SessionTab[])[0]?.id ?? null;
        }

        nextState.sessionsListPaneWidth = clampSessionsListPaneWidth(
          typeof nextState.sessionsListPaneWidth === 'number'
            ? nextState.sessionsListPaneWidth
            : SESSIONS_LIST_PANE_WIDTH_BOUNDS.default,
        );

        if (!isStringArray(nextState.sessionsCollapsedWorkspaceGroups)) {
          nextState.sessionsCollapsedWorkspaceGroups = [];
        }

        if (
          nextState.sessionsScopeFilter !== 'all' &&
          nextState.sessionsScopeFilter !== 'personal' &&
          nextState.sessionsScopeFilter !== 'team'
        ) {
          nextState.sessionsScopeFilter = 'all';
        }

        if (!isStringArray(nextState.sessionsCollapsedScopes)) {
          nextState.sessionsCollapsedScopes = [];
        } else {
          nextState.sessionsCollapsedScopes = (
            nextState.sessionsCollapsedScopes as string[]
          ).filter((scope) => scope === 'personal' || scope === 'team');
        }

        return nextState;
      },
    },
  ),
);
