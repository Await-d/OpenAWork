/**
 * 终端分屏布局的纯类型层。
 *
 * 语义来源：`.agentdocs/workflow/260916-终端面板-vscode布局对齐.md` 的 D1 / D2 / D3。
 *
 * - **叶子是「组」不是单个终端**：`TerminalPaneNode` 对应 VS Code 的一个 group，
 *   持有 1..N 个 `terminalId`，只有 `activeTerminalId` 会被渲染。
 * - **树只描述排布**：只引用 `terminalId`，永不决定终端是否存在（存在性真相在
 *   `useSessionTerminals.terminalsById`）。因此「不在树里的终端 → 渲染成 tab」
 *   是一条派生规则，树里删掉终端不需要任何额外补偿。
 * - **禁止空 pane**：`terminalIds` 构造上保证 `length >= 1`。
 */

/** 叶子 = 一个 VS Code 式的「组」：持有 1..N 个终端，只有 activeTerminalId 被渲染。 */
export interface TerminalPaneNode {
  kind: 'pane';
  /** 稳定 id（React key + 拖拽目标），跨拖拽不变。 */
  id: string;
  /** 构造上保证 >= 1（禁止空 pane）。 */
  terminalIds: string[];
  /** 必须 ∈ terminalIds。 */
  activeTerminalId: string;
}

export interface TerminalSplitNode {
  kind: 'split';
  id: string;
  /** row = 左右并排；column = 上下堆叠。 */
  direction: 'row' | 'column';
  /** 严格二元。 */
  children: readonly [TerminalLayoutNode, TerminalLayoutNode];
  /** children[0] 的主轴占比，钳制 [MIN_RATIO, MAX_RATIO]。 */
  ratio: number;
}

export type TerminalLayoutNode = TerminalPaneNode | TerminalSplitNode;

/** null = 无分屏（单组隐式 pane）。 */
export type TerminalLayout = TerminalLayoutNode | null;

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
/** 用户决策（D5）：pane 上限 4，硬顶 6。 */
export const MAX_PANES = 4;
/** 硬顶：允许调用方通过 options.maxPanes 放宽到 6，但不得超过。 */
export const HARD_MAX_PANES = 6;

export type TerminalSplitDirection = TerminalSplitNode['direction'];

/** 新 pane 插到 split 的前半还是后半（左/上 → 'first'）。 */
export type TerminalSplitPosition = 'first' | 'second';

export type TerminalPaneEdge = 'top' | 'bottom' | 'left' | 'right';

export type TerminalDropTarget =
  /** 重排（落回 tab 条）。 */
  | { kind: 'tab-strip'; index: number }
  /** 合并：并进该组。 */
  | { kind: 'pane-center'; paneId: string }
  /** 拆分该组。 */
  | { kind: 'pane-edge'; paneId: string; edge: TerminalPaneEdge }
  /** 移出树，成为独立 tab。 */
  | { kind: 'detach' };

export interface NormalizeOptions {
  /** 默认 MAX_PANES。 */
  maxPanes?: number;
}

export interface SplitPaneOptions {
  maxPanes?: number;
  /**
   * 新 pane 的种子终端。**必需**才能维持「禁止空 pane」不变量：
   * 纯函数层不创建终端（D3：创建终端是调用方的副作用），所以调用方先把新建的
   * `terminalId` 通过这里传进来，本函数一次性产出合法树，不留「空 pane」中间态。
   */
  seedTerminalId?: string;
  /** 默认 'second'（新 pane 在右/下）。 */
  position?: TerminalSplitPosition;
}

export interface MoveTerminalOptions {
  /** pane-edge 拆分时新 pane 的 id，由调用方生成（纯函数层不造 id）。 */
  newPaneId: string;
  maxPanes?: number;
}
