/**
 * 布局树的结构变更（全部纯函数）。
 *
 * 约定：
 *  - **不改入参**，返回新对象；React Compiler 以不可变性为前提。
 *  - **失败 / 无变化时返回原树引用**，调用方用 `===` 判断「无变化」即可跳过渲染与落盘。
 *  - 每个导出的函数返回时都满足 `assertLayoutInvariants`（见 `invariants-helpers.ts`）。
 */

import { clampRatio, resolveMaxPanes } from './normalize.js';
import { countPanes, createPane, findPane, findSplit } from './queries.js';
import type {
  MoveTerminalOptions,
  SplitPaneOptions,
  TerminalDropTarget,
  TerminalLayout,
  TerminalLayoutNode,
  TerminalPaneEdge,
  TerminalPaneNode,
  TerminalSplitDirection,
  TerminalSplitNode,
  TerminalSplitPosition,
} from './types.js';

interface NodeEdit {
  node: TerminalLayoutNode | null;
  changed: boolean;
}

type NodeTransform = (node: TerminalLayoutNode) => NodeEdit;

/** 深度优先找到目标节点并就地替换；目标节点被替换成 null 时由 `liftSplit` 上提兄弟。 */
function editNode(node: TerminalLayoutNode, transform: NodeTransform): NodeEdit {
  const direct = transform(node);
  if (direct.changed || node.kind !== 'split') return direct;

  const left = editNode(node.children[0], transform);
  const right = editNode(node.children[1], transform);
  if (!left.changed && !right.changed) return { node, changed: false };
  return liftSplit(node, left.node, right.node);
}

/** 子节点被摘空时的收敛：一元化到剩下的兄弟，两个都空则整棵消失。 */
function liftSplit(
  split: TerminalSplitNode,
  left: TerminalLayoutNode | null,
  right: TerminalLayoutNode | null,
): NodeEdit {
  if (left === null && right === null) return { node: null, changed: true };
  if (left === null) return { node: right, changed: true };
  if (right === null) return { node: left, changed: true };
  return {
    node: {
      kind: 'split',
      id: split.id,
      direction: split.direction,
      children: [left, right],
      ratio: split.ratio,
    },
    changed: true,
  };
}

function applyEdit(layout: TerminalLayout, transform: NodeTransform): TerminalLayout {
  if (layout === null) return null;
  const result = editNode(layout, transform);
  return result.changed ? result.node : layout;
}

function replacePaneNode(paneId: string, next: TerminalLayoutNode | null): NodeTransform {
  return (node) =>
    node.kind === 'pane' && node.id === paneId
      ? { node: next, changed: true }
      : { node, changed: false };
}

/** 摘掉一个终端；`null` 表示这个 pane 会因此变空（等价于 removePane）。 */
function withoutTerminal(pane: TerminalPaneNode, terminalId: string): TerminalPaneNode | null {
  if (!pane.terminalIds.includes(terminalId)) return pane;
  const terminalIds = pane.terminalIds.filter((id) => id !== terminalId);
  const [first] = terminalIds;
  if (first === undefined) return null;
  const activeTerminalId = terminalIds.includes(pane.activeTerminalId)
    ? pane.activeTerminalId
    : first;
  return { kind: 'pane', id: pane.id, terminalIds, activeTerminalId };
}

function withTerminalAt(
  pane: TerminalPaneNode,
  terminalId: string,
  index: number | undefined,
  length: number,
): TerminalPaneNode {
  const terminalIds = pane.terminalIds.filter((id) => id !== terminalId);
  terminalIds.splice(resolveInsertIndex(index, length), 0, terminalId);
  return { kind: 'pane', id: pane.id, terminalIds, activeTerminalId: terminalId };
}

function resolveInsertIndex(index: number | undefined, length: number): number {
  if (typeof index !== 'number' || !Number.isFinite(index)) return length;
  return Math.min(length, Math.max(0, Math.floor(index)));
}

function describeEdge(edge: TerminalPaneEdge): {
  direction: TerminalSplitDirection;
  position: TerminalSplitPosition;
} {
  switch (edge) {
    case 'left':
      return { direction: 'row', position: 'first' };
    case 'right':
      return { direction: 'row', position: 'second' };
    case 'top':
      return { direction: 'column', position: 'first' };
    case 'bottom':
      return { direction: 'column', position: 'second' };
  }
}

/**
 * 把目标 pane 一分为二。
 *
 * 纯函数层**不创建终端**（D3：split 默认新建终端是调用方的副作用），因此新 pane
 * 需要一个种子终端才能满足「禁止空 pane」不变量 —— 见 `SplitPaneOptions.seedTerminalId`。
 * 未显式给种子时，退化为把目标组的 active 终端挪进新组（组内剩余终端 >= 1 才可行）。
 *
 * 超出 maxPanes、目标 pane 不存在、无可用种子时均返回原树。
 */
export function splitPane(
  layout: TerminalLayout,
  paneId: string,
  direction: TerminalSplitDirection,
  newPaneId: string,
  options?: SplitPaneOptions,
): TerminalLayout {
  const maxPanes = resolveMaxPanes(options?.maxPanes);
  const explicitSeed = options?.seedTerminalId;

  // 显式种子可能已在树里任意位置：先摘掉以维持「全树唯一」，它的原 pane 若被清空会顺带上提。
  const base = explicitSeed === undefined ? layout : removeTerminal(layout, explicitSeed);
  if (countPanes(base) >= maxPanes) return layout;

  const target = findPane(base, paneId);
  if (target === null) return layout;

  const seedId = explicitSeed ?? target.activeTerminalId;
  const targetPane = explicitSeed === undefined ? withoutTerminal(target, seedId) : target;
  if (targetPane === null) return layout;

  const newPane = createPane([seedId], newPaneId);
  const position = options?.position ?? 'second';
  const children: [TerminalLayoutNode, TerminalLayoutNode] =
    position === 'first' ? [newPane, targetPane] : [targetPane, newPane];

  const split: TerminalSplitNode = {
    kind: 'split',
    // id 由新 pane 派生：同一对 (paneId, newPaneId) 的拆分是幂等的，无需额外 id 参数。
    id: `split-${newPaneId}`,
    direction,
    children,
    ratio: 0.5,
  };
  return applyEdit(base, replacePaneNode(paneId, split));
}

/** 移除 pane，兄弟节点上提；根被移除 → null。 */
export function removePane(layout: TerminalLayout, paneId: string): TerminalLayout {
  return applyEdit(layout, replacePaneNode(paneId, null));
}

/** 从所属 pane 移除终端；pane 因此变空时等同 removePane（兄弟上提）。 */
export function removeTerminal(layout: TerminalLayout, terminalId: string): TerminalLayout {
  return applyEdit(layout, (node) => {
    if (node.kind !== 'pane') return { node, changed: false };
    const next = withoutTerminal(node, terminalId);
    if (next === node) return { node, changed: false };
    return { node: next, changed: true };
  });
}

/**
 * 把终端插入目标 pane（`index` 缺省追加到末尾），并设为该组 active。
 * 若该 terminalId 已在树中别处则**先移除再插入**，维持不变量 7（全树唯一）。
 */
export function insertTerminalIntoPane(
  layout: TerminalLayout,
  paneId: string,
  terminalId: string,
  index?: number,
): TerminalLayout {
  const pane = findPane(layout, paneId);
  if (pane === null) return layout;

  // 已在目标组内：只做组内重排，避免「先摘后插」把整棵树重建一遍。
  if (pane.terminalIds.includes(terminalId)) {
    const next = withTerminalAt(pane, terminalId, index, pane.terminalIds.length - 1);
    const unchanged =
      pane.activeTerminalId === terminalId &&
      next.terminalIds.every((id, position) => id === pane.terminalIds[position]);
    if (unchanged) return layout;
    return applyEdit(layout, replacePaneNode(paneId, next));
  }

  const without = removeTerminal(layout, terminalId);
  const target = findPane(without, paneId);
  if (target === null) return layout;
  const next = withTerminalAt(target, terminalId, index, target.terminalIds.length);
  return applyEdit(without, replacePaneNode(paneId, next));
}

/**
 * 拖拽落点的统一入口。
 *
 * - `detach` / `tab-strip` → 从树上移除（成为独立 tab）；tab 条的插入位由调用方用真实
 *   DOM 几何决定，本层没有 tab 槽位信息。
 * - `pane-center` → 并进该组末尾并设为 active。
 * - `pane-edge` → 以被拖拽终端为种子拆分目标组（左/上 → 新组在前）。
 */
export function moveTerminal(
  layout: TerminalLayout,
  terminalId: string,
  target: TerminalDropTarget,
  options: MoveTerminalOptions,
): TerminalLayout {
  switch (target.kind) {
    case 'detach':
    case 'tab-strip':
      return removeTerminal(layout, terminalId);
    case 'pane-center':
      return insertTerminalIntoPane(layout, target.paneId, terminalId);
    case 'pane-edge': {
      const { direction, position } = describeEdge(target.edge);
      return splitPane(layout, target.paneId, direction, options.newPaneId, {
        seedTerminalId: terminalId,
        position,
        maxPanes: options.maxPanes,
      });
    }
  }
}

export function setPaneActiveTerminal(
  layout: TerminalLayout,
  paneId: string,
  terminalId: string,
): TerminalLayout {
  const pane = findPane(layout, paneId);
  if (pane === null) return layout;
  if (pane.activeTerminalId === terminalId) return layout;
  if (!pane.terminalIds.includes(terminalId)) return layout;
  return applyEdit(
    layout,
    replacePaneNode(paneId, { ...pane, activeTerminalId: terminalId }),
  );
}

/** 设置分隔比例：非法值回落 0.5，合法值钳制到 [MIN_RATIO, MAX_RATIO]。 */
export function setSplitRatio(
  layout: TerminalLayout,
  splitId: string,
  ratio: number,
): TerminalLayout {
  const split = findSplit(layout, splitId);
  if (split === null) return layout;
  const next = clampRatio(ratio);
  if (next === split.ratio) return layout;
  return applyEdit(layout, (node) =>
    node.kind === 'split' && node.id === splitId
      ? { node: { ...node, ratio: next }, changed: true }
      : { node, changed: false },
  );
}
