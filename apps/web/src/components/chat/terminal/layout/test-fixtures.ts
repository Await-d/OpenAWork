/**
 * 布局纯函数层的测试夹具（仅供 `*.test.ts` 使用）。
 *
 * 单独成文件而不是塞进某个 test：queries / normalize / mutations / invariants 四组测试
 * 都要用同一套「合法树 + 脏数据」构造器，共用才能保证断言口径一致。
 */

import type { TerminalLayoutNode, TerminalPaneNode, TerminalSplitNode } from './types.js';

export function makePane(
  id: string,
  terminalIds: string[],
  activeTerminalId?: string,
): TerminalPaneNode {
  const [first] = terminalIds;
  if (first === undefined) {
    throw new Error('测试夹具 makePane 需要非空 terminalIds');
  }
  return { kind: 'pane', id, terminalIds, activeTerminalId: activeTerminalId ?? first };
}

export function makeSplit(
  id: string,
  direction: TerminalSplitNode['direction'],
  children: readonly [TerminalLayoutNode, TerminalLayoutNode],
  ratio = 0.5,
): TerminalSplitNode {
  return { kind: 'split', id, direction, children, ratio };
}

/** 构造 ratio 为脏值（NaN / Infinity / 非 number）的 split —— 用来测规则 5。 */
export function makeDirtyRatioSplit(
  ratio: unknown,
  children: readonly [TerminalLayoutNode, TerminalLayoutNode],
  id = 'dirty-split',
): TerminalSplitNode {
  return { kind: 'split', id, direction: 'row', children, ratio } as unknown as TerminalSplitNode;
}

/** 深拷贝（保留 NaN，用于「入参前后深比较不变」）。 */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 深冻结：任何 mutation 试图改入参都会在严格模式下抛 TypeError。 */
export function deepFreeze<T>(value: T): T {
  freezeDeep(value);
  return value;
}

function freezeDeep(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeDeep(child);
  }
}
