import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TerminalLayout } from '../../components/chat/terminal/layout/types.js';

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

/**
 * 工作区文件读取身份：SSH 会话 / 草稿远程工作区在读取文件时必须把身份带给网关，
 * 网关才能把（远端 POSIX）路径解析到对应连接，而不是按本地工作区校验。
 *
 * - `sessionId`：已有会话的 id（网关沿父会话链解析 SSH 绑定）；
 * - `sshConnectionId`：草稿态（还没有会话 id）选中的 SSH 连接 id；
 * - `remote`：当前身份是否指向远端工作区（仅作提示，不参与请求参数）。
 *
 * 这是**瞬态** slice：不持久化，且在 merge 阶段强制重置，避免跨会话串味。
 */
export interface WorkspaceReadIdentity {
  readonly sessionId: string | null;
  readonly sshConnectionId: string | null;
  readonly remote: boolean;
}

/** 空身份：本地工作区读取路径的默认值。 */
export const EMPTY_READ_IDENTITY: WorkspaceReadIdentity = {
  sessionId: null,
  sshConnectionId: null,
  remote: false,
};

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
  /**
   * 草稿「转正」后移除草稿标签：会话在用户发出首条消息时才真正创建，
   * 创建成功后草稿标签由真实会话标签接替，标签栏不残留空对话入口。
   */
  closeDraftTabs: () => void;
  closeTab: (tabId: string) => SessionTab | null;
  /** 关闭一组标签页（顶部标签栏「关闭其他 / 关闭全部」），返回关闭后应激活的标签页。 */
  closeTabs: (tabIds: readonly string[]) => SessionTab | null;
  /** 关闭指定会话对应的标签页（会话列表删除会话时联动调用），返回关闭后应激活的标签页。 */
  closeSessionTabs: (sessionIds: readonly string[]) => SessionTab | null;
  /**
   * 最近被关闭（含会话被删除）但路由可能仍停留在其上的会话 id。
   * 顶部标签栏的路由同步 effect 会跳过它们，避免在路由切走前把已关闭的标签页重建回来。
   * 纯瞬态字段，不持久化。
   */
  closedSessionTabIds: string[];
  clearClosedSessionTabIds: () => void;
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

  /** 会话侧栏中被折叠的工作区分组键（持久化，跨会话保留折叠状态）。 */
  collapsedSessionGroups: string[];
  toggleSessionGroupCollapsed: (groupKey: string) => void;

  /** 会话侧栏中被折叠子代理列表的父会话 ID（持久化，跨刷新保留折叠状态）。 */
  collapsedSubagentParentIds: string[];
  toggleSubagentCollapsed: (parentSessionId: string) => void;
  /**
   * 仅保留仍作为父会话存在的 ID，剪除已删除 / 不再有子代理的残留项。
   * 仅应在调用方确认会话列表完整时使用；无变化时返回原 state，
   * 避免多余的订阅通知与渲染。
   */
  retainSubagentCollapsed: (keepParentSessionIds: readonly string[]) => void;

  // File tree
  /** 文件树已展开目录，按会话分桶持久化；无会话时落到 `__default__` 桶。 */
  expandedDirsBySession: Record<string, string[]>;
  /** 写入指定会话桶的展开目录；传空数组会删除该桶。 */
  setExpandedDirsForSession: (sessionKey: string | null | undefined, dirs: string[]) => void;

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
  /**
   * 草稿会话的 SSH 工作区连接：非空表示当前选中的工作区是「SSH 远端目录」
   * （`selectedWorkspacePath` 此时存放远端绝对路径）。创建会话时写入
   * metadata.sshConnectionId，网关在创建时自动完成会话↔连接绑定。
   */
  selectedSshConnectionId: string | null;
  setSelectedSshConnectionId: (connectionId: string | null) => void;
  activeSessionWorkspace: {
    sessionId: string;
    path: string | null;
    version: number;
  } | null;
  setActiveSessionWorkspace: (sessionId: string, path: string | null) => void;
  clearActiveSessionWorkspace: (sessionId?: string) => void;

  /**
   * 当前页面的工作区文件读取身份（瞬态，不持久化）。
   * 由 ChatPage / TeamConversationView 在会话切换时写入，卸载时清空；
   * 读取消费方（文件编辑器 / 预览）据此给 `/workspace/file` 附加 SSH 身份。
   */
  readIdentity: WorkspaceReadIdentity;
  setReadIdentity: (identity: WorkspaceReadIdentity) => void;
  clearReadIdentity: () => void;

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
  /**
   * Fusion 布局下停靠会话面板（审查 / 子代理 / 代码 / 预览 / Context）当前一级 tab。
   * 联合类型与 `SessionSidePanel` 的 `SidePanelTabId` 保持一致：`files` /
   * `browser` 只属于移动端底部面板，桌面端会在渲染前收敛到 `code` / `preview`；
   * `agent` 只属于桌面停靠面板，移动端渲染前收敛回 `review`。
   */
  sidePanelActiveTab: SidePanelActiveTab;
  setSidePanelActiveTab: (tab: SidePanelActiveTab) => void;
  /**
   * 单一浏览器互斥标记：`BuiltInBrowser` 持有网关实时会话，全应用同一时刻最多
   * 只能挂载一个实例。停靠面板的浏览器 tab 挂载时声明 'dock'，卸载时归还
   * 'editor'；编辑器面板据此在停靠面板持有浏览器期间不挂载自己的浏览器。
   * 瞬态字段，不持久化（见 partialize）。
   */
  browserPreviewSurface: 'editor' | 'dock';
  setBrowserPreviewSurface: (surface: 'editor' | 'dock') => void;
  /**
   * 终端面板打开状态的镜像值——始终等于「当前会话桶」里的值。
   * 之所以保留这个全局布尔字段：TerminalPanel / ChatPage 等消费端不允许改动，
   * 按会话隔离必须完全收敛在 store 内部；会话切换时由 setLastChatPath 负责换镜。
   */
  terminalPanelOpened: boolean;
  setTerminalPanelOpened: (opened: boolean) => void;
  toggleTerminalPanelOpened: () => void;
  /**
   * 终端面板打开状态按会话分桶，键为规范化后的完整 chat path（见
   * terminalPanelSessionKeyFor），无 chat path 时归入 __default__ 桶。
   */
  terminalPanelOpenedBySession: Record<string, boolean>;
  terminalPanelHeight: number;
  /** 用户是否手动拖拽过高度：false 时渲染期按视口给默认高，true 时记住用户的值。 */
  terminalPanelHeightCustomized: boolean;
  setTerminalPanelHeight: (height: number) => void;
  /**
   * 终端面板停靠位置：'bottom'（底部抽屉，默认）/ 'left' / 'right'（工作台侧列）。
   *
   * 与瞬态的 `terminalPanelMaximized` 不同，停靠位置是**用户布局偏好**，持久化；
   * 但它只描述「停在哪里」，不携带任何像素几何 —— 侧列宽度由 CSS 的 clamp 决定
   * （相对工作台的百分比决策），底栏高度才存 `terminalPanelHeight`。
   * 窄视口下的降级不写回本字段：见 resolveEffectiveTerminalPanelPosition。
   */
  terminalPanelPosition: TerminalPanelPosition;
  setTerminalPanelPosition: (position: TerminalPanelPosition) => void;
  /**
   * 终端面板最大化（对齐 VS Code「Toggle Maximized Panel」）。
   *
   * 设计取舍：
   *  - **瞬态**：刷新后总是回到 false —— 最大化是「临时占满工作台」的视图模式，
   *    持久化它只会在下次启动时留下一个用户早已忘记的占满态；
   *  - **只提供还原路径**：最大化下不渲染拖拽手柄（见 QuickTerminalPanel），
   *    不做 VS Code 的「拖动即还原」，避免与持久化高度域的 900px 上限产生钳制跳变；
   *  - 高度偏好单独存在 `terminalPanelHeight` 里，最大化期间绝不改写它，
   *    还原时据此精确回到用户此前的高度。
   */
  terminalPanelMaximized: boolean;
  setTerminalPanelMaximized: (opened: boolean) => void;
  toggleTerminalPanelMaximized: () => void;
  /**
   * 终端分屏布局按会话分桶，键与 terminalPanelOpenedBySession 同源（见
   * terminalPanelSessionKeyFor），避免同一会话出现两把钥匙。
   *
   * store **只存结构合法的树**：不做任何布局计算（归一 / 变更全部落在
   * components/chat/terminal/layout/ 纯函数层），载入期只做结构校验，
   * 非法桶值整条丢弃（见 normalizeTerminalLayoutBySession）。
   */
  terminalLayoutBySession: Record<string, TerminalLayout | null>;
  setTerminalLayoutForSession: (sessionKey: string, layout: TerminalLayout | null) => void;

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

export const DEFAULT_EXPANDED_DIRS_SESSION_KEY = '__default__';

/** 稳定引用：zustand selector 缺省返回它，避免每次渲染生成新数组触发重渲染。 */
export const EMPTY_EXPANDED_DIRS: readonly string[] = [];

export function normalizeExpandedDirsSessionKey(sessionKey: string | null | undefined): string {
  const trimmed = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_EXPANDED_DIRS_SESSION_KEY;
}

function normalizeExpandedDirsBySession(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isStringArray(entry) && entry.length > 0) {
      next[key] = entry;
    }
  }
  return next;
}

export const DEFAULT_TERMINAL_PANEL_SESSION_KEY = '__default__';

/**
 * 会话桶键直接用规范化后的完整 chat path（`/chat` 与 `/chat/<id>` 因此天然分桶），
 * 不再解析 sessionId——少一处易错解析，且键与 lastChatPath 的形态一一对应。
 */
export function terminalPanelSessionKeyFor(lastChatPath: string | null): string {
  const normalized = lastChatPath?.trim() ?? '';
  return normalized.length > 0 ? normalized : DEFAULT_TERMINAL_PANEL_SESSION_KEY;
}

/** 终端面板停靠位置：底部抽屉 / 工作台左侧列 / 工作台右侧列。 */
export type TerminalPanelPosition = 'bottom' | 'left' | 'right';

/** 停靠位置的唯一事实来源：校验、菜单渲染都从这里取成员，禁止各处手写字面量。 */
export const TERMINAL_PANEL_POSITIONS: readonly TerminalPanelPosition[] = [
  'bottom',
  'left',
  'right',
];

/**
 * 持久化数据（用户可手改 localStorage）里的任何非成员值都必须退回底部：
 * 侧停靠会让外壳切到横向分栏，一个未知字符串穿到渲染期就是一处静默的布局错乱。
 */
function isTerminalPanelPosition(value: unknown): value is TerminalPanelPosition {
  return TERMINAL_PANEL_POSITIONS.some((candidate) => candidate === value);
}

export const SIDE_PANEL_ACTIVE_TABS = [
  'review',
  'agent',
  'code',
  'preview',
  'context',
  'files',
  'browser',
] as const;

export type SidePanelActiveTab = (typeof SIDE_PANEL_ACTIVE_TABS)[number];

/** 未知 tab id 会把面板渲染成一个没有选中项的空白壳，载入期直接判非法。 */
function isSidePanelActiveTab(value: unknown): value is SidePanelActiveTab {
  return SIDE_PANEL_ACTIVE_TABS.some((candidate) => candidate === value);
}

/**
 * 「窄视口降级为底部」的**唯一实现**：<768px 时工作台自身已经没有可让出的宽度，
 * 侧停靠会把对话区挤到不可用，因此面板与外壳共用这一条判据（两者各自只负责
 * 用既有 hook 拿到 isNarrowViewport），避免同一规则出现两份可能漂移的写法。
 */
export function resolveEffectiveTerminalPanelPosition(
  position: TerminalPanelPosition,
  isNarrowViewport: boolean,
): TerminalPanelPosition {
  return isNarrowViewport ? 'bottom' : position;
}

/**
 * 桶值非布尔直接丢弃，而不是归一为 false：false 与「键不存在」在读取端语义等价，
 * 保留垃圾值只会让持久化数据膨胀。
 */
function normalizeTerminalPanelOpenedBySession(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'boolean') {
      next[key] = entry;
    }
  }
  return next;
}

/**
 * 终端布局载入期结构校验的三道硬限制。
 *
 * localStorage 是用户可写介质，持久化数据可能被手工篡改成**深递归炸弹**或超大对象；
 * 递归校验若不预算，会在水合阶段爆栈 / 长时间占满主线程。三条限制在递归前先建立，
 * 任一违反即**丢弃该会话的布局**（不抛错，只 warn 一次）——脏数据只该让该会话退回
 * 单组，不该阻断整个 store 水合。
 */
export const TERMINAL_LAYOUT_MAX_DEPTH = 32;
export const TERMINAL_LAYOUT_MAX_NODES = 64;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface TerminalLayoutBudget {
  /** 剩余可计数的节点预算，递归过程中递减；归零即中止。 */
  nodes: number;
}

/** pane：`terminalIds` 非空字符串数组且 `activeTerminalId` ∈ `terminalIds`。 */
function isValidTerminalPaneShape(node: Record<string, unknown>): boolean {
  if (typeof Reflect.get(node, 'id') !== 'string') return false;
  const terminalIds = Reflect.get(node, 'terminalIds');
  if (!Array.isArray(terminalIds) || terminalIds.length === 0) return false;
  if (!terminalIds.every((terminalId) => typeof terminalId === 'string')) return false;
  const activeTerminalId = Reflect.get(node, 'activeTerminalId');
  return typeof activeTerminalId === 'string' && terminalIds.includes(activeTerminalId);
}

function isValidTerminalSplitShape(
  node: Record<string, unknown>,
  depth: number,
  budget: TerminalLayoutBudget,
): boolean {
  if (typeof Reflect.get(node, 'id') !== 'string') return false;
  const direction = Reflect.get(node, 'direction');
  if (direction !== 'row' && direction !== 'column') return false;
  // 硬限制三：`ratio` 必须是有限数（NaN / ±Infinity / 非 number 一律非法）。
  const ratio = Reflect.get(node, 'ratio');
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return false;
  const children = Reflect.get(node, 'children');
  if (!Array.isArray(children) || children.length !== 2) return false;
  const [left, right] = children;
  return (
    isValidTerminalLayoutNodeShape(left, depth + 1, budget) &&
    isValidTerminalLayoutNodeShape(right, depth + 1, budget)
  );
}

function isValidTerminalLayoutNodeShape(
  value: unknown,
  depth: number,
  budget: TerminalLayoutBudget,
): boolean {
  // 硬限制一（最大深度）与二（最大节点数）先于任何对象访问，避免深链 / 巨物。
  if (depth > TERMINAL_LAYOUT_MAX_DEPTH) return false;
  if (budget.nodes <= 0) return false;
  if (!isPlainRecord(value)) return false;
  budget.nodes -= 1;

  const kind = Reflect.get(value, 'kind');
  if (kind === 'pane') return isValidTerminalPaneShape(value);
  if (kind === 'split') return isValidTerminalSplitShape(value, depth, budget);
  return false;
}

function isValidTerminalLayoutShape(value: unknown): boolean {
  if (value === null) return true;
  return isValidTerminalLayoutNodeShape(value, 1, { nodes: TERMINAL_LAYOUT_MAX_NODES });
}

/**
 * 逐桶做结构校验：非法形状的桶**整条丢弃**（该会话回到「无分屏」）并 warn 一次。
 * 与 normalizeTerminalPanelOpenedBySession 同口径：保留垃圾只会让持久化膨胀。
 * 注意这里只做**形状**校验，不做归一（ratio 合法性交给 layout/normalize.ts 渲染期处理）。
 */
function normalizeTerminalLayoutBySession(value: unknown): Record<string, TerminalLayout | null> {
  if (!isPlainRecord(value)) return {};

  const next: Record<string, TerminalLayout | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isValidTerminalLayoutShape(entry)) {
      next[key] = entry as TerminalLayout;
    } else {
      console.warn(`[uiState] 丢弃结构非法的终端布局桶: ${key}`);
    }
  }
  return next;
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
/** 视口相对上限：面板最多占视口 72%，永远给聊天区留 ≥28%。 */
const TERMINAL_PANEL_VIEWPORT_MAX_RATIO = 0.72;
/** 视口相对默认高度：对齐 VS Code「面板约占编辑区 1/3」。 */
const TERMINAL_PANEL_VIEWPORT_DEFAULT_RATIO = 0.35;
/** 高度绝对上限：再高已接近全屏，拖拽与持久化共享同一个天花板。 */
const TERMINAL_PANEL_ABSOLUTE_MAX_HEIGHT = 900;
/** min 之上的最小 headroom，保证极矮视口下 max 仍高于 min。 */
const TERMINAL_PANEL_MIN_HEADROOM = 120;
/** default 相对 min 的最小 headroom，保证 default 与 min 不会挤在一起。 */
const TERMINAL_PANEL_MIN_DEFAULT_HEADROOM = 40;

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

interface TabClosure {
  readonly tabs: SessionTab[];
  readonly activeTabId: string | null;
  readonly nextActiveTab: SessionTab | null;
  readonly closedSessionIds: readonly string[];
}

/**
 * 批量关闭标签页的公共计算：命中不到任何标签时返回 null，让调用方保持原有语义
 * （不做任何状态变更、返回当前激活标签）。
 *
 * 激活标签的落点优先保持原激活标签；若它也在关闭集合里，则退到最靠左被关闭位置
 * 的幸存标签，再退到列表末位。
 */
function computeTabClosure(
  tabs: readonly SessionTab[],
  activeTabId: string | null,
  shouldClose: (tab: SessionTab) => boolean,
): TabClosure | null {
  const closingTabs = tabs.filter(shouldClose);
  if (closingTabs.length === 0) {
    return null;
  }

  const nextTabs = tabs.filter((tab) => !shouldClose(tab));
  const firstClosingIndex = tabs.findIndex(shouldClose);
  const activeTabStillOpen = nextTabs.find((tab) => tab.id === activeTabId) ?? null;
  const nextActiveTab =
    activeTabStillOpen ?? nextTabs[Math.min(firstClosingIndex, nextTabs.length - 1)] ?? null;

  return {
    tabs: nextTabs,
    activeTabId: nextActiveTab?.id ?? null,
    nextActiveTab,
    closedSessionIds: closingTabs
      .map((tab) => tab.sessionId)
      .filter(
        (sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0,
      ),
  };
}

function mergeClosedSessionTabIds(previous: string[], next: readonly string[]): string[] {
  if (next.length === 0) {
    return previous;
  }

  return Array.from(new Set([...previous, ...next]));
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

export interface TerminalPanelHeightBounds {
  min: number;
  max: number;
  default: number;
}

/**
 * 终端面板高度的单一事实来源：硬编码 px 在 768 与 1440 视口上不可能同时合理，
 * 所以按视口算 bounds。视口不可用（非有限数 / ≤0）时回落到静态
 * TERMINAL_PANEL_HEIGHT_BOUNDS，行为与升级前一致。
 */
export function resolveTerminalPanelHeightBounds(
  viewportHeight: number,
): TerminalPanelHeightBounds {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return { ...TERMINAL_PANEL_HEIGHT_BOUNDS };
  }

  const max = Math.min(
    TERMINAL_PANEL_ABSOLUTE_MAX_HEIGHT,
    Math.max(
      TERMINAL_PANEL_MIN_HEIGHT + TERMINAL_PANEL_MIN_HEADROOM,
      Math.round(viewportHeight * TERMINAL_PANEL_VIEWPORT_MAX_RATIO),
    ),
  );
  const defaultHeight = Math.min(
    max,
    Math.max(
      TERMINAL_PANEL_MIN_HEIGHT + TERMINAL_PANEL_MIN_DEFAULT_HEADROOM,
      Math.round(viewportHeight * TERMINAL_PANEL_VIEWPORT_DEFAULT_RATIO),
    ),
  );

  return { min: TERMINAL_PANEL_MIN_HEIGHT, max, default: defaultHeight };
}

export function clampTerminalPanelHeightToBounds(
  height: number,
  bounds: TerminalPanelHeightBounds,
): number {
  if (!Number.isFinite(height)) {
    return bounds.default;
  }

  return Math.min(bounds.max, Math.max(bounds.min, Math.round(height)));
}

/**
 * 持久化域 bounds：上限取绝对上限而不是渲染域的视口相对 max。拖拽写入的值不随
 * 视口裁剪——1440 屏拖到 700 的偏好在小窗口仍存着，换回大屏即恢复；渲染期再按
 * 当前视口钳制（见 TerminalPanel）。若这里也用视口 max，高屏拉出的高度会被打回 360。
 */
export const TERMINAL_PANEL_STORAGE_HEIGHT_BOUNDS: TerminalPanelHeightBounds = {
  min: TERMINAL_PANEL_MIN_HEIGHT,
  max: TERMINAL_PANEL_ABSOLUTE_MAX_HEIGHT,
  default: TERMINAL_PANEL_DEFAULT_HEIGHT,
};

/** 面板自身 chrome：32px 面板级页签行 + 1px 上边框 + 余量，向上取整 40；hint/error 是绝对定位浮层不占高度。 */
export const TERMINAL_PANEL_CHROME_HEIGHT = 40;
/** 单个 pane 可用下限：≈6 行输出 + 一条 pane 级 tab 条（30px）；低于此前分屏只剩 1–2 行（160/2 ≈ 65px/pane）。 */
export const TERMINAL_MIN_PANE_HEIGHT = 120;

/**
 * 分屏下限抬升：paneCount 个 pane 各需 TERMINAL_MIN_PANE_HEIGHT，加上面板 chrome。
 * 抬升是派生的、不落盘——取消拆分后 paneCount 回 1，用户原本记住的高度自然恢复。
 */
export function resolveTerminalPanelHeightWithPaneFloor(
  height: number,
  paneCount: number,
  bounds: TerminalPanelHeightBounds,
): number {
  const resolved = clampTerminalPanelHeightToBounds(height, bounds);
  if (!Number.isFinite(paneCount) || paneCount <= 1) {
    return resolved;
  }

  const paneFloor = TERMINAL_PANEL_CHROME_HEIGHT + Math.ceil(paneCount) * TERMINAL_MIN_PANE_HEIGHT;
  return clampTerminalPanelHeightToBounds(Math.max(resolved, paneFloor), bounds);
}

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

          // 会话切换：先把当前镜像归档回旧会话桶（保住旧会话的展开态），再把新会话
          // 桶的值载入镜像（缺省 false，即新会话默认收起）。
          return {
            lastChatPath: nextPath,
            terminalPanelOpened: state.terminalPanelOpenedBySession[nextKey] ?? false,
            terminalPanelOpenedBySession: {
              ...state.terminalPanelOpenedBySession,
              [previousKey]: state.terminalPanelOpened,
            },
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
          const nextWorkspacePath = workspacePath ?? existingDraftTab.workspacePath;
          const nextTab: SessionTab =
            nextWorkspacePath && nextWorkspacePath !== existingDraftTab.workspacePath
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
          tabs: [...currentState.tabs, createDraftTab(tabId, workspacePath)],
          activeTabId: tabId,
        }));
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
      selectedSshConnectionId: null,
      setSelectedSshConnectionId: (connectionId) => set({ selectedSshConnectionId: connectionId }),
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
      sidePanelActiveTab: 'review',
      setSidePanelActiveTab: (tab) => set({ sidePanelActiveTab: tab }),
      browserPreviewSurface: 'editor',
      setBrowserPreviewSurface: (surface) => set({ browserPreviewSurface: surface }),
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
      name: 'openAwork-ui-state',
      version: 27,
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
        merged.editorMode = false;
        merged.closedSessionTabIds = [];
        // 瞬态身份：无论存储里出现什么（旧数据 / 手改 / 上一个标签页残留），
        // 启动态一律回到空身份，避免跨会话把上一会话的 SSH 绑定带进来。
        merged.readIdentity = EMPTY_READ_IDENTITY;
        // 瞬态模式：无论存储里出现什么（旧数据 / 手改），启动态一律 false。
        merged.terminalPanelMaximized = false;
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

        nextState.expandedDirsBySession = normalizeExpandedDirsBySession(
          nextState.expandedDirsBySession,
        );

        if (!isStringArray(nextState.collapsedSessionGroups)) {
          nextState.collapsedSessionGroups = [];
        }

        if (!isStringArray(nextState.collapsedSubagentParentIds)) {
          nextState.collapsedSubagentParentIds = [];
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
