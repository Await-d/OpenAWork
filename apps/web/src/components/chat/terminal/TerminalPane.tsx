/**
 * TerminalPane — 一个 VS Code 式的「组」：自带一条 tab 条 + 只渲染该组的 active 终端。
 *
 * 生命周期（D5）：每个**可见 pane** 渲染其 active 终端 → 各一条 SSE，pane 上限 4
 * 因此最多 4 条流。pane 失去焦点只换边框（`data-active`），**不 unmount** ——
 * unmount 会丢 scrollback 并触发 xterm `term.reset()`，ring 回放救不回 TUI 画面。
 * 组内非 active 终端不渲染：它们是 tab，切过去时才挂载并按 ring 回放补齐。
 *
 * 组内切换用 `key={activeTerminal.terminalId}`：跨 pane 移动终端必然 remount
 * （React 跨父节点即卸载），代价是一次 ring 回放，这是 D6 接受的行为。
 *
 * T-12 tab 拖拽：手势状态机在本文件（`useTabDragGesture`）—— 它需要面板级 context
 * （布局树 / pane 上限 / 方向限制）与缩略图所需的 DOM 几何；tab 条只负责渲染与转发。
 * 「拖拽中不落盘、drop 才落一次盘」与分隔条拖拽同一条纪律（见 TerminalSplitView）。
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { resolveDropTarget, type PaneRect, type Rect } from './layout/drop-target.js';
import { findPane, enumeratePanes } from './layout/queries.js';
import type { TerminalDropTarget, TerminalSplitDirection } from './layout/types.js';
import { InteractiveTerminalView } from './InteractiveTerminalView.js';
import { TerminalTabActions } from './TerminalTabActions.js';
import {
  TerminalTabStrip,
  terminalTabLabel,
  type TerminalTabDragBinding,
} from './TerminalTabStrip.js';
import { useTerminalLayoutContext, type TerminalTabDragState } from './TerminalLayoutContext.js';
import { TerminalContextMenu, type TerminalContextMenuItem } from './TerminalContextMenu.js';
import { buildTerminalCommandItems } from './terminal-pane-menu.js';
import { paneLimitMessage } from './terminal-panel-shortcuts.js';
import './terminal-split.css';

export interface TerminalPaneProps {
  paneId: string;
  /** 该 pane 的 tab 条内容（组内 terminalIds，末尾可能追加本 pane 托管的游离终端）。 */
  terminals: readonly SessionTerminalView[];
  /** 该组当前渲染的终端；不在 terminals 里时视为空组。 */
  activeTerminalId: string | null;
}

/** 超过这个位移才算拖拽，避免「点一下 tab」被误判为拖拽。 */
const TAB_DRAG_THRESHOLD_PX = 4;

const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

interface TabDropResolution {
  target: TerminalDropTarget;
  /** tab-strip 落点所属 pane（纯函数层看不到 tab 几何，由 DOM 侧补）。 */
  tabStripPaneId: string | null;
}

function toRect(rect: DOMRect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * 收集面板内容区里所有 pane 的矩形。
 *
 * **顺序即渲染层级顺序**：`querySelectorAll` 返回文档序（= 布局树的 DFS 序），
 * T-08 的命中判定从数组尾部开始扫描（后者绘制在上、优先命中），二者必须一致。
 */
function collectPaneRects(root: ParentNode): PaneRect[] {
  const rects: PaneRect[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('.terminal-pane[data-pane-id]')) {
    const paneId = element.dataset.paneId;
    if (paneId === undefined) continue;
    rects.push({ paneId, ...toRect(element.getBoundingClientRect()) });
  }
  return rects;
}

/**
 * 用真实 tab 中点细化插入位：`resolveDropTarget` 只能按指针横向比例粗估 index
 * （它拿不到 tab 几何，见其文档）。index 语义 = **移除被拖终端之后**的槽位序号，
 * 与 `mutations.withTerminalAt` 的口径一致。
 */
function refineTabIndex(strip: HTMLElement, draggedTerminalId: string, pointerX: number): number {
  let index = 0;
  for (const tab of strip.querySelectorAll<HTMLElement>('[data-terminal-id]')) {
    if (tab.dataset.terminalId === draggedTerminalId) continue;
    const rect = tab.getBoundingClientRect();
    if (pointerX > rect.x + rect.width / 2) index += 1;
  }
  return index;
}

/**
 * 命中判定：**全部委托**给 T-08 的 `resolveDropTarget`，本函数只做两件它做不到的事——
 * 收集真实 DOM 几何、以及把 tab 条的插入 index 用 tab 中点细化。
 *
 * tab 条优先：先按相邻 pane 的 tab 条尝试命中（指针落在某条 tab 条上 → 该组重排 /
 * 移入该组）；都不命中时再用零尺寸 tabStripRect 走 pane / edge / detach 判定。
 */
function resolveTabDrop(
  anchor: HTMLElement,
  draggedTerminalId: string,
  pointer: { x: number; y: number },
  isDirectionAllowed: (direction: 'row' | 'column') => boolean,
): TabDropResolution {
  const root = anchor.closest('.terminal-panel__body') ?? anchor.ownerDocument;
  const paneRects = collectPaneRects(root);

  for (const strip of root.querySelectorAll<HTMLElement>(
    '[data-testid="terminal-tab-strip"][data-pane-id]',
  )) {
    const rect = toRect(strip.getBoundingClientRect());
    if (rect.width <= 0 || rect.height <= 0) continue;
    const candidate = resolveDropTarget({
      paneRects,
      tabStripRect: rect,
      pointer,
      isDirectionAllowed,
      tabCount: strip.querySelectorAll('[data-terminal-id]').length,
    });
    if (candidate.kind !== 'tab-strip') continue;
    return {
      target: {
        kind: 'tab-strip',
        index: refineTabIndex(strip, draggedTerminalId, pointer.x),
      },
      tabStripPaneId: strip.dataset.paneId ?? null,
    };
  }

  return {
    target: resolveDropTarget({
      paneRects,
      tabStripRect: EMPTY_RECT,
      pointer,
      isDirectionAllowed,
    }),
    tabStripPaneId: null,
  };
}

interface TabDragSession {
  terminalId: string;
  startX: number;
  startY: number;
  /** 超过阈值后才算拖拽；在此之前只是普通点击。 */
  active: boolean;
  resolution: TabDropResolution | null;
  rejected: boolean;
}

interface TabDragGesture {
  binding: TerminalTabDragBinding;
  /** 拖拽结束后的那次 click 必须被吞掉，否则会顺带切换 active tab。 */
  takeClickSuppression(): boolean;
}

/**
 * 预览是否等价。
 *
 * 面板级 state 一变，所有 pane 都会重渲染；pointermove 每秒可达上百次，落点是同一格时
 * 没必要驱动一次全树渲染（也更省 T-07 之外的重排开销）。
 */
function sameDragPreview(a: TerminalTabDragState | null, b: TerminalTabDragState): boolean {
  if (a === null) return false;
  if (
    a.terminalId !== b.terminalId ||
    a.rejected !== b.rejected ||
    a.tabStripPaneId !== b.tabStripPaneId ||
    a.target.kind !== b.target.kind
  ) {
    return false;
  }
  switch (a.target.kind) {
    case 'tab-strip':
      return b.target.kind === 'tab-strip' && a.target.index === b.target.index;
    case 'pane-center':
      return b.target.kind === 'pane-center' && a.target.paneId === b.target.paneId;
    case 'pane-edge':
      return (
        b.target.kind === 'pane-edge' &&
        a.target.paneId === b.target.paneId &&
        a.target.edge === b.target.edge
      );
    case 'detach':
      return true;
  }
}

/**
 * T-12 tab 拖拽：pointerdown 起手 → pointermove 解析落点（只更新预览）→ pointerup 落一次盘。
 *
 * 选 pointer 事件而不是 HTML5 DnD 的理由见报告：命中判定必须复用 T-08 的
 * `resolveDropTarget`（需要 client 坐标），HTML5 DnD 的 dragover 无法给出稳定坐标、
 * 不支持触控、且 jsdom 下无法驱动 dataTransfer；pointer 方案与分隔条拖拽同源。
 */
function useTabDragGesture(
  paneId: string,
  terminals: readonly SessionTerminalView[],
): TabDragGesture {
  const { layout, paneCount, maxPanes, preferredSplitDirection, tabDrag, setTabDrag, actions } =
    useTerminalLayoutContext();
  const sessionRef = useRef<TabDragSession | null>(null);
  const suppressClickRef = useRef(false);

  // <768px 只允许上下拆分（与 CSS / preferredSplitDirection 同源）：row 边落点回退 pane-center。
  const isDirectionAllowed = (direction: 'row' | 'column'): boolean =>
    preferredSplitDirection === 'column' ? direction === 'column' : true;

  // 拖拽期间的光标 / 文本选择锁：只有**发起拖拽的那个 pane**改 body —— 每个 pane 都挂着
  // 这个 effect，不限定 owner 时后来的实例会捕获已被改写的旧值，cleanup 时把光标
  // 「还原」成中间态。被拒绝的落点用 not-allowed 表达。
  const ownsDrag = tabDrag !== null && tabDrag.sourcePaneId === paneId;
  const rejectedPreview = tabDrag?.rejected ?? false;
  useEffect(() => {
    if (!ownsDrag) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = rejectedPreview ? 'not-allowed' : 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [ownsDrag, rejectedPreview]);

  const evaluateRejected = (target: TerminalDropTarget, tabStripPaneId: string | null): boolean => {
    if (layout === null) {
      // 单组隐式 pane：只有「落回本组 tab 条」（组内重排）有语义；唯一的一组之外
      // 没有别的 pane，detach / 合并 / 拆分都无处可去，一律拒绝。
      return !(target.kind === 'tab-strip' && tabStripPaneId === paneId);
    }
    // 「拖走某组最后一个终端」允许（协调者裁定，对齐 VS Code 的源组折叠）：
    // 源组被清空后由纯函数层自然收敛 —— `removeTerminal` 在 pane 变空时等同
    // `removePane`（兄弟上提，见 layout/mutations.ts），所以「不留空 pane /
    // 不留零尺寸 pane」的不变量依然成立，结果是 pane 数 -1 而不是产生空组。
    // 剩下唯一的拒绝条件：pane 达上限时不允许产生新组（pane-edge 的语义就是新组）。
    return target.kind === 'pane-edge' && paneCount >= maxPanes;
  };

  /** 组内可重排的终端顺序：显式 pane 用树内顺序，隐式单组用上游可见顺序。 */
  const orderedTerminalIds = (): string[] => {
    const pane = layout === null ? null : findPane(layout, paneId);
    if (pane !== null) return [...pane.terminalIds];
    return terminals.map((terminal) => terminal.terminalId);
  };

  const handleTabKeyDown = (terminalId: string, event: KeyboardEvent<HTMLDivElement>): void => {
    if (!event.altKey) return;
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();

    if (!event.shiftKey) {
      // Alt+←/→：组内重排（等价于拖到本组 tab 条的第 N 个槽位）。
      const ids = orderedTerminalIds();
      const from = ids.indexOf(terminalId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      actions.moveTerminalByDrop(terminalId, { kind: 'tab-strip', index: to }, paneId);
      return;
    }

    // Alt+Shift+←/→：移到 DFS 相邻组（不存在相邻组时静默不动）。
    if (layout === null) return;
    const panes = enumeratePanes(layout);
    const sourceIndex = panes.findIndex((pane) => pane.id === paneId);
    const neighbor = sourceIndex < 0 ? undefined : panes[sourceIndex + delta];
    if (neighbor === undefined) return;
    const target: TerminalDropTarget = { kind: 'pane-center', paneId: neighbor.id };
    if (evaluateRejected(target, null)) return;
    actions.moveTerminalByDrop(terminalId, target);
  };

  const binding: TerminalTabDragBinding = {
    draggingTerminalId: tabDrag?.terminalId ?? null,
    dropOnStrip:
      tabDrag !== null &&
      !tabDrag.rejected &&
      tabDrag.target.kind === 'tab-strip' &&
      tabDrag.tabStripPaneId === paneId,
    onTabKeyDown: handleTabKeyDown,
    onTabPointerDown: (terminalId, event) => {
      if (event.button !== 0) return;
      suppressClickRef.current = false;
      sessionRef.current = {
        terminalId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        resolution: null,
        rejected: false,
      };
      // 捕获挂在 tab 上：指针离开命中区（甚至离开窗口）后 pointermove 仍回传到这里，
      // 再冒泡到 tab 条容器上的 move/up 处理器；普通点击的 click 会被浏览器重定向到
      // tab 容器（见 TerminalTabStrip 的容器级 onClick/onDoubleClick）。
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onStripPointerMove: (event) => {
      const session = sessionRef.current;
      if (session === null) return;
      if (!session.active) {
        const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
        if (moved < TAB_DRAG_THRESHOLD_PX) return;
        session.active = true;
        suppressClickRef.current = true;
      }
      const resolution = resolveTabDrop(
        event.currentTarget,
        session.terminalId,
        { x: event.clientX, y: event.clientY },
        isDirectionAllowed,
      );
      const rejected = evaluateRejected(resolution.target, resolution.tabStripPaneId);
      session.resolution = resolution;
      session.rejected = rejected;
      // 只更新预览（瞬态）；**不落盘** —— 布局树的写路径只有 drop 一次。
      const next: TerminalTabDragState = {
        terminalId: session.terminalId,
        sourcePaneId: paneId,
        target: resolution.target,
        tabStripPaneId: resolution.tabStripPaneId,
        rejected,
      };
      if (!sameDragPreview(tabDrag, next)) setTabDrag(next);
    },
    onStripPointerUp: (event) => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session === null) return;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // 浏览器在 pointerup 时会自动释放捕获；这里只兜住 jsdom 替身。
      }
      setTabDrag(null);
      if (!session.active || session.resolution === null || session.rejected) return;
      actions.moveTerminalByDrop(
        session.terminalId,
        session.resolution.target,
        session.resolution.tabStripPaneId ?? undefined,
      );
    },
    onStripPointerCancel: (event) => {
      sessionRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // 同上：取消失败不影响状态收口。
      }
      setTabDrag(null);
    },
  };

  return {
    binding,
    takeClickSuppression: () => {
      if (!suppressClickRef.current) return false;
      suppressClickRef.current = false;
      return true;
    },
  };
}

export function TerminalPane({ paneId, terminals, activeTerminalId }: TerminalPaneProps) {
  const {
    activePaneId,
    setActivePaneId,
    actions,
    view,
    busyPaneId,
    paneCount,
    maxPanes,
    totalTerminalCount,
    preferredSplitDirection,
    tabDrag,
    renameRequest,
    requestRename,
    clearRenameRequest,
    shellProfiles,
  } = useTerminalLayoutContext();
  // 行内重命名是纯 pane 内的瞬态 UI 态：每个 pane 各自持有，互不干扰。
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // tab 右键菜单（瞬态）：被点击的 terminalId + 视口坐标；同一时刻最多一个。
  const [tabMenu, setTabMenu] = useState<{ terminalId: string; x: number; y: number } | null>(null);
  const tabDragGesture = useTabDragGesture(paneId, terminals);

  const activeTerminal =
    terminals.find((terminal) => terminal.terminalId === activeTerminalId) ?? null;
  const isActivePane = activePaneId === paneId;
  const sessionReady = Boolean(view.sessionId && view.token);
  const busy = busyPaneId !== null;

  const splitDisabledReason =
    paneCount >= maxPanes
      ? paneLimitMessage(maxPanes)
      : terminals.length === 0
        ? '当前组没有终端，先新建一个'
        : !sessionReady
          ? '会话未就绪，无法新建终端'
          : undefined;
  const mergeDisabledReason =
    terminals.length >= totalTerminalCount ? '当前组已包含所有终端' : undefined;
  // 窄屏（<768px）放不下左右并排：菜单里只保留「向下拆分」。
  const splitMenuDirections: readonly TerminalSplitDirection[] =
    preferredSplitDirection === 'column' ? ['column'] : ['row', 'column'];

  // 落点预览：拒绝的落点不渲染任何高亮（只有禁止光标），避免「看起来能放」。
  const dropTarget = tabDrag !== null && !tabDrag.rejected ? tabDrag.target : null;
  const dropCenter = dropTarget?.kind === 'pane-center' && dropTarget.paneId === paneId;
  const dropEdge =
    dropTarget?.kind === 'pane-edge' && dropTarget.paneId === paneId ? dropTarget.edge : null;

  const startRename = (terminalId: string, label: string): void => {
    setRenamingId(terminalId);
    setRenameValue(label);
  };

  const commitRename = (): void => {
    if (renamingId !== null) {
      const trimmed = renameValue.trim();
      actions.renameTerminal(renamingId, trimmed.length > 0 ? trimmed : null);
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const requestRenameActive = (): void => {
    if (activeTerminal === null) return;
    const index = terminals.findIndex(
      (terminal) => terminal.terminalId === activeTerminal.terminalId,
    );
    startRename(activeTerminal.terminalId, terminalTabLabel(activeTerminal, Math.max(index, 0)));
  };

  // 内容区右键「重命名」：请求由面板层转发，只有目标 pane 且终端仍在本组时才消费。
  // 不匹配的请求保持原样（不抢其他 pane 的请求），孤儿请求由会话切换时的清空收口。
  useEffect(() => {
    if (renameRequest === null || renameRequest.paneId !== paneId) return;
    const index = terminals.findIndex(
      (terminal) => terminal.terminalId === renameRequest.terminalId,
    );
    const target = index < 0 ? undefined : terminals[index];
    if (target === undefined) return;
    startRename(target.terminalId, terminalTabLabel(target, index));
    clearRenameRequest();
  }, [renameRequest, paneId, terminals, clearRenameRequest]);

  /**
   * 「关闭其他」的唯一实现：关闭本组除 `exceptTerminalId` 外的终端。
   * 保留谁由调用方给定 —— ⋯ / 内容区菜单保留 active 终端，tab 右键菜单保留被点击的 tab。
   */
  const closeOtherTerminals = (exceptTerminalId: string | null): void => {
    actions.closeTerminals(
      terminals
        .filter((terminal) => terminal.terminalId !== exceptTerminalId)
        .map((terminal) => terminal.terminalId),
    );
  };

  const paneMenuItems = buildTerminalCommandItems({
    terminalCount: terminals.length,
    totalTerminalCount,
    sessionReady,
    creating: busy,
    splitDisabledReason,
    splitDirections: splitMenuDirections,
    onRequestCreate: () => actions.createTerminal(paneId),
    onRequestSplit: (direction) => actions.splitPane(paneId, direction),
    onRequestKill: () => {
      if (activeTerminal !== null) actions.killTerminal(activeTerminal.terminalId);
    },
    // 走面板级请求通道而不是直接改本 pane 的行内状态：菜单点击发生在终端内容子树，
    // 与持有输入框状态的 tab 条不是同一棵子树（见 TerminalLayoutContext 的说明）。
    onRequestRename: () => {
      if (activeTerminal !== null) requestRename(paneId, activeTerminal.terminalId);
    },
    onRequestCloseOthers: () => closeOtherTerminals(activeTerminalId),
    onRequestCloseAll: () => actions.closeAllTerminals(),
  });

  /**
   * tab 右键菜单：项集 / 顺序 / 措辞模板与内容区菜单同源（`buildTerminalCommandItems`），
   * 只是把所有涉及终端的目标换成被点击的那个 tab。
   *
   * 不隐式激活被点击的 tab：菜单语义是「对这一个终端做操作」，标题里的「该终端」
   * 已经把目标写清楚；顺手切换 active 会连带改变 ⋯ 菜单与内容区菜单的作用对象
   * （它们看 active），用户只是右键看一眼就要付出换焦点的代价。
   */
  const buildTabMenuItems = (terminalId: string): TerminalContextMenuItem[] =>
    buildTerminalCommandItems({
      terminalCount: terminals.length,
      totalTerminalCount,
      sessionReady,
      creating: busy,
      splitDisabledReason,
      splitDirections: splitMenuDirections,
      target: { long: '该终端', short: '该终端' },
      onRequestCreate: () => actions.createTerminal(paneId),
      onRequestSplit: (direction) => actions.splitPane(paneId, direction),
      onRequestKill: () => actions.killTerminal(terminalId),
      // 复用 phase-1 的重命名请求通道：tab 条持有输入框状态，菜单在 pane 内构建，
      // 两个入口必须走同一套「请求 → 目标 pane 消费 → startRename」，不允许第二条。
      onRequestRename: () => requestRename(paneId, terminalId),
      onRequestCloseOthers: () => closeOtherTerminals(terminalId),
      onRequestCloseAll: () => actions.closeAllTerminals(),
    });

  return (
    <section
      className="terminal-pane"
      data-pane-id={paneId}
      data-active={isActivePane ? 'true' : 'false'}
      data-drop-center={dropCenter ? 'true' : undefined}
      data-testid={`terminal-pane-${paneId}`}
      onMouseDownCapture={() => {
        if (!isActivePane) setActivePaneId(paneId);
      }}
      onFocusCapture={() => {
        if (!isActivePane) setActivePaneId(paneId);
      }}
    >
      {dropEdge ? <div className="terminal-pane__drop-edge" data-edge={dropEdge} /> : null}
      <div className="terminal-panel__tab-strip terminal-pane__strip">
        <TerminalTabStrip
          paneId={paneId}
          terminals={terminals}
          activeId={activeTerminalId}
          renamingId={renamingId}
          renameValue={renameValue}
          drag={tabDragGesture.binding}
          onSelect={(terminalId) => {
            // 拖拽结束的那次 click 不是「选中」意图，吞掉以免顺带切换 active。
            if (tabDragGesture.takeClickSuppression()) return;
            // 带上可视索引：纯函数层「缺省索引 = 追加到末尾」，不传会让点击非 active
            // 的 tab 被重排到末尾。
            actions.selectTerminal(
              paneId,
              terminalId,
              terminals.findIndex((terminal) => terminal.terminalId === terminalId),
            );
          }}
          onStartRename={startRename}
          onRenameValueChange={setRenameValue}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          onClose={(terminalId) => actions.closeTerminal(terminalId)}
          onTabContextMenu={(terminalId, position) =>
            setTabMenu({ terminalId, x: position.x, y: position.y })
          }
        />
        <TerminalTabActions
          activeTerminal={activeTerminal}
          terminalCount={terminals.length}
          totalTerminalCount={totalTerminalCount}
          canCreate={sessionReady && !busy}
          creating={busyPaneId === paneId}
          onRequestCreate={() => actions.createTerminal(paneId)}
          shellProfiles={shellProfiles}
          onRequestCreateWithProfile={(shellProfileId) =>
            actions.createTerminal(paneId, shellProfileId)
          }
          onRequestKill={() => {
            if (activeTerminal !== null) actions.killTerminal(activeTerminal.terminalId);
          }}
          onRequestRename={requestRenameActive}
          onRequestClear={() => {
            if (activeTerminal !== null) actions.clearTerminal(activeTerminal);
          }}
          onRequestCloseOthers={() => closeOtherTerminals(activeTerminalId)}
          onRequestCloseAll={() => actions.closeAllTerminals()}
          onRequestSplit={() => actions.splitPane(paneId)}
          splitDisabledReason={splitDisabledReason}
          splitHint={preferredSplitDirection === 'column' ? '上下拆分' : '左右拆分'}
          splitMenuDirections={splitMenuDirections}
          onRequestSplitWithDirection={(direction) => actions.splitPane(paneId, direction)}
          onRequestMerge={() => actions.mergeOthersIntoPane(paneId)}
          mergeDisabledReason={mergeDisabledReason}
        />
      </div>
      <div className="terminal-pane__body">
        {activeTerminal ? (
          <InteractiveTerminalView
            key={activeTerminal.terminalId}
            gatewayUrl={view.gatewayUrl}
            token={view.token}
            sessionId={view.sessionId}
            terminal={activeTerminal}
            inputEnabled={view.inputEnabled(activeTerminal)}
            onWriteError={view.onWriteError}
            menuItems={paneMenuItems}
          />
        ) : (
          <div className="terminal-panel__empty">
            没有运行中的终端。点击 ＋ 新建一个，或让 agent 跑一条 bash 命令。
          </div>
        )}
      </div>
      {tabMenu ? (
        <TerminalContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={buildTabMenuItems(tabMenu.terminalId)}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
    </section>
  );
}
