/**
 * 归一化：9 条规则逐条覆盖，重点是规则 1（liveIds === null 原样返回）与规则 6/7。
 */

import { describe, expect, it } from 'vitest';
import { clampRatio, normalizeLayout, resolveMaxPanes } from './normalize.js';
import { assertLayoutInvariants } from './invariants-helpers.js';
import { clone, deepFreeze, makeDirtyRatioSplit, makePane, makeSplit } from './test-fixtures.js';
import { countPanes, layoutTerminalIds } from './queries.js';
import { MAX_PANES, type TerminalLayout, type TerminalLayoutNode } from './types.js';

/** 5 个 pane 的嵌套树，DFS 顺序 = p1 → p5，终端 e1 → e5。 */
function fivePaneTree(): TerminalLayout {
  let node: TerminalLayoutNode = makePane('p5', ['e5']);
  for (let depth = 4; depth >= 1; depth -= 1) {
    node = makeSplit(`s${depth}`, 'row', [makePane(`p${depth}`, [`e${depth}`]), node]);
  }
  return node;
}

const FIVE_LIVE = new Set(['e1', 'e2', 'e3', 'e4', 'e5']);

describe('clampRatio / resolveMaxPanes', () => {
  it('clampRatio：非法值回落 0.5，合法值钳制到 [0.1, 0.9]', () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0.05)).toBe(0.1);
    expect(clampRatio(0.95)).toBe(0.9);
    expect(clampRatio(-3)).toBe(0.1);
    expect(clampRatio(3)).toBe(0.9);
    expect(clampRatio(Number.NaN)).toBe(0.5);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(clampRatio(Number.NEGATIVE_INFINITY)).toBe(0.5);
  });

  it('resolveMaxPanes：缺省 4，下取整，钳制到 [1, 6]', () => {
    expect(resolveMaxPanes(undefined)).toBe(MAX_PANES);
    expect(resolveMaxPanes(2.9)).toBe(2);
    expect(resolveMaxPanes(0)).toBe(1);
    expect(resolveMaxPanes(-5)).toBe(1);
    expect(resolveMaxPanes(99)).toBe(6);
    expect(resolveMaxPanes(Number.NaN)).toBe(MAX_PANES);
    expect(resolveMaxPanes(Number.POSITIVE_INFINITY)).toBe(MAX_PANES);
  });
});

describe('正常路径', () => {
  it('全存活时复用入参引用（结构共享 / 不可变性的前提）', () => {
    const layout = makeSplit(
      's1',
      'row',
      [makePane('p1', ['a']), makePane('p2', ['b', 'c'])],
      0.35,
    );
    expect(normalizeLayout(layout, new Set(['a', 'b', 'c']))).toBe(layout);
  });

  it('null 布局 → null（liveIds 非 null 时）', () => {
    expect(normalizeLayout(null, new Set(['a']))).toBeNull();
  });
});

describe('规则 1：liveIds === null 原样返回', () => {
  it('即使数据非法、且显式传了更小的 maxPanes，也不动布局', () => {
    const layout = makeDirtyRatioSplit(Number.NaN, [
      makePane('p1', ['dead']),
      makePane('p2', ['a']),
    ]);
    expect(normalizeLayout(layout, null)).toBe(layout);
    expect(normalizeLayout(layout, null, { maxPanes: 1 })).toBe(layout);
  });

  it('null 布局 + null liveIds → null', () => {
    expect(normalizeLayout(null, null)).toBeNull();
  });
});

describe('规则 2：过滤死终端、空 pane 丢弃、兄弟上提', () => {
  it('根 split 的一个子 pane 被清空 → 整个 split 由兄弟替换', () => {
    const survivor = makePane('p1', ['a']);
    const layout = makeSplit('s1', 'row', [survivor, makePane('p2', ['dead'])]);
    expect(normalizeLayout(layout, new Set(['a']))).toBe(survivor);
    assertLayoutInvariants(normalizeLayout(layout, new Set(['a'])));
  });

  it('嵌套 split 整棵死掉时向上逐层上提', () => {
    const survivor = makePane('p1', ['a']);
    const inner = makeSplit('s2', 'column', [makePane('p2', ['dead']), makePane('p3', ['dead2'])]);
    const layout = makeSplit('s1', 'row', [survivor, inner]);
    expect(normalizeLayout(layout, new Set(['a']))).toBe(survivor);
  });

  it('pane 内只有部分终端存活时只裁剪列表', () => {
    const layout = makePane('p1', ['a', 'dead', 'b']);
    const result = normalizeLayout(layout, new Set(['a', 'b']));
    expect(result).toEqual(makePane('p1', ['a', 'b']));
  });
});

describe('规则 3：active 失效时取过滤后第一个', () => {
  it('active 被裁掉 → 回落到首位', () => {
    const layout = makePane('p1', ['a', 'b'], 'b');
    expect(normalizeLayout(layout, new Set(['a']))).toEqual(makePane('p1', ['a']));
  });

  it('active 存活时保持原样（即使是第二位）', () => {
    const layout = makePane('p1', ['a', 'b'], 'b');
    const result = normalizeLayout(layout, new Set(['a', 'b']));
    expect(result).toBe(layout);
    if (result?.kind === 'pane') expect(result.activeTerminalId).toBe('b');
  });
});

describe('规则 4：两个孩子都被丢弃 → split 归一为 null', () => {
  it('根 split 两个子 pane 全空 → 整体 null', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['x']), makePane('p2', ['y'])]);
    expect(normalizeLayout(layout, new Set(['z']))).toBeNull();
  });
});

describe('规则 5：ratio 钳制 / 回落', () => {
  it('越界钳制，NaN / ±Infinity / 非 number 回落 0.5', () => {
    const cases: readonly (readonly [unknown, number])[] = [
      [0.05, 0.1],
      [0.95, 0.9],
      [-1, 0.1],
      [2, 0.9],
      [Number.NaN, 0.5],
      [Number.POSITIVE_INFINITY, 0.5],
      [Number.NEGATIVE_INFINITY, 0.5],
      ['0.3', 0.5],
      [undefined, 0.5],
    ];
    for (const [input, expected] of cases) {
      const layout = makeDirtyRatioSplit(input, [makePane('p1', ['a']), makePane('p2', ['b'])]);
      const result = normalizeLayout(layout, new Set(['a', 'b']));
      const label = `ratio=${String(input)}`;
      expect(result?.kind, label).toBe('split');
      if (result?.kind === 'split') expect(result.ratio, label).toBe(expected);
    }
  });

  it('合法 ratio 不被改写', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])], 0.25);
    const result = normalizeLayout(layout, new Set(['a', 'b']));
    expect(result).toBe(layout);
  });
});

describe('规则 6：超出 maxPanes 时按 DFS 从左到右保留', () => {
  it('默认上限 4：第 5 个 pane 从树上消失（它的终端回到 tab 条）', () => {
    const result = normalizeLayout(fivePaneTree(), FIVE_LIVE);
    expect(countPanes(result)).toBe(4);
    expect(result).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['e1']),
        makeSplit('s2', 'row', [
          makePane('p2', ['e2']),
          makeSplit('s3', 'row', [makePane('p3', ['e3']), makePane('p4', ['e4'])]),
        ]),
      ]),
    );
    expect(layoutTerminalIds(result).has('e5')).toBe(false);
    assertLayoutInvariants(result);
  });

  it('maxPanes = 2', () => {
    const result = normalizeLayout(fivePaneTree(), FIVE_LIVE, { maxPanes: 2 });
    expect(result).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['e1']), makePane('p2', ['e2'])]),
    );
  });

  it('maxPanes = 0 被归一为 1', () => {
    const result = normalizeLayout(fivePaneTree(), FIVE_LIVE, { maxPanes: 0 });
    expect(result).toEqual(makePane('p1', ['e1']));
  });

  it('maxPanes 非法 → 回落默认 4', () => {
    expect(countPanes(normalizeLayout(fivePaneTree(), FIVE_LIVE, { maxPanes: Number.NaN }))).toBe(
      4,
    );
  });

  it('maxPanes 超过硬顶 6 时钳制到 6', () => {
    expect(countPanes(normalizeLayout(fivePaneTree(), FIVE_LIVE, { maxPanes: 99 }))).toBe(5);
  });

  it('被过滤清空的 pane 不占预算', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['dead']), makePane('p2', ['a'])]);
    expect(normalizeLayout(layout, new Set(['a']), { maxPanes: 1 })).toEqual(makePane('p2', ['a']));
  });

  it('8 个 pane + 硬顶 6 → 保留前 6 个', () => {
    let node: TerminalLayoutNode = makePane('p8', ['e8']);
    for (let depth = 7; depth >= 1; depth -= 1) {
      node = makeSplit(`s${depth}`, 'row', [makePane(`p${depth}`, [`e${depth}`]), node]);
    }
    const live = new Set(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
    const result = normalizeLayout(node, live, { maxPanes: 99 });
    expect(countPanes(result)).toBe(6);
    expect([...layoutTerminalIds(result)].sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    assertLayoutInvariants(result);
  });
});

describe('规则 7：全树 terminalId 唯一', () => {
  it('跨 pane 重复 → 保留首次出现，后续位置移除', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a', 'b']), makePane('p2', ['b', 'c'])]);
    const result = normalizeLayout(layout, new Set(['a', 'b', 'c']));
    expect(result).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a', 'b']), makePane('p2', ['c'])]),
    );
    assertLayoutInvariants(result);
  });

  it('后续 pane 因重复被清空时同样上提', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['a'])]);
    expect(normalizeLayout(layout, new Set(['a']))).toEqual(makePane('p1', ['a']));
  });

  it('单个 pane 内部的重复 id 收敛成一次', () => {
    const layout = makePane('p1', ['a', 'a', 'b']);
    expect(normalizeLayout(layout, new Set(['a', 'b']))).toEqual(makePane('p1', ['a', 'b']));
  });
});

describe('规则 8：输出恒满足不变量 + 不修改入参', () => {
  it('深层嵌套（6 层）递归正确，且全存活时复用引用', () => {
    let layout: TerminalLayout = makePane('p6', ['t6']);
    for (let depth = 5; depth >= 1; depth -= 1) {
      layout = makeSplit(`s${depth}`, 'row', [makePane(`p${depth}`, [`t${depth}`]), layout]);
    }
    const allLive = new Set(['t1', 't2', 't3', 't4', 't5', 't6']);
    expect(normalizeLayout(layout, allLive, { maxPanes: 6 })).toBe(layout);

    const withoutDeepest = normalizeLayout(layout, new Set(['t1', 't2', 't3', 't4', 't5']), {
      maxPanes: 6,
    });
    let expected: TerminalLayoutNode = makePane('p5', ['t5']);
    for (let depth = 4; depth >= 1; depth -= 1) {
      expected = makeSplit(`s${depth}`, 'row', [makePane(`p${depth}`, [`t${depth}`]), expected]);
    }
    expect(withoutDeepest).toEqual(expected);
    assertLayoutInvariants(withoutDeepest);
  });

  it('入参被冻结也不抛错，且深比较不变', () => {
    const layout = deepFreeze(
      makeSplit('s1', 'row', [
        makePane('p1', ['a', 'b'], 'b'),
        makeDirtyRatioSplit(Number.NaN, [makePane('p2', ['a']), makePane('p3', ['dead'])]),
      ]),
    );
    const before = clone(layout);
    const result = normalizeLayout(layout, new Set(['a', 'b']));
    assertLayoutInvariants(result);
    expect(layout).toEqual(before);
  });
});
