/**
 * 布局树的查询与唯一构造入口（纯函数，无副作用）。
 *
 * 遍历顺序统一为**深度优先、从左到右**（`children[0]` 在 `children[1]` 之前），
 * 归一化裁剪（规则 6）与拖拽命中都依赖这个顺序保持一致。
 */

import type {
  TerminalLayout,
  TerminalLayoutNode,
  TerminalPaneNode,
  TerminalSplitNode,
} from './types.js';

function dedupeIds(terminalIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of terminalIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/**
 * 单一构造入口：保证「非空 + 无重复 + active ∈ terminalIds」三条不变量。
 *
 * @throws 空数组（含去重后为空）会抛错 —— 空 pane 是非法态，必须在构造处挡住。
 */
export function createPane(terminalIds: readonly string[], id?: string): TerminalPaneNode {
  const unique = dedupeIds(terminalIds);
  const [first] = unique;
  if (first === undefined) {
    throw new Error('createPane 需要至少一个 terminalId（禁止空 pane）');
  }
  return {
    kind: 'pane',
    id: id ?? `pane-${first}`,
    terminalIds: unique,
    activeTerminalId: first,
  };
}

function collectPanes(node: TerminalLayoutNode, out: TerminalPaneNode[]): void {
  if (node.kind === 'pane') {
    out.push(node);
    return;
  }
  collectPanes(node.children[0], out);
  collectPanes(node.children[1], out);
}

/** 深度优先、从左到右枚举所有 pane。 */
export function enumeratePanes(layout: TerminalLayout): readonly TerminalPaneNode[] {
  const panes: TerminalPaneNode[] = [];
  if (layout !== null) collectPanes(layout, panes);
  return panes;
}

/** 树里出现的所有 terminalId（去重集合）。 */
export function layoutTerminalIds(layout: TerminalLayout): Set<string> {
  const ids = new Set<string>();
  for (const pane of enumeratePanes(layout)) {
    for (const terminalId of pane.terminalIds) ids.add(terminalId);
  }
  return ids;
}

export function findPane(layout: TerminalLayout, paneId: string): TerminalPaneNode | null {
  for (const pane of enumeratePanes(layout)) {
    if (pane.id === paneId) return pane;
  }
  return null;
}

/** 返回持有该终端的 paneId；不在树里（= 应渲染成 tab）返回 null。 */
export function findPaneContaining(layout: TerminalLayout, terminalId: string): string | null {
  for (const pane of enumeratePanes(layout)) {
    if (pane.terminalIds.includes(terminalId)) return pane.id;
  }
  return null;
}

export function findSplit(layout: TerminalLayout, splitId: string): TerminalSplitNode | null {
  if (layout === null) return null;
  if (layout.kind === 'split') {
    if (layout.id === splitId) return layout;
    return findSplit(layout.children[0], splitId) ?? findSplit(layout.children[1], splitId);
  }
  return null;
}

export function countPanes(layout: TerminalLayout): number {
  return enumeratePanes(layout).length;
}
