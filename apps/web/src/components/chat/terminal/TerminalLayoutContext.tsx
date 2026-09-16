/**
 * TerminalLayoutContext — 分屏树的共享上下文（T-10 递归渲染器）。
 *
 * 为什么需要它：`TerminalSplitView` 是递归结构，深度不固定；「面板级环境」
 * （网关地址 / 会话 / token / 写失败上报）与「面板级动作」若靠 props 传递，
 * 每一层节点都要原样转发一遍。更重要的是 `activePaneId` 是**瞬态焦点态**
 * （D4：不持久化），它不属于任何一棵子树，只能由面板层持有。
 *
 * React 19 写法：`<TerminalLayoutContext value={...}>` —— 不再使用 `.Provider`。
 */

import { createContext, useContext } from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import type { TerminalDropTarget, TerminalLayout, TerminalSplitDirection } from './layout/types.js';

/**
 * T-12 拖拽的**瞬态预览**（不持久化）。
 *
 * 为什么放在面板级 context 而不是 tab 条本地：落点预览（pane 合并高亮 / 半边插入条）
 * 要渲染在**别的 pane** 上，只有面板级的单一状态源能让所有 pane 看到同一个当前落点。
 */
export interface TerminalTabDragState {
  /** 正在被拖拽的终端。 */
  terminalId: string;
  /** 拖出源组；用于预览排除（「拖走最后一终端」已放开为源组折叠，拒绝只剩 pane 上限）。 */
  sourcePaneId: string;
  /** 由 `resolveDropTarget` 解析出的落点。 */
  target: TerminalDropTarget;
  /**
   * `tab-strip` 落点所属 pane：纯函数层的 tab-strip 只带 index（它看不到 tab 几何），
   * 因此目标组由 DOM 侧补上，预览与提交都用它。
   */
  tabStripPaneId: string | null;
  /** 命中但被拒绝（pane 上限一类）：显示禁止光标、不渲染预览、drop 不落盘。 */
  rejected: boolean;
}

/**
 * 每个 pane 的操作区（＋ / ⊟ / ⋯）与 tab 条需要的面板级动作。
 *
 * 全部以 `paneId`（显式 pane 或隐式 pane 常量）为作用域参数，避免把「当前是哪个
 * pane」的推断下沉到动作实现里。
 */
export interface TerminalPaneActions {
  /** ＋：新建终端到该 pane 所在的组。 */
  createTerminal(paneId: string): void;
  /** ⊟ / ⋯ 方向拆分：POST 新终端后把该 pane 一分为二；方向缺省用 preferredSplitDirection。 */
  splitPane(paneId: string, direction?: TerminalSplitDirection): void;
  /** ⋯：把其他 tab 合并进该 pane 的组（纯函数层 insertTerminalIntoPane）。 */
  mergeOthersIntoPane(paneId: string): void;
  /** tab 单击：把该终端设为该组的 active（游离终端会先并入该组）。 */
  selectTerminal(paneId: string, terminalId: string, index?: number): void;
  /** tab × ：关闭单个终端。 */
  closeTerminal(terminalId: string): void;
  /** ⋯：关闭给定终端（调用方负责算好「其他」是哪几个）。 */
  closeTerminals(terminalIds: readonly string[]): void;
  /** ⋯：关闭全部终端。 */
  closeAllTerminals(): void;
  renameTerminal(terminalId: string, name: string | null): void;
  /** ⋯：向 active 终端写入 Ctrl+L（仅持久前台终端可用）。 */
  clearTerminal(terminal: SessionTerminalView): void;
  /** T-11：分隔条拖拽松手 / 键盘调整时提交比例（**唯一**落盘入口）。 */
  setRatio(splitId: string, ratio: number): void;
  /**
   * T-12 drop：一次落盘。
   *
   * `tab-strip` 的插入位由调用方按真实 tab 中点细化、目标组由 `tabStripPaneId` 给出
   * （纯函数层两者都没有）；其余落点直接用 target 的语义。
   */
  moveTerminalByDrop(terminalId: string, target: TerminalDropTarget, tabStripPaneId?: string): void;
}

/** 每 pane 的终端视图都要用的面板级只读环境。 */
export interface TerminalViewEnvironment {
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  /** 只有持久前台终端能接收 stdin（与既有 ACTIVE_STATUSES 判定同源）。 */
  inputEnabled(terminal: SessionTerminalView): boolean;
  onWriteError(message: string): void;
}

export interface TerminalLayoutContextValue {
  /** 当前焦点 pane；面板层保证它总是指向一个存在的 pane。 */
  activePaneId: string;
  setActivePaneId(paneId: string): void;
  /** 归一后的布局（只读）；null = 单组隐式 pane。 */
  layout: TerminalLayout;
  /** 当前 pane 数（含隐式 pane）。 */
  paneCount: number;
  maxPanes: number;
  /** 视口 <768px 时为 'column'（只允许上下拆分），否则 'row'。 */
  preferredSplitDirection: TerminalSplitDirection;
  /** 面板内可见终端总数（判「当前组已包含所有终端」用）。 */
  totalTerminalCount: number;
  /** 正在执行创建 / 拆分的 pane；非 null 时全部操作入口禁用，避免重入。 */
  busyPaneId: string | null;
  /** T-12 拖拽预览（瞬态）；null = 当前没有 tab 拖拽。 */
  tabDrag: TerminalTabDragState | null;
  /** T-12：pointermove 期间高频更新预览（**不落盘**）；null 清除。 */
  setTabDrag(state: TerminalTabDragState | null): void;
  view: TerminalViewEnvironment;
  actions: TerminalPaneActions;
}

export const TerminalLayoutContext = createContext<TerminalLayoutContextValue | null>(null);

/** 递归渲染器内使用；脱离提供者时立刻抛错而不是静默渲染成空。 */
export function useTerminalLayoutContext(): TerminalLayoutContextValue {
  const value = useContext(TerminalLayoutContext);
  if (value === null) {
    throw new Error('useTerminalLayoutContext 必须在 <TerminalLayoutContext> 内使用');
  }
  return value;
}
