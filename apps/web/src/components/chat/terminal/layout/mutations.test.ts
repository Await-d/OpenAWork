/**
 * 结构变更：每个 mutation 的 happy / 边界 / 失败路径，外加引用稳定与不可变性。
 */

import { describe, expect, it } from 'vitest';
import {
  insertTerminalIntoPane,
  moveTerminal,
  removePane,
  removeTerminal,
  setPaneActiveTerminal,
  setSplitRatio,
  splitPane,
} from './mutations.js';
import { assertLayoutInvariants } from './invariants-helpers.js';
import { countPanes, findPaneContaining } from './queries.js';
import { clone, deepFreeze, makePane, makeSplit } from './test-fixtures.js';
import type { TerminalLayout } from './types.js';

function fourPaneTree(): TerminalLayout {
  return makeSplit('s1', 'row', [
    makePane('p1', ['t1']),
    makeSplit('s2', 'row', [
      makePane('p2', ['t2']),
      makeSplit('s3', 'row', [makePane('p3', ['t3']), makePane('p4', ['t4'])]),
    ]),
  ]);
}

/** 每个 mutation 的结果都必须满足全量不变量。 */
function checked(layout: TerminalLayout): TerminalLayout {
  assertLayoutInvariants(layout);
  return layout;
}

describe('splitPane', () => {
  it('显式种子（调用方刚新建的终端）→ 拆成二元 split，默认新组在右', () => {
    const layout = makePane('p1', ['a']);
    const result = checked(splitPane(layout, 'p1', 'row', 'p2', { seedTerminalId: 'b' }));
    expect(result).toEqual(
      makeSplit('split-p2', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])]),
    );
  });

  it("position: 'first' → 新组在左 / 上", () => {
    const layout = makePane('p1', ['a']);
    const result = checked(
      splitPane(layout, 'p1', 'column', 'p2', { seedTerminalId: 'b', position: 'first' }),
    );
    expect(result).toEqual(
      makeSplit('split-p2', 'column', [makePane('p2', ['b']), makePane('p1', ['a'])]),
    );
  });

  it('未给种子时退化为把目标组 active 挪进新组（组内剩余 >= 1）', () => {
    const layout = makePane('p1', ['a', 'b'], 'b');
    const result = checked(splitPane(layout, 'p1', 'column', 'p2'));
    expect(result).toEqual(
      makeSplit('split-p2', 'column', [makePane('p1', ['a']), makePane('p2', ['b'])]),
    );
  });

  it('目标组只剩一个终端且没有显式种子 → 原树（否则会制造空 pane）', () => {
    const layout = makePane('p1', ['a']);
    expect(splitPane(layout, 'p1', 'row', 'p2')).toBe(layout);
  });

  it('目标 pane 不存在 → 原树引用', () => {
    const layout = makePane('p1', ['a']);
    expect(splitPane(layout, 'nope', 'row', 'p2', { seedTerminalId: 'b' })).toBe(layout);
  });

  it('达到 maxPanes 上限 → 原树引用', () => {
    const layout = fourPaneTree();
    expect(splitPane(layout, 'p1', 'row', 'p5', { seedTerminalId: 't9' })).toBe(layout);
  });

  it('显式放宽 maxPanes 到硬顶 6 时允许第 5 个 pane', () => {
    const layout = fourPaneTree();
    const result = checked(
      splitPane(layout, 'p1', 'row', 'p5', { seedTerminalId: 't9', maxPanes: 6 }),
    );
    expect(countPanes(result)).toBe(5);
  });

  it('显式种子来自其它组时从原组摘除（不变量 7：全树唯一）', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b', 'c'])]);
    const result = checked(splitPane(layout, 'p1', 'row', 'p3', { seedTerminalId: 'b' }));
    expect(result).toEqual(
      makeSplit('s1', 'row', [
        makeSplit('split-p3', 'row', [makePane('p1', ['a']), makePane('p3', ['b'])]),
        makePane('p2', ['c']),
      ]),
    );
  });

  it('显式种子就在目标组里（组内还有别的终端）→ 组内挪走', () => {
    const layout = makePane('p1', ['a', 'b'], 'a');
    const result = checked(splitPane(layout, 'p1', 'row', 'p2', { seedTerminalId: 'a' }));
    expect(result).toEqual(
      makeSplit('split-p2', 'row', [makePane('p1', ['b']), makePane('p2', ['a'])]),
    );
  });

  it('显式种子是目标组唯一终端 → 原树（拆完目标组会空）', () => {
    const layout = makePane('p1', ['a']);
    expect(splitPane(layout, 'p1', 'row', 'p2', { seedTerminalId: 'a' })).toBe(layout);
  });

  it('深层嵌套目标也能拆', () => {
    const layout = makeSplit('s1', 'row', [
      makePane('p1', ['a']),
      makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p3', ['c'])]),
    ]);
    const result = checked(splitPane(layout, 'p3', 'column', 'p4', { seedTerminalId: 'd' }));
    expect(result).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['a']),
        makeSplit('s2', 'column', [
          makePane('p2', ['b']),
          makeSplit('split-p4', 'column', [makePane('p3', ['c']), makePane('p4', ['d'])]),
        ]),
      ]),
    );
  });
});

describe('removePane', () => {
  it('根就是 pane → null', () => {
    expect(removePane(makePane('p1', ['a']), 'p1')).toBeNull();
  });

  it('移除后兄弟节点上提', () => {
    const layout = makeSplit('s1', 'row', [
      makePane('p1', ['a']),
      makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p3', ['c'])]),
    ]);
    expect(checked(removePane(layout, 'p2'))).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p3', ['c'])]),
    );
  });

  it('两层都因移除而塌陷时继续上提', () => {
    const layout = makeSplit('s1', 'row', [
      makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p1', ['a'])]),
      makePane('p3', ['c']),
    ]);
    expect(checked(removePane(layout, 'p2'))).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p3', ['c'])]),
    );
  });

  it('pane 不存在 → 原树引用', () => {
    const layout = makePane('p1', ['a']);
    expect(removePane(layout, 'nope')).toBe(layout);
  });
});

describe('removeTerminal', () => {
  it('不在树里 → 原树引用（它本来就是 tab）', () => {
    const layout = makePane('p1', ['a']);
    expect(removeTerminal(layout, 'ghost')).toBe(layout);
  });

  it('组内还有别的终端时只裁剪列表；active 被删则回落到首位', () => {
    const layout = makePane('p1', ['a', 'b', 'c'], 'b');
    expect(checked(removeTerminal(layout, 'b'))).toEqual(makePane('p1', ['a', 'c']));
  });

  it('active 未被删除时保持 active', () => {
    const layout = makePane('p1', ['a', 'b'], 'b');
    expect(checked(removeTerminal(layout, 'a'))).toEqual(makePane('p1', ['b']));
  });

  it('最后一个终端 → 等同 removePane（兄弟上提）', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])]);
    expect(checked(removeTerminal(layout, 'b'))).toEqual(makePane('p1', ['a']));
    expect(findPaneContaining(checked(removeTerminal(layout, 'b')), 'b')).toBeNull();
  });

  it('根是单组且清空 → null', () => {
    expect(removeTerminal(makePane('p1', ['a']), 'a')).toBeNull();
  });

  it('深层终端被移除后逐层上提', () => {
    const layout = makeSplit('s1', 'row', [
      makePane('p1', ['a']),
      makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p3', ['c', 'd'])]),
    ]);
    expect(checked(removeTerminal(layout, 'c'))).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['a']),
        makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p3', ['d'])]),
      ]),
    );
  });
});

describe('insertTerminalIntoPane', () => {
  it('index 缺省追加到末尾并设为 active', () => {
    const layout = makePane('p1', ['a']);
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'b'))).toEqual(
      makePane('p1', ['a', 'b'], 'b'),
    );
  });

  it('显式 index 生效', () => {
    const layout = makePane('p1', ['a']);
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'b', 0))).toEqual(
      makePane('p1', ['b', 'a']),
    );
  });

  it('index 越界 / 负数 / NaN 都被收敛（NaN 视为追加）', () => {
    const layout = makePane('p1', ['a']);
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'b', -5))).toEqual(
      makePane('p1', ['b', 'a'], 'b'),
    );
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'b', 99))).toEqual(
      makePane('p1', ['a', 'b'], 'b'),
    );
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'b', Number.NaN))).toEqual(
      makePane('p1', ['a', 'b'], 'b'),
    );
  });

  it('已在目标组内 → 组内重排 + 设为 active', () => {
    const layout = makePane('p1', ['a', 'b', 'c'], 'a');
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'c', 0))).toEqual(
      makePane('p1', ['c', 'a', 'b']),
    );
  });

  it('已在目标组内且结果不变 → 原树引用', () => {
    const layout = makePane('p1', ['a', 'b', 'c'], 'c');
    expect(insertTerminalIntoPane(layout, 'p1', 'c')).toBe(layout);
    expect(insertTerminalIntoPane(layout, 'p1', 'c', 2)).toBe(layout);
  });

  it('从其它组搬入（维护全树唯一）', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b', 'c'])]);
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'b'))).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a', 'b'], 'b'), makePane('p2', ['c'])]),
    );
  });

  it('搬走了最后一个终端时原组被移除并上提', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])]);
    expect(checked(insertTerminalIntoPane(layout, 'p1', 'b'))).toEqual(
      makePane('p1', ['a', 'b'], 'b'),
    );
  });

  it('目标 pane 不存在 → 原树引用', () => {
    const layout = makePane('p1', ['a']);
    expect(insertTerminalIntoPane(layout, 'nope', 'b')).toBe(layout);
  });

  it('终端不在树里（新建）也能插入', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])]);
    expect(checked(insertTerminalIntoPane(layout, 'p2', 'c'))).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b', 'c'], 'c')]),
    );
  });
});

describe('moveTerminal', () => {
  it('detach / tab-strip → 从树上移除（成为独立 tab）', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b', 'c'])]);
    const detached = checked(moveTerminal(layout, 'b', { kind: 'detach' }, { newPaneId: 'np' }));
    expect(detached).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['c'])]),
    );
    expect(
      checked(moveTerminal(layout, 'b', { kind: 'tab-strip', index: 0 }, { newPaneId: 'np' })),
    ).toEqual(detached);
  });

  it('pane-center → 并进该组末尾并设为 active', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b', 'c'])]);
    expect(
      checked(
        moveTerminal(layout, 'b', { kind: 'pane-center', paneId: 'p1' }, { newPaneId: 'np' }),
      ),
    ).toEqual(makeSplit('s1', 'row', [makePane('p1', ['a', 'b'], 'b'), makePane('p2', ['c'])]));
  });

  it('pane-edge：左右 → row，上下 → column；左/上把新组放在前面', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a', 'b']), makePane('p2', ['c'])]);

    expect(
      checked(
        moveTerminal(
          layout,
          'b',
          { kind: 'pane-edge', paneId: 'p2', edge: 'right' },
          { newPaneId: 'np' },
        ),
      ),
    ).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['a']),
        makeSplit('split-np', 'row', [makePane('p2', ['c']), makePane('np', ['b'])]),
      ]),
    );

    expect(
      checked(
        moveTerminal(
          layout,
          'b',
          { kind: 'pane-edge', paneId: 'p2', edge: 'left' },
          { newPaneId: 'np' },
        ),
      ),
    ).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['a']),
        makeSplit('split-np', 'row', [makePane('np', ['b']), makePane('p2', ['c'])]),
      ]),
    );

    expect(
      checked(
        moveTerminal(
          layout,
          'b',
          { kind: 'pane-edge', paneId: 'p2', edge: 'top' },
          { newPaneId: 'np' },
        ),
      ),
    ).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['a']),
        makeSplit('split-np', 'column', [makePane('np', ['b']), makePane('p2', ['c'])]),
      ]),
    );

    expect(
      checked(
        moveTerminal(
          layout,
          'b',
          { kind: 'pane-edge', paneId: 'p2', edge: 'bottom' },
          { newPaneId: 'np' },
        ),
      ),
    ).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['a']),
        makeSplit('split-np', 'column', [makePane('p2', ['c']), makePane('np', ['b'])]),
      ]),
    );
  });

  it('pane-center 落回自己所在的组 → 组内重排（末尾 + active）', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a', 'b'], 'a'), makePane('p2', ['c'])]);
    expect(
      checked(
        moveTerminal(layout, 'a', { kind: 'pane-center', paneId: 'p1' }, { newPaneId: 'np' }),
      ),
    ).toEqual(makeSplit('s1', 'row', [makePane('p1', ['b', 'a'], 'a'), makePane('p2', ['c'])]));
  });

  it('pane-edge 在 maxPanes 上限时 → 原树引用', () => {
    const layout = makeSplit('s1', 'row', [
      makePane('p1', ['t1', 'x']),
      makeSplit('s2', 'row', [
        makePane('p2', ['t2']),
        makeSplit('s3', 'row', [makePane('p3', ['t3']), makePane('p4', ['t4'])]),
      ]),
    ]);
    expect(
      moveTerminal(
        layout,
        'x',
        { kind: 'pane-edge', paneId: 'p1', edge: 'right' },
        { newPaneId: 'np' },
      ),
    ).toBe(layout);
  });

  it('被拖终端是目标组唯一终端时 pane-edge → 原树引用', () => {
    const layout = makePane('p1', ['a']);
    expect(
      moveTerminal(
        layout,
        'a',
        { kind: 'pane-edge', paneId: 'p1', edge: 'right' },
        { newPaneId: 'np' },
      ),
    ).toBe(layout);
  });

  it('跨组 pane-edge：来源组被清空时自动上提', () => {
    const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b', 'c'])]);
    expect(
      checked(
        moveTerminal(
          layout,
          'a',
          { kind: 'pane-edge', paneId: 'p2', edge: 'top' },
          { newPaneId: 'np' },
        ),
      ),
    ).toEqual(makeSplit('split-np', 'column', [makePane('np', ['a']), makePane('p2', ['b', 'c'])]));
  });

  it('拖拽到不存在的 pane → 原树引用', () => {
    const layout = makePane('p1', ['a']);
    expect(
      moveTerminal(layout, 'a', { kind: 'pane-center', paneId: 'nope' }, { newPaneId: 'np' }),
    ).toBe(layout);
    expect(
      moveTerminal(
        layout,
        'a',
        { kind: 'pane-edge', paneId: 'nope', edge: 'left' },
        { newPaneId: 'np' },
      ),
    ).toBe(layout);
  });
});

describe('setPaneActiveTerminal', () => {
  const layout = makeSplit('s1', 'row', [makePane('p1', ['a', 'b'], 'a'), makePane('p2', ['c'])]);

  it('切换组内 active', () => {
    expect(checked(setPaneActiveTerminal(layout, 'p1', 'b'))).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a', 'b'], 'b'), makePane('p2', ['c'])]),
    );
  });

  it('已是 active / 终端不在该组 / pane 不存在 → 原树引用', () => {
    expect(setPaneActiveTerminal(layout, 'p1', 'a')).toBe(layout);
    expect(setPaneActiveTerminal(layout, 'p1', 'zzz')).toBe(layout);
    expect(setPaneActiveTerminal(layout, 'p1', 'c')).toBe(layout);
    expect(setPaneActiveTerminal(layout, 'nope', 'a')).toBe(layout);
  });
});

describe('setSplitRatio', () => {
  const layout = makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])], 0.5);

  it('设置合法比例', () => {
    expect(checked(setSplitRatio(layout, 's1', 0.3))).toEqual(
      makeSplit('s1', 'row', [makePane('p1', ['a']), makePane('p2', ['b'])], 0.3),
    );
  });

  it('越界钳制到 [0.1, 0.9]', () => {
    const low = setSplitRatio(layout, 's1', 0);
    const high = setSplitRatio(layout, 's1', 10);
    if (low?.kind === 'split') expect(low.ratio).toBe(0.1);
    if (high?.kind === 'split') expect(high.ratio).toBe(0.9);
  });

  it('NaN / Infinity → 0.5', () => {
    const nan = setSplitRatio(layout, 's1', Number.NaN);
    const inf = setSplitRatio(layout, 's1', Number.POSITIVE_INFINITY);
    if (nan?.kind === 'split') expect(nan.ratio).toBe(0.5);
    if (inf?.kind === 'split') expect(inf.ratio).toBe(0.5);
  });

  it('深层 split 也能设置', () => {
    const nested = makeSplit('s1', 'row', [
      makePane('p1', ['a']),
      makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p3', ['c'])], 0.5),
    ]);
    const result = setSplitRatio(nested, 's2', 0.25);
    expect(result).toEqual(
      makeSplit('s1', 'row', [
        makePane('p1', ['a']),
        makeSplit('s2', 'column', [makePane('p2', ['b']), makePane('p3', ['c'])], 0.25),
      ]),
    );
  });

  it('比例不变 / split 不存在 → 原树引用', () => {
    expect(setSplitRatio(layout, 's1', 0.5)).toBe(layout);
    expect(setSplitRatio(layout, 'nope', 0.3)).toBe(layout);
  });
});

describe('不可变性', () => {
  it('冻结的入参不会被任何 mutation 改写', () => {
    const layout = deepFreeze(
      makeSplit('s1', 'row', [
        makePane('p1', ['a', 'b'], 'b'),
        makeSplit('s2', 'column', [makePane('p2', ['c']), makePane('p3', ['d'])]),
      ]),
    );
    const before = clone(layout);
    const results: TerminalLayout[] = [
      splitPane(layout, 'p2', 'row', 'np1', { seedTerminalId: 'e' }),
      removePane(layout, 'p3'),
      removeTerminal(layout, 'c'),
      insertTerminalIntoPane(layout, 'p1', 'c'),
      moveTerminal(layout, 'd', { kind: 'pane-center', paneId: 'p1' }, { newPaneId: 'np2' }),
      moveTerminal(
        layout,
        'd',
        { kind: 'pane-edge', paneId: 'p1', edge: 'right' },
        { newPaneId: 'np3' },
      ),
      setPaneActiveTerminal(layout, 'p1', 'a'),
      setSplitRatio(layout, 's1', 0.2),
    ];
    for (const result of results) assertLayoutInvariants(result);
    expect(layout).toEqual(before);
  });

  it('所有 mutation 的成功结果都保持不变量', () => {
    let layout: TerminalLayout = null as TerminalLayout;
    layout = makePane('p1', ['a', 'b']);
    layout = splitPane(layout, 'p1', 'row', 'p2', { seedTerminalId: 'c' });
    layout = insertTerminalIntoPane(layout, 'p2', 'd');
    layout = setSplitRatio(layout, 'split-p2', 0.4);
    layout = removeTerminal(layout, 'a');
    layout = setPaneActiveTerminal(layout, 'p2', 'c');
    checked(layout);
    expect(countPanes(layout)).toBe(2);
  });
});
