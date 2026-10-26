import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import type { TerminalLayout } from '../../components/chat/terminal/layout/types.js';
import { isSameWorkspace, type WorkspaceIdentity } from '../../utils/session/session-grouping.js';
import {
  forgetSessionSubviews,
  normalizeActiveChildSessionIds,
  normalizeCollapsedFlags,
  sessionSubviewKey,
  withActiveChildSessionId,
  withCollapsedFlag,
} from './session-subview-buckets.js';

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
export { UI_STATE_STORAGE_KEY, throttledStorage } from './ui-state-storage.js';
import { UI_STATE_STORAGE_KEY, flushPending, throttledStorage } from './ui-state-storage.js';

export * from './ui-state-types.js';
export * from './ui-state-helpers.js';
import { EMPTY_READ_IDENTITY } from './ui-state-types.js';
import type {
  ChatView,
  SessionTab,
  SessionTabType,
  UIStateStore,
  WorkbenchLayoutMode,
  WorkspaceReadIdentity,
} from './ui-state-types.js';
import {
  normalizeWorkspacePath,
  toWorkspaceIdentity,
  toWorkspaceIdentityKey,
  isWorkspaceIdentityShape,
  normalizeWorkspaceIdentities,
  normalizeChatPath,
  isStringArray,
  DEFAULT_EXPANDED_DIRS_SESSION_KEY,
  EMPTY_EXPANDED_DIRS,
  normalizeExpandedDirsSessionKey,
  normalizeExpandedDirsBySession,
  DEFAULT_TERMINAL_PANEL_SESSION_KEY,
  terminalPanelSessionKeyFor,
  TerminalPanelPosition,
  TERMINAL_PANEL_POSITIONS,
  isTerminalPanelPosition,
  SIDE_PANEL_ACTIVE_TABS,
  SidePanelActiveTab,
  isSidePanelActiveTab,
  DEFAULT_SIDE_PANEL_ACTIVE_TAB,
  withSidePanelActiveTab,
  normalizeSidePanelActiveTabBySession,
  resolveEffectiveTerminalPanelPosition,
  normalizeTerminalPanelOpenedBySession,
  TERMINAL_LAYOUT_MAX_DEPTH,
  TERMINAL_LAYOUT_MAX_NODES,
  isPlainRecord,
  isValidTerminalPaneShape,
  isValidTerminalSplitShape,
  isValidTerminalLayoutNodeShape,
  isValidTerminalLayoutShape,
  normalizeTerminalLayoutBySession,
  isWorkbenchLayoutMode,
  SESSIONS_LIST_PANE_MIN_WIDTH,
  SESSIONS_LIST_PANE_MAX_WIDTH,
  SESSIONS_LIST_PANE_DEFAULT_WIDTH,
  SIDEBAR_PANEL_MIN_WIDTH,
  SIDEBAR_PANEL_MAX_WIDTH,
  SIDEBAR_PANEL_DEFAULT_WIDTH,
  REVIEW_PANEL_MIN_WIDTH,
  REVIEW_PANEL_MAX_WIDTH,
  REVIEW_PANEL_DEFAULT_WIDTH,
  FUSION_DOCK_SPLIT_MIN_PERCENT,
  FUSION_DOCK_SPLIT_MAX_PERCENT,
  FUSION_DOCK_SPLIT_DEFAULT_PERCENT,
  TERMINAL_PANEL_MIN_HEIGHT,
  TERMINAL_PANEL_MAX_HEIGHT,
  TERMINAL_PANEL_DEFAULT_HEIGHT,
  TERMINAL_PANEL_VIEWPORT_MAX_RATIO,
  TERMINAL_PANEL_VIEWPORT_DEFAULT_RATIO,
  TERMINAL_PANEL_ABSOLUTE_MAX_HEIGHT,
  TERMINAL_PANEL_MIN_HEADROOM,
  TERMINAL_PANEL_MIN_DEFAULT_HEADROOM,
  createTabId,
  normalizeTabTitle,
  createSessionTab,
  createDraftTab,
  isSessionTab,
  normalizePersistedTabs,
  computeTabClosure,
  mergeClosedSessionTabIds,
  clampSessionsListPaneWidth,
  SESSIONS_LIST_PANE_WIDTH_BOUNDS,
  clampSidebarPanelWidth,
  SIDEBAR_PANEL_WIDTH_BOUNDS,
  clampReviewPanelWidth,
  REVIEW_PANEL_WIDTH_BOUNDS,
  clampFusionDockSplitPos,
  FUSION_DOCK_SPLIT_BOUNDS,
  clampTerminalPanelHeight,
  TERMINAL_PANEL_HEIGHT_BOUNDS,
  TerminalPanelHeightBounds,
  resolveTerminalPanelHeightBounds,
  clampTerminalPanelHeightToBounds,
  TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS,
  TERMINAL_PANEL_CHROME_HEIGHT,
  TERMINAL_MIN_PANE_HEIGHT,
  resolveTerminalPanelHeightWithPaneFloor,
} from './ui-state-helpers.js';

export function uiStateHasHydrated(): boolean {
  return useUIStateStore.persist.hasHydrated();
}

/**
 * 终端面板的渲染门（与 `App.tsx` 的 `useHasHydrated` 同一模式）。
 *
 * 为什么终端面板必须等：`uiState` 走的是自定义节流 storage，Zustand 在自定义 storage
 * 下的水合是**异步**的（microtask），而 auth store 用的同步 localStorage 水合早已完成 ——
 * 于是刷新后会出现一帧「auth 已就绪、uiState 还没水合」的窗口：此帧渲染的终端面板
 * `lastChatPath` 是默认 null（会话键 `__default__`），水合完成后才切到真实会话键，
 * `TerminalSplitView` 的两条分支因此换 key、panes 整棵重挂载。若用户在这一帧按下 tab
 * 起拖，手势会随卸载一起作废 —— 表现就是「刷新后第一次拖不动，切几次标签才恢复」。
 * 等水合完成再渲染，会话键从第一帧起就是最终值。
 */
export function useUIStateHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => uiStateHasHydrated());
  useEffect(() => {
    const unsub = useUIStateStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(uiStateHasHydrated());
    return unsub;
  }, []);
  return hydrated;
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
      setLastChatPath: (path) =>
        set((state) => {
          const nextPath = normalizeChatPath(path);
          const previousKey = terminalPanelSessionKeyFor(state.lastChatPath);
          const nextKey = terminalPanelSessionKeyFor(nextPath);
          if (previousKey === nextKey) {
            return { lastChatPath: nextPath };
          }

          // 会话切换：先把当前镜像归档回旧会话桶（保住旧会话的展开态与一级 tab），
          // 再把新会话桶的值载入镜像（终端缺省收起、tab 缺省审查）。
          return {
            lastChatPath: nextPath,
            terminalPanelOpened: state.terminalPanelOpenedBySession[nextKey] ?? false,
            terminalPanelOpenedBySession: {
              ...state.terminalPanelOpenedBySession,
              [previousKey]: state.terminalPanelOpened,
            },
            sidePanelActiveTab:
              state.sidePanelActiveTabBySession[nextKey] ?? DEFAULT_SIDE_PANEL_ACTIVE_TAB,
            sidePanelActiveTabBySession: withSidePanelActiveTab(
              state.sidePanelActiveTabBySession,
              previousKey,
              state.sidePanelActiveTab,
            ),
          };
        }),
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
        const state = get();
        // 草稿标签代表「尚未发出首条消息的新会话」：同一时刻只保留一个。
        // 重复点击「新建会话」只会复用并激活它，不会无限堆积空对话标签。
        const existingDraftTab = state.tabs.find((tab) => tab.type === 'draft');
        if (existingDraftTab) {
          // 省略参数 = 沿用草稿现有工作区；显式传值（含 null）才改写，
          // 保证「在未绑定分组新建」能真正清掉上一次的工作区。
          const hasExplicitWorkspace = workspacePath !== undefined;
          const nextWorkspacePath = workspacePath ?? undefined;
          const nextTab: SessionTab =
            hasExplicitWorkspace && nextWorkspacePath !== existingDraftTab.workspacePath
              ? { ...existingDraftTab, workspacePath: nextWorkspacePath }
              : existingDraftTab;

          if (nextTab !== existingDraftTab || state.activeTabId !== existingDraftTab.id) {
            set({
              tabs:
                nextTab === existingDraftTab
                  ? state.tabs
                  : state.tabs.map((tab) => (tab.id === existingDraftTab.id ? nextTab : tab)),
              activeTabId: existingDraftTab.id,
            });
          }

          return existingDraftTab.id;
        }

        const tabId = createTabId('draft');
        set((currentState) => ({
          tabs: [...currentState.tabs, createDraftTab(tabId, workspacePath ?? undefined)],
          activeTabId: tabId,
        }));
        return tabId;
      },
      openDraftSession: (workspacePath, sshConnectionId) => {
        const state = get();
        state.setSelectedWorkspacePath(workspacePath);
        if (workspacePath) {
          // 草稿会话的工作区身份必须带上连接：远端目录若只按路径登记，
          // 它的占位组会和同名的其它主机目录重新合并。
          state.addSavedWorkspace({ workspacePath, sshConnectionId: sshConnectionId ?? null });
        }
        if (sshConnectionId !== undefined) {
          state.setSelectedSshConnectionId(sshConnectionId);
        }

        const tabId = state.addDraftTab(workspacePath);
        state.navigateToHome();
        return tabId;
      },
      closeDraftTabs: () => {
        const state = get();
        const closure = computeTabClosure(
          state.tabs,
          state.activeTabId,
          (tab) => tab.type === 'draft',
        );
        if (!closure) {
          return;
        }

        set({ tabs: closure.tabs, activeTabId: closure.activeTabId });
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
      closeTabs: (tabIds) => {
        const state = get();
        const tabIdSet = new Set(tabIds);
        const closure = computeTabClosure(state.tabs, state.activeTabId, (tab) =>
          tabIdSet.has(tab.id),
        );
        if (!closure) {
          return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
        }

        set({
          tabs: closure.tabs,
          activeTabId: closure.activeTabId,
          closedSessionTabIds: mergeClosedSessionTabIds(
            state.closedSessionTabIds,
            closure.closedSessionIds,
          ),
        });
        return closure.nextActiveTab;
      },
      closeSessionTabs: (sessionIds) => {
        const state = get();
        const sessionIdSet = new Set(sessionIds);
        const closure = computeTabClosure(
          state.tabs,
          state.activeTabId,
          (tab) =>
            tab.type === 'session' &&
            tab.sessionId !== undefined &&
            sessionIdSet.has(tab.sessionId),
        );
        if (!closure) {
          return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
        }

        set({
          tabs: closure.tabs,
          activeTabId: closure.activeTabId,
          closedSessionTabIds: mergeClosedSessionTabIds(
            state.closedSessionTabIds,
            closure.closedSessionIds,
          ),
        });
        return closure.nextActiveTab;
      },
      closedSessionTabIds: [],
      clearClosedSessionTabIds: () =>
        set((state) =>
          state.closedSessionTabIds.length === 0 ? state : { closedSessionTabIds: [] },
        ),
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
        set((state) => {
          const currentTab = state.tabs.find((tab) => tab.id === tabId);
          if (!currentTab) {
            return state;
          }

          const nextTitle = normalizeTabTitle(title, currentTab.title);
          if (nextTitle === currentTab.title) {
            return state;
          }

          return {
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, title: nextTitle } : tab)),
          };
        }),
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

      // 会话列表折叠分组
      collapsedSessionGroups: [],
      toggleSessionGroupCollapsed: (groupKey) =>
        set((s) => ({
          collapsedSessionGroups: s.collapsedSessionGroups.includes(groupKey)
            ? s.collapsedSessionGroups.filter((key) => key !== groupKey)
            : [...s.collapsedSessionGroups, groupKey],
        })),

      // 会话列表子代理折叠：按父会话 ID 记录
      collapsedSubagentParentIds: [],
      toggleSubagentCollapsed: (parentSessionId) =>
        set((s) => ({
          collapsedSubagentParentIds: s.collapsedSubagentParentIds.includes(parentSessionId)
            ? s.collapsedSubagentParentIds.filter((id) => id !== parentSessionId)
            : [...s.collapsedSubagentParentIds, parentSessionId],
        })),
      retainSubagentCollapsed: (keepParentSessionIds) =>
        set((s) => {
          if (s.collapsedSubagentParentIds.length === 0) {
            return s;
          }
          const keep = new Set(keepParentSessionIds);
          const next = s.collapsedSubagentParentIds.filter((id) => keep.has(id));
          return next.length === s.collapsedSubagentParentIds.length
            ? s
            : { collapsedSubagentParentIds: next };
        }),

      // 会话内子视图（子代理运行列表折叠 / 当前查看的子会话）：按会话分桶持久化。
      collapsedSubagentRunListBySession: {},
      setSubagentRunListCollapsed: (sessionId, collapsed) =>
        set((state) => {
          const key = sessionSubviewKey(sessionId);
          const next = withCollapsedFlag(state.collapsedSubagentRunListBySession, key, collapsed);
          return next === state.collapsedSubagentRunListBySession
            ? state
            : { collapsedSubagentRunListBySession: next };
        }),
      activeChildSessionIdBySession: {},
      setActiveChildSessionId: (sessionId, childSessionId) =>
        set((state) => {
          const key = sessionSubviewKey(sessionId);
          const next = withActiveChildSessionId(
            state.activeChildSessionIdBySession,
            key,
            childSessionId,
          );
          return next === state.activeChildSessionIdBySession
            ? state
            : { activeChildSessionIdBySession: next };
        }),
      forgetSessionSubviews: (sessionIds) =>
        set((state) => {
          const forgotten = forgetSessionSubviews(
            state.collapsedSubagentRunListBySession,
            state.activeChildSessionIdBySession,
            sessionIds,
          );
          if (!forgotten.changed) {
            return state;
          }
          return {
            collapsedSubagentRunListBySession: forgotten.collapsed,
            activeChildSessionIdBySession: forgotten.active,
          };
        }),

      // File tree
      expandedDirsBySession: {},
      setExpandedDirsForSession: (sessionKey, dirs) =>
        set((state) => {
          const key = normalizeExpandedDirsSessionKey(sessionKey);
          const next = { ...state.expandedDirsBySession };
          if (dirs.length > 0) {
            next[key] = dirs;
          } else {
            delete next[key];
          }
          return { expandedDirsBySession: next };
        }),

      fileTreeRootPath: null,
      setFileTreeRootPath: (path) => set({ fileTreeRootPath: path }),
      workspaceTreeVersion: 0,
      bumpWorkspaceTreeVersion: () =>
        set((state) => ({ workspaceTreeVersion: state.workspaceTreeVersion + 1 })),
      savedWorkspaces: [],
      addSavedWorkspace: (workspace) =>
        set((state) => {
          const identity = toWorkspaceIdentity(workspace);
          if (!identity) {
            return state;
          }

          return {
            savedWorkspaces: [
              identity,
              ...state.savedWorkspaces.filter((entry) => !isSameWorkspace(entry, identity)),
            ],
          };
        }),
      mergeSavedWorkspaces: (workspaces) =>
        set((state) => {
          const identities = workspaces
            .map((workspace) => toWorkspaceIdentity(workspace))
            .filter((identity): identity is WorkspaceIdentity => identity !== null);
          if (identities.length === 0) {
            return state;
          }

          const mergedKeys = new Set(identities.map(toWorkspaceIdentityKey));

          // 反推的身份来自会话 metadata，是权威信息。旧结构（v27 及更早）的
          // `savedWorkspacePaths` 没有连接维度，迁移时只能一律按本地归一，于是远端
          // 目录会留下一条「本地 /srv/app」的残条；它会混进本地投影，被工作区选择器
          // 当成本机目录绑定，重新制造「远端工作区变成本地路径」的问题。
          //
          // 这里以反推结果为准清理：某路径只有远端证据（没有本地会话）时，删掉同路径
          // 的本地残条；同路径本地、远端都有会话则两者都是真实工作区，必须都保留。
          //
          // 已知限制：若某个远端工作区已无任何会话，其残条会缺少证据而残留，直到用户
          // 再次在该主机上创建会话或手动移除。
          const locallyEvidencedPaths = new Set(
            identities
              .filter((identity) => identity.sshConnectionId === null)
              .map((identity) => identity.workspacePath),
          );
          const supersededLocalPaths = new Set(
            identities
              .filter(
                (identity) =>
                  identity.sshConnectionId !== null &&
                  !locallyEvidencedPaths.has(identity.workspacePath),
              )
              .map((identity) => identity.workspacePath),
          );

          const nextSavedWorkspaces = [
            ...identities,
            ...state.savedWorkspaces.filter(
              (entry) =>
                !mergedKeys.has(toWorkspaceIdentityKey(entry)) &&
                !(entry.sshConnectionId === null && supersededLocalPaths.has(entry.workspacePath)),
            ),
          ];

          const nextIdentityKeys = nextSavedWorkspaces.map(toWorkspaceIdentityKey);
          const currentIdentityKeys = state.savedWorkspaces.map(toWorkspaceIdentityKey);
          if (
            nextIdentityKeys.length === currentIdentityKeys.length &&
            nextIdentityKeys.every((key, index) => key === currentIdentityKeys[index])
          ) {
            return state;
          }

          return {
            savedWorkspaces: nextSavedWorkspaces,
          };
        }),
      removeSavedWorkspace: (workspace) =>
        set((state) => {
          const targetKey = toWorkspaceIdentityKey(workspace);
          const removedPath =
            normalizeWorkspacePath(workspace.workspacePath) ??
            state.savedWorkspaces.find((entry) => toWorkspaceIdentityKey(entry) === targetKey)
              ?.workspacePath ??
            null;
          if (!removedPath) {
            return state;
          }

          return {
            savedWorkspaces: state.savedWorkspaces.filter(
              (entry) => toWorkspaceIdentityKey(entry) !== targetKey,
            ),
            // 选中态与文件树根随「同一个工作区」一起清除；本地工作区的连接维度
            // 恒为 null，这里只比对连接 id，避免误清另一台主机的选中项。
            selectedWorkspacePath:
              state.selectedWorkspacePath === removedPath &&
              (state.selectedSshConnectionId ?? null) === (workspace.sshConnectionId ?? null)
                ? null
                : state.selectedWorkspacePath,
            fileTreeRootPath:
              state.fileTreeRootPath === removedPath ? null : state.fileTreeRootPath,
          };
        }),
      selectedWorkspacePath: null,
      setSelectedWorkspacePath: (path) =>
        set({ selectedWorkspacePath: path ? normalizeWorkspacePath(path) : null }),
      selectedSshConnectionId: null,
      setSelectedSshConnectionId: (connectionId) => set({ selectedSshConnectionId: connectionId }),
      activeSessionWorkspace: null,
      setActiveSessionWorkspace: (sessionId, path, sshConnectionId = null) =>
        set((state) => ({
          activeSessionWorkspace: {
            sessionId,
            path: path ? normalizeWorkspacePath(path) : null,
            sshConnectionId,
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
      readIdentity: EMPTY_READ_IDENTITY,
      setReadIdentity: (identity) => set({ readIdentity: identity }),
      clearReadIdentity: () => set({ readIdentity: EMPTY_READ_IDENTITY }),

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
      sidePanelActiveTab: DEFAULT_SIDE_PANEL_ACTIVE_TAB,
      setSidePanelActiveTab: (tab) =>
        set((state) => ({
          sidePanelActiveTab: tab,
          sidePanelActiveTabBySession: withSidePanelActiveTab(
            state.sidePanelActiveTabBySession,
            terminalPanelSessionKeyFor(state.lastChatPath),
            tab,
          ),
        })),
      sidePanelActiveTabBySession: {},
      browserPreviewSurface: 'editor',
      setBrowserPreviewSurface: (surface) => set({ browserPreviewSurface: surface }),
      resetBrowserPreviewView: () =>
        set((state) => {
          // 只把停在 browser 的桶拉回 code，保留每个工作区各自的代码 / 预览偏好。
          const editorPaneTabByWorkspace: Record<string, 'code' | 'browser'> = {};
          for (const [key, tab] of Object.entries(state.editorPaneTabByWorkspace)) {
            editorPaneTabByWorkspace[key] = tab === 'browser' ? 'code' : tab;
          }
          const sidePanelActiveTab: SidePanelActiveTab =
            state.sidePanelActiveTab === 'preview' || state.sidePanelActiveTab === 'browser'
              ? 'review'
              : state.sidePanelActiveTab;
          return {
            editorMode: false,
            editorFullScreen: false,
            editorPaneTabByWorkspace,
            browserActive: false,
            sidePanelActiveTab,
            // 桶是唯一真相源：只改镜像会让下次换镜时按旧桶把 preview 重新载回来。
            sidePanelActiveTabBySession: withSidePanelActiveTab(
              state.sidePanelActiveTabBySession,
              terminalPanelSessionKeyFor(state.lastChatPath),
              sidePanelActiveTab,
            ),
          };
        }),
      terminalPanelOpened: false,
      terminalPanelOpenedBySession: {},
      setTerminalPanelOpened: (opened) =>
        set((state) => ({
          terminalPanelOpened: opened,
          terminalPanelOpenedBySession: {
            ...state.terminalPanelOpenedBySession,
            [terminalPanelSessionKeyFor(state.lastChatPath)]: opened,
          },
        })),
      toggleTerminalPanelOpened: () =>
        set((state) => {
          const nextOpened = !state.terminalPanelOpened;
          return {
            terminalPanelOpened: nextOpened,
            terminalPanelOpenedBySession: {
              ...state.terminalPanelOpenedBySession,
              [terminalPanelSessionKeyFor(state.lastChatPath)]: nextOpened,
            },
          };
        }),
      terminalPanelHeight: TERMINAL_PANEL_HEIGHT_BOUNDS.default,
      terminalPanelHeightCustomized: false,
      setTerminalPanelHeight: (height) =>
        set({
          terminalPanelHeight: clampTerminalPanelHeightToBounds(
            height,
            TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS,
          ),
          terminalPanelHeightCustomized: true,
        }),

      terminalPanelPosition: 'bottom',
      setTerminalPanelPosition: (position) => set({ terminalPanelPosition: position }),

      terminalPanelMaximized: false,
      setTerminalPanelMaximized: (opened) => set({ terminalPanelMaximized: opened }),
      toggleTerminalPanelMaximized: () =>
        set((state) => ({ terminalPanelMaximized: !state.terminalPanelMaximized })),

      terminalLayoutBySession: {},
      setTerminalLayoutForSession: (sessionKey, layout) =>
        set((state) => {
          const key = terminalPanelSessionKeyFor(sessionKey);
          const next = { ...state.terminalLayoutBySession };
          // null（= 无分屏）与「键不存在」在读取端等价，删除键而不是写 null，
          // 避免持久化数据无意义膨胀（与 setExpandedDirsForSession 同口径）。
          if (layout === null) {
            delete next[key];
          } else {
            next[key] = layout;
          }
          return { terminalLayoutBySession: next };
        }),

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
      name: UI_STATE_STORAGE_KEY,
      // v29：新增「会话内子视图」按会话分桶（子代理运行列表折叠 / 当前查看的子会话）。
      version: 29,
      // editorMode 不持久化——每次启动默认关闭；reviewPanelOpened 现已作为布局偏好
      // 持久化（刷新后保持上次展开态，缺省与脏数据回落 false，见 merge 兜底）。
      // closedSessionTabIds 属于瞬态标记（只在路由切走前有效），同样不持久化。
      // readIdentity 属于会话瞬态身份（SSH 绑定），绝不能落盘。
      partialize: (state) => {
        const {
          editorMode: _em,
          closedSessionTabIds: _cs,
          browserPreviewSurface: _bps,
          readIdentity: _ri,
          // 最大化是瞬态视图模式：高度偏好单独存在 terminalPanelHeight，
          // 这个标记绝不能泄漏进存储（否则下次启动会直接回到占满态）。
          terminalPanelMaximized: _tpm,
          ...rest
        } = state;
        return rest as typeof state;
      },
      merge: (persistedState, currentState) => {
        const merged: typeof currentState & { sidePanelWorkspaceTab?: unknown } = {
          ...currentState,
          ...(persistedState as object),
        };
        // 已移除的旧键「工作区子视图」（sidePanelWorkspaceTab）：旧持久化数据里可能
        // 残留，显式丢弃，避免未知键回流存储；渲染端不再读取它，丢弃即可（无害化）。
        delete merged.sidePanelWorkspaceTab;
        // reviewPanelOpened 是持久化的布局偏好：保留存储值。旧版本未持久化该键时，
        // spread 已让 currentState 的默认 false 生效；同版本手改出的非布尔脏数据
        // 同样在载入期回落 false（不经 migrate 也不能穿到渲染期）。
        if (typeof merged.reviewPanelOpened !== 'boolean') {
          merged.reviewPanelOpened = false;
        }
        // 停靠面板 tab 是持久化偏好：只有已知成员才放行，手改 / 旧版本的未知
        // 值一律回落审查，避免渲染期出现空面板或选不中的 tab。
        if (!isSidePanelActiveTab(merged.sidePanelActiveTab)) {
          merged.sidePanelActiveTab = 'review';
        }
        // 按会话分桶的 tab 同源校验：旧版本没有该键（默认空桶），同版本脏数据
        // 里的非法条目逐条丢弃——该会话切回时按缺省回落审查。
        merged.sidePanelActiveTabBySession = normalizeSidePanelActiveTabBySession(
          merged.sidePanelActiveTabBySession,
        );
        // 会话内子视图（子代理列表折叠 / 当前查看的子会话）同样按会话分桶：
        // 远端快照回灌时 `uiStateVersion` 已是最新，不会走 migrate，校验必须放在
        // merge 才能挡住手改与旧版本脏数据。
        merged.collapsedSubagentRunListBySession = normalizeCollapsedFlags(
          merged.collapsedSubagentRunListBySession,
        );
        merged.activeChildSessionIdBySession = normalizeActiveChildSessionIds(
          merged.activeChildSessionIdBySession,
        );
        merged.editorMode = false;
        merged.closedSessionTabIds = [];
        // 瞬态身份：无论存储里出现什么（旧数据 / 手改 / 上一个标签页残留），
        // 启动态一律回到空身份，避免跨会话把上一会话的 SSH 绑定带进来。
        merged.readIdentity = EMPTY_READ_IDENTITY;
        // 瞬态模式：无论存储里出现什么（旧数据 / 手改），启动态一律 false。
        merged.terminalPanelMaximized = false;
        // 工作区身份列表：同 v28 脏数据（手改存储）也可能残留旧键或非法结构，
        // 这里统一归一并丢弃旧键，保证非法值进不了渲染期。
        merged.savedWorkspaces = normalizeWorkspaceIdentities(merged.savedWorkspaces);
        delete (merged as unknown as Record<string, unknown>).savedWorkspacePaths;
        // 覆盖方向是 persisted 盖 currentState，所以 currentState 的空桶不会冲掉已持久化的
        // 布局；但同 version 的脏数据不会走 migrate，这里再兜一次结构校验，保证任何来源的
        // 非法桶值都进不了 state（成本只有一次小块遍历）。
        merged.terminalLayoutBySession = normalizeTerminalLayoutBySession(
          merged.terminalLayoutBySession,
        );
        // 同 v26 脏数据（手改存储）也不能让非布尔值穿到渲染期。
        if (typeof merged.terminalPanelHeightCustomized !== 'boolean') {
          merged.terminalPanelHeightCustomized = false;
        }
        // 停靠位置同源兜底：非成员值退回底部，避免未知字符串把外壳切进横向分栏。
        if (!isTerminalPanelPosition(merged.terminalPanelPosition)) {
          merged.terminalPanelPosition = 'bottom';
        }
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

        // v22:会话侧栏折叠的工作区分组改为持久化状态。
        if (version < 22) {
          nextState.collapsedSessionGroups = [];
        }

        // v23:文件树展开目录从全局单数组改为按会话分桶,切换会话时各自恢复,
        // 切回旧会话仍保持展开。旧全局值归入 __default__ 桶。
        if (version < 23) {
          const legacyExpandedDirs = isStringArray(nextState.expandedDirs)
            ? nextState.expandedDirs
            : [];
          delete nextState.expandedDirs;
          nextState.expandedDirsBySession =
            legacyExpandedDirs.length > 0
              ? { [DEFAULT_EXPANDED_DIRS_SESSION_KEY]: legacyExpandedDirs }
              : {};
        }

        // v24:终端面板打开状态从全局单值改为按会话分桶,切到新会话时不再沿用上一个
        // 会话的展开态。旧全局值归入 __default__ 桶(沿用 v10 惯例:只有 true 值得归档,
        // false 与缺省等价);terminalPanelOpened 字段本身保留——它现在是当前会话的
        // 镜像,消费端读取路径不变。
        if (version < 24) {
          nextState.terminalPanelOpenedBySession =
            nextState.terminalPanelOpened === true
              ? { [DEFAULT_TERMINAL_PANEL_SESSION_KEY]: true }
              : {};
        }

        // v25:终端分屏布局按会话分桶。分屏能力本轮才引入,没有旧字段可迁移,只初始化空桶;
        // 键必须复用 terminalPanelSessionKeyFor(与 terminalPanelOpenedBySession 同源),
        // 否则同一会话会出现两把钥匙。实际桶值由 layout/use-terminal-layout 的用户操作写入。
        if (version < 25) {
          nextState.terminalLayoutBySession = {};
        }

        // v26:终端面板高度改为「视口相对默认 + 用户自定义标记」。老数据一律视为未自定义,
        // 让老用户也拿到按视口计算的合理默认高;高度值本身仍按持久化域 bounds 钳制。
        if (version < 26) {
          nextState.terminalPanelHeightCustomized = false;
        }

        // v27:会话侧栏新增「按父会话折叠子代理列表」状态,首次引入无旧值可迁移,只初始化空数组。
        if (version < 27) {
          nextState.collapsedSubagentParentIds = [];
        }

        // v28:savedWorkspacePaths(裸路径数组)更名为 savedWorkspaces(工作区身份数组),
        // 为的是让闲置工作区占位组也带上 SSH 连接维度——远端目录路径只在单台主机内唯一,
        // 旧结构会让两台服务器的同名目录共用同一个占位组并重新合并。旧值按本地工作区
        // 归一(丢失的远端身份会在会话列表反推时补回),并清掉旧键避免脏数据回灌。
        if (version < 28) {
          const legacyWorkspacePaths = nextState.savedWorkspacePaths;
          delete nextState.savedWorkspacePaths;
          nextState.savedWorkspaces = Array.isArray(legacyWorkspacePaths)
            ? legacyWorkspacePaths.filter((entry): entry is string => typeof entry === 'string')
            : [];
        }

        // 迁移之外仍需归一:旧格式与同版本手改 / 未来脏数据都不会被上面的分支覆盖。
        nextState.savedWorkspaces = normalizeWorkspaceIdentities(nextState.savedWorkspaces);

        nextState.expandedDirsBySession = normalizeExpandedDirsBySession(
          nextState.expandedDirsBySession,
        );

        // v29:会话内子视图（子代理运行列表折叠 / 当前查看的子会话）改为按会话分桶
        // 持久化，随工作台快照同步。首次引入无旧值可迁移，只初始化空桶。
        if (version < 29) {
          nextState.collapsedSubagentRunListBySession = {};
          nextState.activeChildSessionIdBySession = {};
        }

        nextState.collapsedSubagentRunListBySession = normalizeCollapsedFlags(
          nextState.collapsedSubagentRunListBySession,
        );
        nextState.activeChildSessionIdBySession = normalizeActiveChildSessionIds(
          nextState.activeChildSessionIdBySession,
        );

        if (!isStringArray(nextState.collapsedSessionGroups)) {
          nextState.collapsedSessionGroups = [];
        }

        if (!isStringArray(nextState.collapsedSubagentParentIds)) {
          nextState.collapsedSubagentParentIds = [];
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

        nextState.terminalPanelHeight = clampTerminalPanelHeightToBounds(
          typeof nextState.terminalPanelHeight === 'number'
            ? nextState.terminalPanelHeight
            : TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS.default,
          TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS,
        );

        if (typeof nextState.terminalPanelHeightCustomized !== 'boolean') {
          nextState.terminalPanelHeightCustomized = false;
        }

        // 停靠位置是新增键（未提升 version，merge 的 spread 已兜住缺省），这里只做成员校验。
        if (!isTerminalPanelPosition(nextState.terminalPanelPosition)) {
          nextState.terminalPanelPosition = 'bottom' satisfies TerminalPanelPosition;
        }

        if (typeof nextState.terminalPanelOpened !== 'boolean') {
          nextState.terminalPanelOpened = false;
        }

        nextState.terminalPanelOpenedBySession = normalizeTerminalPanelOpenedBySession(
          nextState.terminalPanelOpenedBySession,
        );

        nextState.terminalLayoutBySession = normalizeTerminalLayoutBySession(
          nextState.terminalLayoutBySession,
        );

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

/**
 * 读取当前工作区文件读取身份（瞬态 slice）。
 *
 * 直接返回 store 中的不可变对象引用；写入方通过 `setReadIdentity` 整体替换，
 * 因此引用变化即「身份发生变化」，不会出现就地修改导致的漏更新。
 */
export function useWorkspaceReadIdentity(): WorkspaceReadIdentity {
  return useUIStateStore((s) => s.readIdentity);
}

/**
 * 本地工作区路径清单（`savedWorkspaces` 中本地部分的投影）。
 *
 * 相当一部分消费方语义上就是「本地目录」——文件树根、工作区快捷选择菜单、
 * 会话 warp 候选列表——它们不需要 SSH 维度。把它们投影成 `string[]` 既保持
 * 原有类型与调用方式，又避免为同一份数据另开一个本地路径清单（两份数据源必然漂移）。
 *
 * 用 `useShallow` 做浅比较：内容不变时返回同一引用，避免每次 store 变更都重建数组。
 */
export function useLocalSavedWorkspacePaths(): string[] {
  return useUIStateStore(
    useShallow((state) =>
      state.savedWorkspaces.flatMap((workspace) =>
        workspace.sshConnectionId === null && workspace.workspacePath !== null
          ? [workspace.workspacePath]
          : [],
      ),
    ),
  );
}

// ── 跨设备快照（工作台状态同步）─────────────────────────────────────

/**
 * 立即把节流中的本地写入落盘。
 *
 * 应用远端快照前必须调用：throttledStorage 的 `getItem` 会优先返回尚未落盘的
 * `pendingValue`，不先 flush，刚写进去的远端快照会被 200ms 内的旧值盖掉。
 */
export function flushPersistedUiStateNow(): void {
  flushPending();
}

/**
 * 读取当前持久化快照（与 `localStorage` 里的 `{ state, version }` 同形）。
 *
 * 直接复用 persist 的 `partialize`：同步的内容与本地持久化天然一致，新增布局字段
 * 不需要在两处各维护一份白名单。动作函数不可序列化，这里顺手剔掉。
 */
export function readPersistedUiStateSnapshot(): {
  state: Record<string, unknown>;
  version: number;
} {
  const options = useUIStateStore.persist.getOptions();
  const partialized = options.partialize
    ? options.partialize(useUIStateStore.getState())
    : useUIStateStore.getState();
  const state: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(partialized as Record<string, unknown>)) {
    if (typeof value === 'function') continue;
    state[key] = value;
  }
  return { state, version: options.version ?? 0 };
}

/**
 * 把服务端快照写回本地并重新水合。
 *
 * 走「写 localStorage + rehydrate」而不是直接 `setState`：持久化中间件会在水合时
 * 跑 `migrate` 与 `merge` 兜底（瞬态字段清零、脏桶归一、版本迁移），直接 setState
 * 会绕过全部校验。
 */
export async function applyPersistedUiStateSnapshot(
  state: Record<string, unknown>,
  version: number,
): Promise<void> {
  if (typeof window === 'undefined') return;
  flushPersistedUiStateNow();
  try {
    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ state, version }));
  } catch {
    return;
  }
  await useUIStateStore.persist.rehydrate();
}
