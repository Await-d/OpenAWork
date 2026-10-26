import type { TerminalLayout } from '../../components/chat/terminal/layout/types.js';
import type { WorkspaceIdentity } from '../../utils/session/session-grouping.js';
import type { SidePanelActiveTab, TerminalPanelPosition } from './ui-state-helpers.js';

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
  /**
   * 新建草稿标签（同一时刻只保留一个，重复调用复用并激活）。
   *
   * `workspacePath`：string=绑定该工作区；`null`=显式清掉草稿已有工作区；
   * 省略=保持草稿现有工作区不变。
   */
  addDraftTab: (workspacePath?: string | null) => string;
  /**
   * 进入「新建会话」草稿态的统一入口：把解析好的工作区落到全局选中值与草稿
   * 标签上，并把 Chat 视图复位到空白草稿。工作区解析（显式来源 / 当前上下文
   * 继承 / 全局兜底）由调用方用 `resolveNewSessionWorkspace` 完成。
   *
   * `sshConnectionId`：`undefined`=不改动现有草稿 SSH 绑定（显式路径 / 全局兜底
   * 沿用既有行为）；`null`=清空；string=绑定该连接（继承远端会话时与远端路径
   * 成对写入，避免只继承路径丢掉连接）。
   */
  openDraftSession: (workspacePath: string | null, sshConnectionId?: string | null) => string;
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
   * 会话内「子代理运行列表」的折叠态，按会话分桶（键为 sessionId，见
   * `sessionSubviewKey`）。持久化并随工作台快照同步，重启 / 换端后保持。
   */
  collapsedSubagentRunListBySession: Record<string, boolean>;
  setSubagentRunListCollapsed: (sessionId: string | null, collapsed: boolean) => void;
  /**
   * 当前正在查看的子会话，按会话分桶。这是「打开过的子会话」现场：
   * 刷新或换端回到该父会话时，右侧「子代理」面板仍停在上次查看的那个子会话。
   */
  activeChildSessionIdBySession: Record<string, string>;
  setActiveChildSessionId: (sessionId: string | null, childSessionId: string | null) => void;
  /**
   * 注销指定会话的子视图现场（折叠桶 / 当前子会话桶）。
   *
   * **只能由「确定这些会话已被删除」的调用方使用**（删除成功的响应、级联删除的
   * 受影响 id 列表）。刻意不做「列表里没有就删」的推断：会话列表默认只取最近一页
   * 且带 `excludeTeam`，「未出现」绝大多数是「更早的会话」或「团队会话」，
   * 按列表剪除会把用户真实打开过的现场大批误删。
   * 无变化时返回原 state，避免多余的订阅通知与快照推送。
   */
  forgetSessionSubviews: (sessionIds: readonly string[]) => void;
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
  /**
   * 已出现过的全部工作区身份（闲置工作区占位组的数据源）。
   *
   * 必须连同 `sshConnectionId` 存储：远端目录路径只在单台主机内唯一，裸路径列表
   * 会让两台服务器的同名目录共用同一个占位组，重新并回一体。
   */
  savedWorkspaces: WorkspaceIdentity[];
  addSavedWorkspace: (workspace: WorkspaceIdentity) => void;
  mergeSavedWorkspaces: (workspaces: readonly WorkspaceIdentity[]) => void;
  removeSavedWorkspace: (
    workspace: Pick<WorkspaceIdentity, 'workspacePath' | 'sshConnectionId'>,
  ) => void;
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
    /** 会话解析出的 SSH 连接 id（本地工作区为 null）；新建会话继承工作区时一并带走。 */
    sshConnectionId: string | null;
    version: number;
  } | null;
  setActiveSessionWorkspace: (
    sessionId: string,
    path: string | null,
    sshConnectionId?: string | null,
  ) => void;
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
   *
   * 这是**当前会话桶的镜像值**（与 `terminalPanelOpened` 同一模式）：真正的归属
   * 在 `sidePanelActiveTabBySession`，会话切换时由 `setLastChatPath` 负责换镜。
   * 不按会话记忆会让多会话互相串 tab——在 A 选了「代码」再切回 B，B 也被迫
   * 停在「代码」，用户看到的就是「切会话后 tab 乱跑」。
   */
  sidePanelActiveTab: SidePanelActiveTab;
  setSidePanelActiveTab: (tab: SidePanelActiveTab) => void;
  /**
   * 停靠面板一级 tab 按会话分桶，键为规范化后的完整 chat path（见
   * `terminalPanelSessionKeyFor`），无 chat path 时归入 `__default__` 桶。
   * 桶里缺失的会话在切回时回落 `review`（面板默认视图）。
   */
  sidePanelActiveTabBySession: Record<string, SidePanelActiveTab>;
  /**
   * 单一浏览器互斥标记：`BuiltInBrowser` 持有网关实时会话，全应用同一时刻最多
   * 只能挂载一个实例。停靠面板的浏览器 tab 挂载时声明 'dock'，卸载时归还
   * 'editor'；编辑器面板据此在停靠面板持有浏览器期间不挂载自己的浏览器。
   * 瞬态字段，不持久化（见 partialize）。
   */
  browserPreviewSurface: 'editor' | 'dock';
  setBrowserPreviewSurface: (surface: 'editor' | 'dock') => void;
  /**
   * 收起浏览器预览的「视图状态」——会话切换时调用。
   *
   * 只回收「谁可见」这一层：分屏 / 全屏、停靠面板一级 tab、editor pane 的
   * browser 子 tab、`browserActive`。**不动** `browserPreviewUrlByWorkspace`：
   * 预览地址属于工作区维度记忆，刻意保留，切回该工作区仍能一键回到同一地址。
   *
   * 为什么必须有这个出口：预览宿主（`EditorBrowserWorkspace` / `BuiltInBrowser`）
   * 是 keep-alive 的，切会话只切 `hidden`、不卸载；若视图状态也不回收，旧会话的
   * 页面就会永久停在面板上，且没有任何代码路径能把它收掉。
   */
  resetBrowserPreviewView: () => void;
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
