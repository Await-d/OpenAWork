/**
 * 查询层：DFS 顺序、唯一构造入口、查找语义。
 */

import { describe, expect, it } from 'vitest';
import {
  countPanes,
  createPane,
  enumeratePanes,
  findPane,
  findPaneContaining,
  findSplit,
  layoutTerminalIds,
} from './queries.js';
import { assertLayoutInvariants } from './invariants-helpers.js';
import { makePane, makeSplit } from './test-fixtures.js';
import type { TerminalLayoutNode } from './types.js';

describe('createPane', () => {
  it('以第一个 terminalId 作为 active，缺省 id 由它派生', () => {
    const pane = createPane(['t1', 't2']);
    expect(pane).toEqual({
      kind: 'pane',
      id: 'pane-t1',
      terminalIds: ['t1', 't2'],
      activeTerminalId: 't1',
    });
  });

  it('尊重显式 id', () => {
    expect(createPane(['t1'], 'custom').id).toBe('custom');
  });

  it('数组内重复 id 只保留首次出现', () => {
    expect(createPane(['t1', 't1', 't2']).terminalIds).toEqual(['t1', 't2']);
  });

  it('空数组（含去重后为空）抛错 —— 禁止空 pane', () => {
    expect(() => createPane([])).toThrow(/禁止空 pane/);
  });

  it('产出的 pane 满足不变量', () => {
    const pane = createPane(['t1']);
    expect(() => assertLayoutInvariants(pane)).not.toThrow();
  });
});

describe('enumeratePanes', () => {
  it('深度优先、从左到右', () => {
    const layout = makeSplit('s1', 'row', [
      makePane('p1', ['a']),
      makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p3', ['c', 'd'])]),
    ]);
    expect(enumeratePanes(layout).map((pane) => pane.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('六层以上嵌套仍按 DFS 顺序展开', () => {
    let layout: TerminalLayoutNode = makePane('p6', ['f']);
    for (let depth = 5; depth >= 1; depth -= 1) {
      layout = makeSplit(`s${depth}`, 'row', [makePane(`p${depth}`, [`t${depth}`]), layout]);
    }
    expect(enumeratePanes(layout).map((pane) => pane.id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
      'p6',
    ]);
  });

  it('null 布局 → 空数组', () => {
    expect(enumeratePanes(null)).toEqual([]);
    expect(countPanes(null)).toBe(0);
  });
});

describe('layoutTerminalIds / countPanes', () => {
  it('汇总全树 terminalId 且去重', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a', 'b']), makePane('p2', ['b', 'c'])]);
    expect([...layoutTerminalIds(layout)].sort()).toEqual(['a', 'b', 'c']);
    expect(countPanes(layout)).toBe(2);
  });
});

describe('findPane / findPaneContaining / findSplit', () => {
  const p3 = makePane('p3', ['c', 'd'], 'd');
  const layout = makeSplit('s1', 'row', [
    makePane('p1', ['a']),
    makeSplit('s2', 'column', [makePane('p2', ['b']), p3]),
  ]);

  it('findPane 返回节点本体', () => {
    expect(findPane(layout, 'p3')).toBe(p3);
    expect(findPane(layout, 'missing')).toBeNull();
  });

  it('findPaneContaining 返回 paneId，不在树里返回 null（= 应渲染成 tab）', () => {
    expect(findPaneContaining(layout, 'c')).toBe('p3');
    expect(findPaneContaining(layout, 'zzz')).toBeNull();
  });

  it('findSplit 支持深查找', () => {
    expect(findSplit(layout, 's2')?.id).toBe('s2');
    expect(findSplit(layout, 's3')).toBeNull();
  });
});
