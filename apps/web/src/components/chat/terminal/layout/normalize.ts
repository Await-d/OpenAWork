/**
 * `normalizeLayout` —— 布局树的安全归一化层。
 *
 * 本模块是整个分层里「最危险交互」的落点（见 workflow 的 ⚠️ 一节）：
 * 若在**切会话瞬间的空快照**上把树按「终端都不存在」归一，会清空用户布局，
 * 一旦落盘就永久销毁。防线就是 `liveIds: ReadonlySet<string> | null` 的
 * `null` 语义 —— 调用方「还不知道有哪些终端」时必须传 `null`，得到原样返回。
 */

import {
  HARD_MAX_PANES,
  MAX_PANES,
  MAX_RATIO,
  MIN_RATIO,
  type NormalizeOptions,
  type TerminalLayout,
  type TerminalLayoutNode,
  type TerminalPaneNode,
  type TerminalSplitNode,
} from './types.js';

const FALLBACK_RATIO = 0.5;

/** 把任意值归一成合法 ratio：非有限数（含 NaN / ±Infinity / 非 number）回落 0.5，再钳制。 */
export function clampRatio(ratio: number): number {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return FALLBACK_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/** maxPanes 归一：非法值回落 MAX_PANES，向下取整并钳制到 [1, HARD_MAX_PANES]。 */
export function resolveMaxPanes(maxPanes: number | undefined): number {
  if (typeof maxPanes !== 'number' || !Number.isFinite(maxPanes)) return MAX_PANES;
  return Math.min(HARD_MAX_PANES, Math.max(1, Math.floor(maxPanes)));
}

interface NormalizeState {
  /** 不变量 7：同一个 terminalId 全树最多出现一次，保留首次出现。 */
  seen: Set<string>;
  keptPanes: number;
  maxPanes: number;
}

/**
 * 归一化布局树。
 *
 * @param liveIds 现存终端 id 集合。**必须允许 null**：`null` 表示「调用方还不知道
 *   有哪些终端」（例如切换会话瞬间上游还是空快照），此时**原样返回 layout**，
 *   不做任何归一 —— 这是防止「切会话把用户布局清空」的类型级防护，不可改成必填。
 */
export function normalizeLayout(
  layout: TerminalLayout,
  liveIds: ReadonlySet<string> | null,
  options?: NormalizeOptions,
): TerminalLayout {
  if (liveIds === null) return layout;
  if (layout === null) return null;
  const state: NormalizeState = {
    seen: new Set<string>(),
    keptPanes: 0,
    maxPanes: resolveMaxPanes(options?.maxPanes),
  };
  return normalizeNode(layout, liveIds, state);
}

function normalizeNode(
  node: TerminalLayoutNode,
  liveIds: ReadonlySet<string>,
  state: NormalizeState,
): TerminalLayoutNode | null {
  if (node.kind === 'pane') return normalizePane(node, liveIds, state);
  return normalizeSplit(node, liveIds, state);
}

function normalizePane(
  pane: TerminalPaneNode,
  liveIds: ReadonlySet<string>,
  state: NormalizeState,
): TerminalLayoutNode | null {
  // 预算先于一切：pane 数超限时该 pane 直接消失，其终端按派生规则自然回到 tab 条。
  if (state.keptPanes >= state.maxPanes) return null;

  const source = Array.isArray(pane.terminalIds) ? pane.terminalIds : [];
  const kept: string[] = [];
  for (const terminalId of source) {
    if (!liveIds.has(terminalId)) continue;
    if (state.seen.has(terminalId)) continue;
    state.seen.add(terminalId);
    kept.push(terminalId);
  }
  const [firstKept] = kept;
  if (firstKept === undefined) return null;
  state.keptPanes += 1;

  const activeTerminalId = kept.includes(pane.activeTerminalId) ? pane.activeTerminalId : firstKept;
  const unchanged =
    kept.length === source.length &&
    kept.every((terminalId, index) => terminalId === source[index]) &&
    activeTerminalId === pane.activeTerminalId;
  if (unchanged) return pane;
  return { kind: 'pane', id: pane.id, terminalIds: kept, activeTerminalId };
}

function normalizeSplit(
  split: TerminalSplitNode,
  liveIds: ReadonlySet<string>,
  state: NormalizeState,
): TerminalLayoutNode | null {
  const children = Array.isArray(split.children) ? split.children : [];
  const [leftInput, rightInput] = children;
  const left = leftInput === undefined ? null : normalizeNode(leftInput, liveIds, state);
  const right = rightInput === undefined ? null : normalizeNode(rightInput, liveIds, state);

  // 规则 2/4：子节点被丢弃时用兄弟节点替换整个 split（上提一层），两个都丢弃则整棵消失。
  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;

  const ratio = clampRatio(split.ratio);
  const unchanged =
    split.children[0] === left && split.children[1] === right && split.ratio === ratio;
  if (unchanged) return split;
  return { kind: 'split', id: split.id, direction: split.direction, children: [left, right], ratio };
}
