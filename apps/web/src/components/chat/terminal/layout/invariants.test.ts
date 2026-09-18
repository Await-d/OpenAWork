/**
 * 不变量测试：辅助函数自身的判定力 + 「任意 mutation 序列后不变量恒成立」的确定性 fuzz。
 */

import { describe, expect, it } from 'vitest';
import { assertLayoutInvariants, collectLayoutViolations } from './invariants-helpers.js';
import {
  insertTerminalIntoPane,
  moveTerminal,
  removePane,
  removeTerminal,
  setPaneActiveTerminal,
  setSplitRatio,
  splitPane,
} from './mutations.js';
import { normalizeLayout } from './normalize.js';
import { countPanes, enumeratePanes } from './queries.js';
import { clone, makePane, makeSplit } from './test-fixtures.js';
import {
  MAX_PANES,
  type TerminalDropTarget,
  type TerminalLayout,
  type TerminalLayoutNode,
  type TerminalPaneEdge,
} from './types.js';

const EDGES: readonly TerminalPaneEdge[] = ['top', 'bottom', 'left', 'right'];

describe('assertLayoutInvariants 的判定力', () => {
  it('null 与合法树通过', () => {
    expect(collectLayoutViolations(null)).toEqual([]);
    assertLayoutInvariants(null);
    assertLayoutInvariants(
      makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b', 'c'])]),
    );
  });

  it('空 pane 被抓', () => {
    expect(() =>
      assertLayoutInvariants({ kind: 'pane', id: 'p1', terminalIds: [], activeTerminalId: 'a' }),
    ).toThrow(/禁止空 pane/);
  });

  it('active 不在 terminalIds 里被抓', () => {
    expect(() => assertLayoutInvariants(makePane('p1', ['a'], 'zzz'))).toThrow(/activeTerminalId/);
  });

  it('全树重复 terminalId 被抓', () => {
    expect(() =>
      assertLayoutInvariants(
        makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['a'])]),
      ),
    ).toThrow(/重复出现/);
  });

  it('ratio 越界 / NaN 被抓', () => {
    expect(() =>
      assertLayoutInvariants(
        makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])], 1.4),
      ),
    ).toThrow(/ratio/);
    expect(() =>
      assertLayoutInvariants(
        makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])], Number.NaN),
      ),
    ).toThrow(/ratio/);
  });
});

/** 确定性 LCG：失败可复现，不依赖 Math.random。 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('fuzz 需要非空候选集合');
  return item;
}

interface LayoutIds {
  paneIds: string[];
  splitIds: string[];
  terminalIds: string[];
}

function collectIds(layout: TerminalLayout): LayoutIds {
  const paneIds: string[] = [];
  const splitIds: string[] = [];
  const terminalIds: string[] = [];
  const walk = (node: TerminalLayoutNode): void => {
    if (node.kind === 'pane') {
      paneIds.push(node.id);
      terminalIds.push(...node.terminalIds);
      return;
    }
    splitIds.push(node.id);
    walk(node.children[0]);
    walk(node.children[1]);
  };
  if (layout !== null) walk(layout);
  return { paneIds, splitIds, terminalIds };
}

function randomTarget(rng: () => number, ids: LayoutIds): TerminalDropTarget {
  const roll = rng();
  if (roll < 0.2) return { kind: 'detach' };
  if (roll < 0.35) return { kind: 'tab-strip', index: Math.floor(rng() * 5) };
  if (roll < 0.7) return { kind: 'pane-center', paneId: pick(rng, ids.paneIds) };
  return { kind: 'pane-edge', paneId: pick(rng, ids.paneIds), edge: pick(rng, EDGES) };
}

describe('任意 mutation 序列后不变量恒成立', () => {
  it('50 轮 × 80 步随机操作（含新建 id / 越界比例 / 拖拽全形态）', () => {
    const rng = createRng(20260916);
    let serial = 0;

    for (let round = 0; round < 50; round += 1) {
      // 起点：一棵合法树（3 个 pane），外加一批「还不存在于树里」的终端 id。
      let layout: TerminalLayout = makeSplit('s-root', 'row', [
        makePane(`p${round}-a`, ['a0', 'a1']),
        makeSplit('s-root2', 'column', [
          makePane(`p${round}-b`, ['b0']),
          makePane(`p${round}-c`, ['c0']),
        ]),
      ]);
      const pool = ['a0', 'a1', 'b0', 'c0'];

      for (let step = 0; step < 80; step += 1) {
        if (layout === null) {
          serial += 1;
          layout = makePane(`reseed-${serial}`, [`n${serial}`]);
          pool.push(`n${serial}`);
        }
        const ids = collectIds(layout);
        const before = clone(layout);
        const roll = rng();
        let next: TerminalLayout;

        if (roll < 0.18) {
          serial += 1;
          const newId = `n${serial}`;
          pool.push(newId);
          next = splitPane(
            layout,
            pick(rng, ids.paneIds),
            rng() < 0.5 ? 'row' : 'column',
            `np${serial}`,
            {
              seedTerminalId: rng() < 0.5 ? newId : pick(rng, [...ids.terminalIds, ...pool]),
              position: rng() < 0.5 ? 'first' : 'second',
            },
          );
        } else if (roll < 0.28) {
          next = removePane(layout, pick(rng, ids.paneIds));
        } else if (roll < 0.42) {
          next = removeTerminal(layout, pick(rng, [...ids.terminalIds, ...pool]));
        } else if (roll < 0.6) {
          serial += 1;
          const candidate = rng() < 0.5 ? `n${serial}` : pick(rng, [...ids.terminalIds, ...pool]);
          pool.push(candidate);
          next = insertTerminalIntoPane(
            layout,
            pick(rng, ids.paneIds),
            candidate,
            rng() < 0.5 ? undefined : Math.floor(rng() * 8) - 3,
          );
        } else if (roll < 0.8) {
          serial += 1;
          next = moveTerminal(
            layout,
            pick(rng, [...ids.terminalIds, ...pool]),
            randomTarget(rng, ids),
            {
              newPaneId: `np${serial}`,
            },
          );
        } else if (roll < 0.9) {
          next = setPaneActiveTerminal(
            layout,
            pick(rng, ids.paneIds),
            pick(rng, [...ids.terminalIds, ...pool]),
          );
        } else if (ids.splitIds.length > 0) {
          next = setSplitRatio(layout, pick(rng, ids.splitIds), rng() * 1.4 - 0.2);
        } else {
          // 单组布局没有 split 可调比例 → 退化为插入一个新终端。
          serial += 1;
          pool.push(`n${serial}`);
          next = insertTerminalIntoPane(layout, pick(rng, ids.paneIds), `n${serial}`);
        }

        assertLayoutInvariants(next);
        expect(layout, `round=${round} step=${step} 入参被改写`).toEqual(before);
        expect(countPanes(next)).toBeLessThanOrEqual(MAX_PANES);
        layout = next;
      }
    }
  });

  it('脏数据起点：先归一化再跑序列，仍然恒满足不变量', () => {
    const dirty = makeSplit('s1', 'row', [
      makePane('p1', ['live-1', 'live-1', 'dead']),
      makeSplit('s2', 'column', [makePane('p2', ['live-2']), makePane('p3', ['dead-2'])]),
    ]);
    const liveIds = new Set(['live-1', 'live-2']);
    let layout = normalizeLayout(dirty, liveIds);
    assertLayoutInvariants(layout);
    expect(enumeratePanes(layout).map((pane) => pane.terminalIds)).toEqual([
      ['live-1'],
      ['live-2'],
    ]);

    let serial = 0;
    const rng = createRng(7);
    for (let step = 0; step < 40; step += 1) {
      serial += 1;
      const ids = collectIds(layout);
      layout = insertTerminalIntoPane(layout, pick(rng, ids.paneIds), `fresh-${serial}`);
      assertLayoutInvariants(layout);
    }
    expect(countPanes(layout)).toBe(2);
  });
});
