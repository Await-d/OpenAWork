/**
 * QuickTerminalPanel — VS Code 风格的底部终端抽屉。和
 * `useSessionTerminals` 共享同一个数据源,所以 agent 跑出来的终端
 * 在这里也会自动出现一个 tab,用户可以直接接管输入。
 *
 * 布局（对齐 VS Code 集成终端面板,分屏树 T-10 起）:
 *  - 第 1 行 32px 面板级页签（终端 / 端口）+ 收起；页签是瞬态 state,不持久化
 *  - 内容区 = 布局树（`TerminalSplitView`）：**每个 pane 自带一条 tab 条**，
 *    只有该组的 active 终端会被渲染（各一条 SSE）；`layout === null` 时是
 *    单个隐式 pane，视觉与升级前一致
 *
 * 焦点与持久化:
 *  - `activePaneId` 是**瞬态** state（D4：焦点短暂，持久化只带来脏数据）
 *  - 每个 pane 的 `activeTerminalId` 持久化在布局树里（T-08/T-09）
 *  - 布局**只在用户主动操作时落盘**（＋ / ⊟ / 合并 / 关闭 / 切 tab）；
 *    渲染路径的归一化只读不写（见 layout/normalize.ts 的「最危险的交互」注释）
 *
 * 交互:
 *  - 用户主动关闭面板 → 持久化 false,刷新后保持关闭
 *  - 用户开启面板 → 持久化 true,刷新后自动恢复 + 自动选中上次激活的 tab
 *  - 高度可拖动调整,持久化(全局共享)
 *
 * 本文件是编排层:状态与副作用在这里,渲染交给同目录的子组件。
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  resolveEffectiveTerminalPanelPosition,
  useUIStateHydrated,
  useUIStateStore,
  type TerminalPanelPosition,
} from '../../../stores/ui/uiState.js';
import {
  closeTerminal,
  createSessionTerminal,
  writeTerminalStdin,
  type SessionTerminalView,
  type ShellProfileOption,
} from '../../conversation-runtime/terminals/terminals-api.js';
import {
  insertTerminalIntoPane,
  moveTerminal as applyMoveTerminal,
  removeTerminal as applyRemoveTerminal,
  setPaneActiveTerminal,
  splitPane as applySplitPane,
} from './layout/mutations.js';
import { normalizeLayout } from './layout/normalize.js';
import { countPanes, createPane, enumeratePanes } from './layout/queries.js';
import {
  MAX_PANES,
  type TerminalDropTarget,
  type TerminalLayout,
  type TerminalSplitDirection,
} from './layout/types.js';
import { useTerminalLayout } from './layout/use-terminal-layout.js';
import {
  TerminalLayoutContext,
  type TerminalLayoutContextValue,
  type TerminalPaneActions,
  type TerminalRenameRequest,
  type TerminalTabDragState,
} from './TerminalLayoutContext.js';
import {
  TerminalPanelTabs,
  terminalPanelPanelElementId,
  terminalPanelTabElementId,
  type TerminalPanelTabId,
} from './TerminalPanelTabs.js';
import { TerminalPortsPanel } from './TerminalPortsPanel.js';
import { IMPLICIT_PANE_ID, TerminalSplitView } from './TerminalSplitView.js';
import {
  TERMINAL_UI_INPUT_ATTR,
  isSplitPaneShortcut,
  paneLimitMessage,
} from './terminal-panel-shortcuts.js';
import './terminal-panel.css';

interface QuickTerminalPanelProps {
  open: boolean;
  onRequestClose: () => void;
  presentation?: 'overlay' | 'inline';
  height?: number;
  onHeightChange?: (height: number) => void;
  workspacePath: string | null;
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  terminals: SessionTerminalView[];
  loading: boolean;
  onReload: () => void;
  onRenameTerminal?: (terminalId: string, name: string | null) => Promise<void>;
  onDismissTerminal?: (terminalId: string) => void;
  /** 🗑 真终止（强制结束进程）；缺省时 🗑 禁用并提示未接入。 */
  onKillTerminal?: (terminalId: string) => Promise<void>;
  /** 宿主级 shell 配置；空数组 = 不可用（不渲染 profile 下拉）。 */
  shellProfiles?: readonly ShellProfileOption[];
  /**
   * 是否最大化（瞬态）。可选：缺省回落到 store 的 `terminalPanelMaximized` ——
   * classic overlay 调用点不显式接线，靠这条回落与 fusion 宿主共用同一个开关；
   * fusion 宿主显式传入，因为它还要在自己的渲染分支里据此跳过像素高度。
   */
  maximized?: boolean;
  /** 最大化 / 还原切换；缺省同样回落 store（见上）。 */
  onToggleMaximized?: () => void;
  /**
   * 停靠位置。缺省回落 store 的 `terminalPanelPosition`（与 maximized 同一套
   * 「可选 prop + store 回落」模式）；fusion 宿主显式传入，因为它要按有效位置
   * 跳过像素高度。传入值应是**有效位置**（窄视口下已是底部）。
   */
  position?: TerminalPanelPosition;
  /**
   * 停靠位置写入动作；缺省回落 store 的 `setTerminalPanelPosition`。
   * 调用方只负责「写到哪里」——最大化清理与侧栏让位由本面板统一补齐
   * （见 requestMovePosition），否则每个调用点都要复制一遍联动。
   */
  onMovePosition?: (position: TerminalPanelPosition) => void;
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'idle', 'tmux-spawned']);

/** 与 CSS 的 `@media (max-width: 767px)` 约定一致：<768px 只允许上下拆分。 */
const NARROW_VIEWPORT_QUERY = '(max-width: 767px)';

/** 「分屏已达上限」提示的停留时长：够看清，又不长期占位。 */
const SPLIT_HINT_DURATION_MS = 2_400;

/**
 * 窄视口（<768px）检测：面板内**唯一的** matchMedia 订阅 —— 拆分方向默认值
 * 与停靠可用性共用同一份判断，避免两处各自订阅出现「一个说窄、一个说宽」的中间帧。
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const sync = (): void => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return narrow;
}

/** 焦点回落到真实存在的 pane：显式 pane 被收敛掉时不至于整面板失去焦点态。 */
function resolveEffectivePaneId(layout: TerminalLayout, candidate: string | null): string {
  if (layout === null) return IMPLICIT_PANE_ID;
  const panes = enumeratePanes(layout);
  if (candidate !== null && panes.some((pane) => pane.id === candidate)) return candidate;
  return panes[0]?.id ?? IMPLICIT_PANE_ID;
}

/**
 * T-12 `pane-edge` 落点的新 pane id。
 *
 * 不能简单用 `pane-<terminalId>`：被拖终端可能正是某个现存 pane 的首个终端（例如
 * `⊟` 拆出来的 `pane-t1` 后来并回了别的组、而树里另有同名组），重复 id 会让 React key
 * 与拖拽命中判定（`data-pane-id`）同时失效。这里对现存 pane id 做后缀去重。
 */
function nextUniquePaneId(layout: TerminalLayout, terminalId: string): string {
  const taken = new Set(enumeratePanes(layout).map((pane) => pane.id));
  const base = `pane-${terminalId}`;
  if (!taken.has(base)) return base;
  let counter = 2;
  let candidate = `${base}-${counter}`;
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }
  return candidate;
}

export function QuickTerminalPanel(props: QuickTerminalPanelProps) {
  const {
    open,
    onRequestClose,
    presentation = 'overlay',
    height: controlledHeight,
    onHeightChange,
    workspacePath,
    gatewayUrl,
    token,
    sessionId,
    terminals,
    loading,
    onReload,
    onRenameTerminal,
    onDismissTerminal,
    onKillTerminal,
    shellProfiles,
    maximized: maximizedProp,
    onToggleMaximized: onToggleMaximizedProp,
    position: positionProp,
    onMovePosition: onMovePositionProp,
  } = props;

  const quickTerminalHeight = useUIStateStore((s) => s.quickTerminalHeight);
  const setQuickTerminalHeight = useUIStateStore((s) => s.setQuickTerminalHeight);
  const activeIdByWs = useUIStateStore((s) => s.quickTerminalActiveIdByWorkspace);
  const setActiveIdForWs = useUIStateStore((s) => s.setQuickTerminalActiveIdForWorkspace);
  const setTerminalLayoutForSession = useUIStateStore((s) => s.setTerminalLayoutForSession);
  // 最大化开关的真实来源是 store（瞬态）；props 只是可选的显式覆盖。
  const storeMaximized = useUIStateStore((s) => s.terminalPanelMaximized);
  const toggleStoreMaximized = useUIStateStore((s) => s.toggleTerminalPanelMaximized);
  const setStoreMaximized = useUIStateStore((s) => s.setTerminalPanelMaximized);
  const maximized = maximizedProp ?? storeMaximized;
  const onToggleMaximized = onToggleMaximizedProp ?? toggleStoreMaximized;
  // 停靠位置同上一套回落模式；归一化/降级只发生在读取端，store 里始终是用户偏好。
  const storePosition = useUIStateStore((s) => s.terminalPanelPosition);
  const setStorePosition = useUIStateStore((s) => s.setTerminalPanelPosition);
  const setLeftSidebarOpen = useUIStateStore((s) => s.setLeftSidebarOpen);
  const setReviewPanelOpened = useUIStateStore((s) => s.setReviewPanelOpened);
  const position = positionProp ?? storePosition;
  const movePosition = onMovePositionProp ?? setStorePosition;

  const wsKey = workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
  const height = controlledHeight ?? quickTerminalHeight;
  const setHeight = onHeightChange ?? setQuickTerminalHeight;
  const inlinePresentation = presentation === 'inline';
  const tabsId = useId();
  // 窄视口同时决定拆分默认方向与停靠可用性，只订阅一次（见 useNarrowViewport）。
  const isNarrowViewport = useNarrowViewport();
  const preferredSplitDirection: TerminalSplitDirection = isNarrowViewport ? 'column' : 'row';
  const effectivePosition = inlinePresentation
    ? resolveEffectiveTerminalPanelPosition(position, isNarrowViewport)
    : 'bottom';
  const docked = effectivePosition !== 'bottom';
  // overlay（classic）形态本身就是一个脱离文档流的底部抽屉条，没有侧列语义：
  // 停靠项在那里必须禁用并说明原因，而不是渲染出一个矛盾的菜单。
  const dockingDisabledReason = !inlinePresentation
    ? '经典 overlay 形态是底部抽屉，不支持侧停靠'
    : isNarrowViewport
      ? '视口不足 768px，侧停靠会把工作台挤到无法使用'
      : null;

  // Show only currently-live terminals as tabs; closed ones live in the
  // top-bar history popover (SessionTerminalsPanel) where the user can
  // delete them.
  const activeTerminals = useMemo(
    () => terminals.filter((t) => ACTIVE_STATUSES.has(t.status)),
    [terminals],
  );
  const liveTerminalIds = useMemo(
    () => new Set(activeTerminals.map((t) => t.terminalId)),
    [activeTerminals],
  );

  // 会话切换的第一帧上游还是空快照、`loading` 也尚未翻真；归一化只在渲染路径
  // 只读发生（不落盘），且不可信集合会被 T-09 降级为「原样返回」，不会清空布局。
  const layoutState = useTerminalLayout({
    liveTerminalIds,
    liveIdsTrusted: !loading,
    maxPanes: MAX_PANES,
  });
  const { layout, sessionKey } = layoutState;
  const paneCount = layout === null ? 1 : countPanes(layout);

  // 瞬态焦点（D4）：不持久化，跨会话不需要也不应该保留。
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const effectiveActivePaneId = resolveEffectivePaneId(layout, activePaneId);

  const persistedActiveId = activeIdByWs[wsKey] ?? null;
  const [pendingActive, setPendingActive] = useState<string | null>(null);
  // T-12 拖拽预览（瞬态，不持久化）：drop 前的高亮 / 插入条由它驱动。
  const [tabDrag, setTabDrag] = useState<TerminalTabDragState | null>(null);
  // 内容区右键「重命名」请求（瞬态，不持久化）：发起方在终端内容子树，消费方在目标 pane。
  const [renameRequest, setRenameRequest] = useState<TerminalRenameRequest | null>(null);

  // Reset the user's tab pick when the session or workspace changes —
  // a stale id from a different session would silently fall through to
  // the persisted/first-fallback path, but keeping it around is misleading.
  // 顺带清掉 T-12 拖拽预览与重命名请求：瞬态态跨会话没有任何意义。
  useEffect(() => {
    setPendingActive(null);
    setTabDrag(null);
    setRenameRequest(null);
  }, [sessionId, wsKey]);

  // 隐式 pane（无分屏）的 active 解析：用户显式点选 > workspace 持久化 > 第一个。
  const implicitActiveId = useMemo(() => {
    if (pendingActive && activeTerminals.some((t) => t.terminalId === pendingActive)) {
      return pendingActive;
    }
    if (persistedActiveId && activeTerminals.some((t) => t.terminalId === persistedActiveId)) {
      return persistedActiveId;
    }
    return activeTerminals[0]?.terminalId ?? null;
  }, [pendingActive, persistedActiveId, activeTerminals]);

  // Persist the resolved active id so a refresh restores the same tab.
  useEffect(() => {
    if (!open) return;
    if (implicitActiveId !== persistedActiveId) {
      setActiveIdForWs(workspacePath, implicitActiveId);
    }
  }, [open, implicitActiveId, persistedActiveId, setActiveIdForWs, workspacePath]);

  // 面板级页签是瞬态 state：打开面板总是先看到终端,不落盘（也避免新增 store 字段）。
  const [panelTab, setPanelTab] = useState<TerminalPanelTabId>('terminal');

  /** 正在创建 / 拆分的 pane；非 null 时所有创建入口禁用，避免并发重入。 */
  const [busyPaneId, setBusyPaneId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // 终端内部的 stdin 写入 / 剪贴板失败会经 onWriteError 冒到面板错误条，
  // 这样即使用户没盯着终端底部提示，也能在自己的操作上下文里看到失败。
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    setWriteError(null);
  }, [implicitActiveId]);

  // 面板级瞬态提示（目前只有「分屏已达上限」一种）：快捷键被拒绝时也要有可见反馈，
  // 否则用户会以为按键没生效。到点自动消失，不需要用户手动关闭。
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (hint === null) return;
    const timer = setTimeout(() => setHint(null), SPLIT_HINT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  const inputEnabled = (terminal: SessionTerminalView): boolean =>
    ACTIVE_STATUSES.has(terminal.status) && terminal.kind === 'foreground';

  /**
   * 一次性落盘布局（**只允许用户主动操作**调用）。
   *
   * 为什么不一律走 hook 的 action：
   *  ①「合并到分屏」要连续 insert 多个终端，而每个 hook action 都闭包着同一份旧
   *    `layout`，循环调用只有最后一次生效 —— 必须先用纯函数算出终态再落一次盘；
   *  ② 从隐式 pane（`layout === null`）拆分时树里还没有该 pane，hook 的 `splitPane`
   *    会因 `findPane` 失败而空转，必须先物化单 pane 树。
   * 归一化时把本次新引入的 terminalId 补进存活集合（与 T-09 同一口径），
   * 否则刚 POST 出来、上游尚未同步的终端会被当成死终端立刻摘掉。
   */
  const commitLayout = (next: TerminalLayout, introduced: readonly string[] = []): void => {
    const ids = new Set(liveTerminalIds);
    for (const id of introduced) ids.add(id);
    setTerminalLayoutForSession(sessionKey, normalizeLayout(next, ids, { maxPanes: MAX_PANES }));
  };

  const createTerminalInPane = async (paneId: string, shellProfileId?: string): Promise<void> => {
    if (!sessionId || !token || busyPaneId !== null) return;
    setBusyPaneId(paneId);
    setCreateError(null);
    try {
      const result = await createSessionTerminal({
        gatewayUrl,
        sessionId,
        token,
        ...(workspacePath ? { cwd: workspacePath } : {}),
        ...(shellProfileId !== undefined ? { shellProfileId } : {}),
      });
      const newTerminalId = result.terminal.terminalId;
      if (layout === null) {
        // 隐式 pane 还没有树节点：新终端天然是它的 tab，只需把激活位切过去。
        setPendingActive(newTerminalId);
        setActiveIdForWs(workspacePath, newTerminalId);
      } else {
        layoutState.insertTerminal(paneId, newTerminalId);
      }
      setActivePaneId(paneId);
      onReload();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPaneId(null);
    }
  };

  const splitPaneById = async (
    paneId: string,
    direction?: TerminalSplitDirection,
  ): Promise<void> => {
    if (!sessionId || !token || busyPaneId !== null) return;
    if (paneCount >= MAX_PANES) return;
    // 显式方向（⋯ → 向右 / 向下拆分）优先；缺省沿用 ⊟ 的视口默认方向。
    const resolvedDirection = direction ?? preferredSplitDirection;
    setBusyPaneId(paneId);
    setCreateError(null);
    try {
      const result = await createSessionTerminal({
        gatewayUrl,
        sessionId,
        token,
        ...(workspacePath ? { cwd: workspacePath } : {}),
      });
      // 种子终端是「禁止空 pane」不变量的关键：必须原样传给 splitPane，
      // 否则新 pane 会先以空态落盘、随后被归一化摘掉。
      const seedTerminalId = result.terminal.terminalId;
      const newPaneId = `pane-${seedTerminalId}`;
      if (layout === null) {
        if (liveTerminalIds.size === 0) return;
        // 隐式 pane 尚未物化：按当前全部终端建组（保留原 active），再在纯函数层拆分。
        const base = createPane([...liveTerminalIds], IMPLICIT_PANE_ID);
        const oriented =
          implicitActiveId !== null
            ? setPaneActiveTerminal(base, IMPLICIT_PANE_ID, implicitActiveId)
            : base;
        const next = applySplitPane(oriented, IMPLICIT_PANE_ID, resolvedDirection, newPaneId, {
          seedTerminalId,
          maxPanes: MAX_PANES,
        });
        if (next !== oriented) commitLayout(next, [seedTerminalId]);
      } else {
        layoutState.splitPane(paneId, resolvedDirection, newPaneId, seedTerminalId);
      }
      setActivePaneId(newPaneId);
      onReload();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPaneId(null);
    }
  };

  const selectTerminalInPane = (paneId: string, terminalId: string, index?: number): void => {
    setActivePaneId(paneId);
    // 「是否隐式」的判据是 layout === null，不是 pane id —— 组内重排会把隐式 pane
    // 物化成 id 仍为 IMPLICIT_PANE_ID 的单 pane 树，此时必须走树内激活路径。
    if (layout === null) {
      setPendingActive(terminalId);
      return;
    }
    // 显式 pane：组内终端 = 切换 active（按可视索引原位保留）；游离终端 = 先并入该组再激活。
    layoutState.insertTerminal(paneId, terminalId, index);
  };

  /**
   * T-12 drop 的唯一落盘入口（一次）。
   *
   * - 隐式单组（`layout === null`）：tab-strip 落回本组 = 组内重排，物化单 pane 树把
   *   顺序持久化（pane id 仍是 IMPLICIT_PANE_ID，渲染不变）；四边落点物化单 pane 树
   *   后走纯函数层拆分，产出首个分屏树；`pane-center` / `detach` 没有语义，静默返回。
   * - `tab-strip`：纯函数层的 `moveTerminal` 对该落点只做「移出树」，插入位与目标组
   *   都要调用方给（见 mutations.ts 注释），因此这里直接走 `insertTerminalIntoPane`，
   *   同时覆盖组内重排与跨组移入。
   * - `pane-center` / `pane-edge` / `detach`：走 hook 的 `moveTerminal`（内部一次落盘）。
   */
  const moveTerminalByDrop = (
    terminalId: string,
    target: TerminalDropTarget,
    tabStripPaneId?: string,
  ): void => {
    if (layout === null) {
      if (target.kind !== 'tab-strip') {
        if (target.kind !== 'pane-edge' || target.paneId !== IMPLICIT_PANE_ID) return;
        const edgeIds = activeTerminals.map((terminal) => terminal.terminalId);
        // 源组只剩一个终端时拆出去会让它变空（禁止空 pane 不变量），保持拒绝语义。
        if (edgeIds.length < 2 || !edgeIds.includes(terminalId)) return;
        // 隐式 pane 尚未物化：先按当前全部终端建组（保留原 active），再交给纯函数层
        // 拆分 —— 与 ⊟ 拆分同一条「先物化再 splitPane」路径。
        const materialized = createPane(edgeIds, IMPLICIT_PANE_ID);
        const oriented =
          implicitActiveId !== null
            ? setPaneActiveTerminal(materialized, IMPLICIT_PANE_ID, implicitActiveId)
            : materialized;
        const next = applyMoveTerminal(oriented, terminalId, target, {
          newPaneId: nextUniquePaneId(oriented, terminalId),
          maxPanes: MAX_PANES,
        });
        if (next !== oriented) commitLayout(next);
        return;
      }
      if (tabStripPaneId === undefined) return;
      const ids = activeTerminals.map((terminal) => terminal.terminalId);
      if (!ids.includes(terminalId)) return;
      const without = ids.filter((id) => id !== terminalId);
      // index 语义 = **移除被拖终端之后**的槽位（与 refineTabIndex / withTerminalAt 同口径）。
      // 隐式单组这条路径自己完成了移除，因此直接按该语义插入即可；若再按「未移除的数组」
      // 位置插入，会整体偏移一位 —— 表现是第一次拖拽「落到错误槽位」，物化后重拖才到位。
      const at = Math.min(Math.max(target.index, 0), without.length);
      without.splice(at, 0, terminalId);
      const [first] = without;
      if (first === undefined) return;
      // createPane 把 active 硬编码为首个终端；用户当下选中的 tab 必须保留，
      // 否则拖动一次就会把 active 换到别的终端上。
      const materialized = createPane(without, IMPLICIT_PANE_ID);
      const next =
        implicitActiveId !== null
          ? setPaneActiveTerminal(materialized, IMPLICIT_PANE_ID, implicitActiveId)
          : materialized;
      commitLayout(next);
      return;
    }
    if (target.kind === 'tab-strip') {
      if (tabStripPaneId === undefined) return;
      layoutState.insertTerminal(tabStripPaneId, terminalId, target.index);
      return;
    }
    layoutState.moveTerminal(terminalId, target, nextUniquePaneId(layout, terminalId));
  };

  const mergeOthersIntoPane = (paneId: string): void => {
    if (layout === null) return;
    const pane = enumeratePanes(layout).find((candidate) => candidate.id === paneId);
    if (pane === undefined) return;
    const owned = new Set(pane.terminalIds);
    const otherIds = activeTerminals
      .map((terminal) => terminal.terminalId)
      .filter((terminalId) => !owned.has(terminalId));
    if (otherIds.length === 0) return;
    let next: TerminalLayout = layout;
    for (const terminalId of otherIds) {
      next = insertTerminalIntoPane(next, paneId, terminalId);
    }
    if (next !== layout) commitLayout(next, otherIds);
  };

  // 批量关闭：逐个调用既有的 close 接口（持久终端走 close、非持久回退 kill），
  // 全量结束后才 reload 一次，避免 N 次 reload 造成列表抖动。
  const closeTerminalsByIds = async (
    terminalIds: readonly string[],
    resetActive: boolean,
  ): Promise<void> => {
    if (!sessionId || !token || terminalIds.length === 0) return;
    await Promise.all(
      terminalIds.map((terminalId) =>
        closeTerminal({ gatewayUrl, sessionId, terminalId, token }).catch(() => undefined),
      ),
    );
    if (resetActive) {
      setActiveIdForWs(workspacePath, null);
      setPendingActive(null);
    }
    // 关闭是用户主动操作：把被关终端从树里摘掉（清空后的组由纯函数自动上提兄弟）。
    let next: TerminalLayout = layout;
    for (const terminalId of terminalIds) next = applyRemoveTerminal(next, terminalId);
    if (next !== layout) commitLayout(next);
    onReload();
  };

  const closeSingleTerminal = async (terminalId: string): Promise<void> => {
    if (!sessionId || !token) return;
    try {
      await closeTerminal({ gatewayUrl, sessionId, terminalId, token });
    } catch {
      // 关闭失败不阻塞 UI：随后的 onReload 会以服务端快照为准。
    }
    const next = applyRemoveTerminal(layout, terminalId);
    if (next !== layout) commitLayout(next);
    if (terminalId === implicitActiveId) {
      // Drop persisted active so the next render falls back to the
      // first remaining active terminal.
      setActiveIdForWs(workspacePath, null);
      setPendingActive(null);
    }
    onReload();
  };

  const renameTerminalById = (terminalId: string, name: string | null): void => {
    if (!onRenameTerminal) return;
    void onRenameTerminal(terminalId, name);
  };

  // 清屏复用既有 stdin 能力：`\x0c` 是 Ctrl+L，仓库把它的语义定义为 shell 清屏
  // （见 terminal-key-handlers）。只有可交互的持久终端会接受 stdin，其余状态下
  // 菜单项在 TerminalTabActions 里被禁用。
  const clearTerminal = (terminal: SessionTerminalView): void => {
    if (!sessionId || !token || !inputEnabled(terminal)) return;
    void writeTerminalStdin({
      gatewayUrl,
      sessionId,
      terminalId: terminal.terminalId,
      token,
      data: '\u000c',
    })
      .then((result) => {
        if (!result.ok) setWriteError(result.error ?? '清屏请求被终端拒绝');
      })
      .catch((error: unknown) => {
        setWriteError(error instanceof Error ? error.message : String(error));
      });
  };

  // ─── Auto-dismiss terminated terminals from tab bar ───
  // When a terminal exits, give a brief visual cue then remove it from
  // the active tab list so it doesn't clutter the UI.
  const prevTerminalsRef = useRef<SessionTerminalView[]>([]);
  useEffect(() => {
    const prev = prevTerminalsRef.current;
    prevTerminalsRef.current = terminals;
    if (!onDismissTerminal) return;
    // Find terminals that just transitioned from active to closed
    for (const term of terminals) {
      if (ACTIVE_STATUSES.has(term.status)) continue;
      const wasPreviouslyActive = prev.some(
        (p) => p.terminalId === term.terminalId && ACTIVE_STATUSES.has(p.status),
      );
      if (wasPreviouslyActive) {
        // Brief delay so the user sees the status change before removal
        const tid = term.terminalId;
        setTimeout(() => {
          onDismissTerminal(tid);
        }, 1500);
      }
    }
  }, [terminals, onDismissTerminal]);

  // Drag-resize handle. We track movement via mousemove on window and
  // translate it into a height delta from the bottom of the viewport.
  //
  // 拖拽期间由 body 接管 cursor / user-select（与 TerminalSplitView 的分屏条同法）：
  // 手柄只有 6px 高，指针一旦离开手柄就落回面板内容上，不接管会选中终端文本。
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const onDragStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragRef.current = { startY: event.clientY, startHeight: height };
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      const onMove = (e: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - e.clientY;
        const next = dragRef.current.startHeight + delta;
        setHeight(next);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height, setHeight],
  );

  /**
   * 停靠切换的唯一入口：调用方只负责「写位置」，三件联动在面板层补齐（顺序有意）。
   *
   *  ① 离开底部前清掉最大化 —— 两种「占满」无法同时成立，且最大化标记是全局瞬态，
   *     留着它会在下一次展开时把面板重新顶到占满态；
   *  ② 写位置；
   *  ③ 收起同侧侧栏 —— 侧停靠是全高列，同侧已有侧栏时工作台会被压到没有宽度。
   *     注意这是**单向礼节**：改回底部时不自动展开被我方收起的侧栏，因为用户手动
   *     收起的侧栏同样是合法状态，自动展开会覆盖用户的显式选择。
   *
   * 放在面板层而不是调用点：overlay / fusion 两个宿主都要这条联动，调用点只传
   * 「位置写到哪里」（onMovePosition），避免同一规则出现两份实现。
   */
  const requestMovePosition = (destination: TerminalPanelPosition): void => {
    if (destination !== 'bottom') {
      setStoreMaximized(false);
    }
    movePosition(destination);
    if (destination === 'left') {
      setLeftSidebarOpen(false);
    } else if (destination === 'right') {
      setReviewPanelOpened(false);
    }
  };

  /**
   * 渲染门：等 `uiState` 水合完成再渲染面板。
   *
   * `uiState` 的自定义节流 storage 让水合变成异步 microtask，而 auth store 的同步
   * 水合早已完成 —— 两者之间那一帧里 `lastChatPath` 还是默认 null（会话键 `__default__`），
   * 水合后切到真实会话键会让 pane 整棵重挂载，落在这一帧的拖拽手势随之作废
   * （表现：刷新后第一次拖不动，切几次标签才恢复）。见 `useUIStateHydrated` 的说明。
   */
  const uiStateHydrated = useUIStateHydrated();
  if (!uiStateHydrated) return null;

  if (!open) return null;

  const panelElementId = terminalPanelPanelElementId(tabsId);
  const terminalTabElementId = terminalPanelTabElementId(tabsId, 'terminal');
  const portsTabElementId = terminalPanelTabElementId(tabsId, 'ports');

  const paneActions: TerminalPaneActions = {
    createTerminal: (paneId, shellProfileId) => {
      void createTerminalInPane(paneId, shellProfileId);
    },
    killTerminal: (terminalId) => {
      void onKillTerminal?.(terminalId).catch((error: unknown) => {
        setWriteError(error instanceof Error ? error.message : String(error));
      });
    },
    splitPane: (paneId, direction) => {
      void splitPaneById(paneId, direction);
    },
    mergeOthersIntoPane,
    selectTerminal: selectTerminalInPane,
    closeTerminal: (terminalId) => {
      void closeSingleTerminal(terminalId);
    },
    closeTerminals: (terminalIds) => {
      void closeTerminalsByIds(terminalIds, false);
    },
    closeAllTerminals: () => {
      void closeTerminalsByIds(
        activeTerminals.map((terminal) => terminal.terminalId),
        true,
      );
    },
    renameTerminal: renameTerminalById,
    clearTerminal,
    setRatio: (splitId, ratio) => {
      // T-11：拖拽松手才走到这里（拖拽中只改本地瞬态比例，不落盘）。
      layoutState.setRatio(splitId, ratio);
    },
    moveTerminalByDrop,
  };

  const layoutContextValue: TerminalLayoutContextValue = {
    activePaneId: effectiveActivePaneId,
    setActivePaneId,
    layout,
    paneCount,
    maxPanes: MAX_PANES,
    preferredSplitDirection,
    totalTerminalCount: activeTerminals.length,
    shellProfiles: shellProfiles ?? [],
    busyPaneId,
    tabDrag,
    setTabDrag,
    renameRequest,
    // 请求只做一次转发：目标 pane 消费后调用 clearRenameRequest，避免同一请求被重复消费。
    requestRename: (paneId, terminalId) => {
      setRenameRequest({ paneId, terminalId });
    },
    clearRenameRequest: () => {
      setRenameRequest(null);
    },
    view: { gatewayUrl, token, sessionId, inputEnabled, onWriteError: setWriteError },
    actions: paneActions,
  };

  /**
   * Ctrl/⌘+Shift+5 → 拆分当前激活 pane（VS Code 的 Split Terminal 键位）。
   *
   * 挂载点是**面板容器的捕获阶段**，既不是 window、也不是冒泡阶段：
   *  - 挂 window 会抢走页面其它区域的同名组合键（面板没焦点时不该响应）；
   *  - xterm 把自己的 keydown 挂在隐藏 textarea 上（`capture=true`），冒泡阶段再拦
   *    已经晚了一步（xterm 已把按键当输入转给 pty）；祖先的**捕获**链早于该
   *    textarea 的监听器，只有这里 `preventDefault` 才能真正接管这个组合键。
   *
   * 放行判据见 `TERMINAL_UI_INPUT_ATTR`：只认显式标记的 UI 输入控件（搜索条 /
   * 重命名输入框），不认「target 可编辑」——那会把终端自身获得焦点的场景一起挡掉。
   */
  const handlePanelKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // 端口页没有可见 pane，拆分无处作用（结果要切回终端页才看得到），直接不接管。
    if (panelTab !== 'terminal') return;
    if (event.defaultPrevented) return;
    if (!isSplitPaneShortcut(event)) return;
    const target = event.target;
    if (target instanceof Element && target.closest(`[${TERMINAL_UI_INPUT_ATTR}]`) !== null) {
      return;
    }
    // 接管：挡掉浏览器默认行为，并阻断向 xterm 的传播（见上方注释）。
    event.preventDefault();
    event.stopPropagation();
    if (paneCount >= MAX_PANES) {
      // 上限时与 ⊟ 同一条判定：不执行拆分，但不静默吞掉按键。
      setHint(paneLimitMessage(MAX_PANES));
      return;
    }
    // 与 ⊟ / ⋯ 方向拆分共用同一条动作：方向缺省 = 视口默认（<768px column，否则 row）。
    paneActions.splitPane(effectiveActivePaneId);
  };

  // 最大化 / 侧停靠下都不下发内联像素高度：让 CSS 按布局决定占位（inline 吃满剩余
  // 空间 / overlay 覆盖包含块 / 侧停靠列吃满全高），避免用 !important 去压受控高度。
  // 两种模式下也都不渲染拖拽柄：最大化理由见下；侧停靠是横轴占位，纵向手柄会改错轴。
  return (
    <div
      role="region"
      aria-label="快捷终端面板"
      className="terminal-panel"
      data-terminal-scope=""
      data-presentation={inlinePresentation ? 'inline' : 'overlay'}
      data-docked={docked ? effectivePosition : undefined}
      data-maximized={maximized ? 'true' : undefined}
      style={maximized || docked ? undefined : { height, minHeight: height }}
      onKeyDownCapture={handlePanelKeyDownCapture}
    >
      {/* 最大化时不渲染拖拽手柄：拖动会按持久化高度域（上限 900px）钳制，从最大化
          直接拖会先跳变到钳制值；本轮只提供「还原」路径，与 VS Code 的「拖动即还原」
          不同是有意取舍（理由见 uiState 的 terminalPanelMaximized 注释）。 */}
      {maximized || docked ? null : (
        <button
          type="button"
          aria-label="拖动调整高度"
          className="terminal-panel__resize-handle"
          onMouseDown={onDragStart}
        />
      )}
      <TerminalPanelTabs
        idBase={tabsId}
        activeTab={panelTab}
        onSelectTab={setPanelTab}
        onRequestClose={onRequestClose}
        maximized={maximized}
        onToggleMaximized={onToggleMaximized}
        position={effectivePosition}
        onMovePosition={requestMovePosition}
        dockingDisabledReason={dockingDisabledReason}
      />
      {panelTab === 'terminal' ? (
        <div
          role="tabpanel"
          id={panelElementId}
          aria-labelledby={terminalTabElementId}
          className="terminal-panel__panel"
        >
          {createError || writeError ? (
            <div className="terminal-panel__error" role="alert">
              {createError ? <span>{createError}</span> : null}
              {writeError ? <span>{writeError}</span> : null}
            </div>
          ) : null}
          {hint !== null ? (
            <div className="terminal-panel__hint" role="status" data-testid="terminal-panel-hint">
              {hint}
            </div>
          ) : null}
          <div className="terminal-panel__body">
            <TerminalLayoutContext value={layoutContextValue}>
              <TerminalSplitView
                layout={layout}
                terminals={activeTerminals}
                implicitActiveTerminalId={implicitActiveId}
              />
            </TerminalLayoutContext>
          </div>
        </div>
      ) : (
        <div
          role="tabpanel"
          id={panelElementId}
          aria-labelledby={portsTabElementId}
          className="terminal-panel__panel"
        >
          <TerminalPortsPanel gatewayUrl={gatewayUrl} token={token} />
        </div>
      )}
    </div>
  );
}
