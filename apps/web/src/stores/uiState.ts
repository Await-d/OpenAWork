import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatView = 'home' | 'session';

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

  // Chat view
  chatView: ChatView;
  setChatView: (v: ChatView) => void;
  navigateToHome: () => void;
  navigateToSession: () => void;
  lastChatPath: string | null;
  setLastChatPath: (path: string | null) => void;

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

  // Editor mode
  editorMode: boolean;
  setEditorMode: (v: boolean) => void;

  splitPos: number;
  setSplitPos: (v: number) => void;

  openFilePaths: string[];
  activeFilePath: string | null;
  setOpenFilePaths: (paths: string[]) => void;
  setActiveFilePath: (path: string | null) => void;

  // Editor pane right-tab (code / browser) — 持久化让用户上次开着的视图刷新后还在
  editorPaneTab: 'code' | 'browser';
  setEditorPaneTab: (tab: 'code' | 'browser') => void;

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
      setSidebarTab: (tab) => set({ sidebarTab: tab }),

      // Chat view
      chatView: 'home',
      setChatView: (v) => set({ chatView: v }),
      navigateToHome: () => set({ chatView: 'home' }),
      navigateToSession: () => set({ chatView: 'session' }),
      lastChatPath: null,
      setLastChatPath: (path) => set({ lastChatPath: normalizeChatPath(path) }),

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

      // Editor
      editorMode: false,
      setEditorMode: (v) => set({ editorMode: v }),

      splitPos: 50,
      setSplitPos: (v) => set({ splitPos: v }),

      openFilePaths: [],
      activeFilePath: null,
      setOpenFilePaths: (paths) => set({ openFilePaths: paths }),
      setActiveFilePath: (path) => set({ activeFilePath: path }),

      editorPaneTab: 'code',
      setEditorPaneTab: (tab) => set({ editorPaneTab: tab }),

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
    }),
    {
      name: 'openAwork-ui-state',
      version: 9,
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

        if (!isStringArray(nextState.savedWorkspacePaths)) {
          nextState.savedWorkspacePaths = [];
        }

        if (typeof nextState.selectedWorkspacePath !== 'string') {
          nextState.selectedWorkspacePath = null;
        }

        if (typeof nextState.lastChatPath !== 'string') {
          nextState.lastChatPath = null;
        }

        if (typeof nextState.sessionListPathFilterEnabled !== 'boolean') {
          nextState.sessionListPathFilterEnabled = false;
        }

        if (nextState.navRailExpanded !== null && typeof nextState.navRailExpanded !== 'boolean') {
          nextState.navRailExpanded = null;
        }

        return nextState;
      },
    },
  ),
);
