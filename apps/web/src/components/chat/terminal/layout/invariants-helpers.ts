/**
 * 布局不变量的测试辅助（仅供 `*.test.ts` 使用，不参与运行时渲染）。
 *
 * 「每 pane >= 1 终端 / active ∈ terminalIds / split 恰 2 子 / 全树 terminalId 唯一 /
 * ratio ∈ [MIN_RATIO, MAX_RATIO]」是纯函数层的规格本身，所以任何 mutation 序列跑完
 * 都可以直接调用 `assertLayoutInvariants` 一次性验证。
 */

import { MAX_RATIO, MIN_RATIO, type TerminalLayout, type TerminalLayoutNode } from './types.js';

function walk(
  node: TerminalLayoutNode,
  path: string,
  violations: string[],
  seen: Set<string>,
): void {
  if (node.kind === 'pane') {
    if (!Array.isArray(node.terminalIds) || node.terminalIds.length < 1) {
      violations.push(`${path}: pane ${node.id} 的 terminalIds 为空（禁止空 pane）`);
    }
    for (const terminalId of node.terminalIds) {
      if (seen.has(terminalId)) {
        violations.push(`${path}: terminalId ${terminalId} 在整棵树里重复出现`);
      }
      seen.add(terminalId);
    }
    if (!node.terminalIds.includes(node.activeTerminalId)) {
      violations.push(
        `${path}: pane ${node.id} 的 activeTerminalId=${node.activeTerminalId} 不在 terminalIds 里`,
      );
    }
    return;
  }

  if (!Number.isFinite(node.ratio) || node.ratio < MIN_RATIO || node.ratio > MAX_RATIO) {
    violations.push(`${path}: split ${node.id} 的 ratio=${node.ratio} 越界`);
  }
  const children = node.children;
  if (!Array.isArray(children) || children.length !== 2) {
    violations.push(`${path}: split ${node.id} 必须恰好 2 个子节点`);
    return;
  }
  const [left, right] = children;
  walk(left, `${path}.0`, violations, seen);
  walk(right, `${path}.1`, violations, seen);
}

export function collectLayoutViolations(layout: TerminalLayout): string[] {
  const violations: string[] = [];
  if (layout === null) return violations;
  walk(layout, 'root', violations, new Set<string>());
  return violations;
}

export function assertLayoutInvariants(layout: TerminalLayout): void {
  const violations = collectLayoutViolations(layout);
  if (violations.length > 0) {
    throw new Error(`布局不变量被破坏:\n- ${violations.join('\n- ')}`);
  }
}
