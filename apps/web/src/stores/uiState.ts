import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatView = 'home' | 'session';

export interface UIStateStore {
  // Sidebar
  leftSidebarOpen: boolean;
  setLeftSidebarOpen: (v: boolean) => void;
  toggleLeftSidebar: () => void;

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

  // Editor mode
  editorMode: boolean;
  setEditorMode: (v: boolean) => void;

  splitPos: number;
  setSplitPos: (v: number) => void;

  openFilePaths: string[];
  activeFilePath: string | null;
  setOpenFilePaths: (paths: string[]) => void;
  setActiveFilePath: (path: string | null) => void;
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

      // Editor
      editorMode: false,
      setEditorMode: (v) => set({ editorMode: v }),

      splitPos: 50,
      setSplitPos: (v) => set({ splitPos: v }),

      openFilePaths: [],
      activeFilePath: null,
      setOpenFilePaths: (paths) => set({ openFilePaths: paths }),
      setActiveFilePath: (path) => set({ activeFilePath: path }),
    }),
    {
      name: 'openAwork-ui-state',
      version: 4,
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

        if (!isStringArray(nextState.savedWorkspacePaths)) {
          nextState.savedWorkspacePaths = [];
        }

        if (typeof nextState.selectedWorkspacePath !== 'string') {
          nextState.selectedWorkspacePath = null;
        }

        if (typeof nextState.lastChatPath !== 'string') {
          nextState.lastChatPath = null;
        }

        return nextState;
      },
    },
  ),
);
