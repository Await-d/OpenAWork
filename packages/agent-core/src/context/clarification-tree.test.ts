import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  buildConfirmNode,
  computeFrontier,
  computeNodeStatus,
  confirmGrill,
  CONFIRM_ANSWER,
  CONFIRM_NODE_ID,
  createGrillState,
  GRILL_MAX_ROUNDS,
  isConfirmAffirmative,
  isFrontierEmpty,
  isGrillExhausted,
  needsConfirmation,
  parseGrillState,
  parseMultiGrillReply,
  REJECT_ANSWER,
  seedGrillState,
  serializeGrillState,
  type ClarificationNode,
} from './clarification-tree.js';
import type { ClarificationDimension, ClarificationQuestion } from './routing.js';
import { buildClarificationQuestions } from './routing.js';

function node(id: string, dependsOn: readonly string[] = [], answer?: string): ClarificationNode {
  return {
    id,
    dimension: 'goal',
    question: `question ${id}`,
    options: [{ label: id }],
    dependsOn: [...dependsOn],
    ...(answer !== undefined ? { answer } : {}),
  };
}

const T0 = 1_700_000_000_000;

describe('createGrillState', () => {
  it('初始轮次为 0、历史为空', () => {
    const state = createGrillState([node('a')]);
    expect(state.round).toBe(0);
    expect(state.history).toEqual([]);
    expect(state.confirmedAt).toBeUndefined();
  });

  it('深拷贝节点，外部后续修改不影响 state', () => {
    const source = node('a');
    const state = createGrillState([source]);
    source.options[0]!.label = 'mutated';
    source.dependsOn.push('ghost');
    expect(state.nodes[0]?.options[0]?.label).toBe('a');
    expect(state.nodes[0]?.dependsOn).toEqual([]);
  });
});

describe('computeFrontier / computeNodeStatus', () => {
  it('依赖为空的根节点全部进入 frontier', () => {
    const state = createGrillState([node('a'), node('b')]);
    expect(computeFrontier(state).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('依赖未结算的节点为 blocked，且不进入 frontier', () => {
    const state = createGrillState([node('a'), node('b', ['a'])]);
    expect(computeNodeStatus(state, 'b')).toBe('blocked');
    expect(computeFrontier(state).map((n) => n.id)).toEqual(['a']);
  });

  it('依赖结算后，下游节点变为 open 并进入 frontier（级联解锁）', () => {
    const settled = applyAnswer(createGrillState([node('a'), node('b', ['a'])]), 'a', 'x', T0);
    expect(computeNodeStatus(settled, 'b')).toBe('open');
    expect(computeFrontier(settled).map((n) => n.id)).toEqual(['b']);
  });

  it('已结算节点为 settled，既不在 frontier 也不阻塞自身', () => {
    const settled = applyAnswer(createGrillState([node('a')]), 'a', 'x', T0);
    expect(computeNodeStatus(settled, 'a')).toBe('settled');
    expect(computeFrontier(settled)).toEqual([]);
  });

  it('未知节点返回 null', () => {
    expect(computeNodeStatus(createGrillState([node('a')]), 'ghost')).toBeNull();
  });

  it('悬空依赖（指向不存在的节点）使该节点永久 blocked，不抛错', () => {
    const state = createGrillState([node('a', ['missing'])]);
    expect(computeNodeStatus(state, 'a')).toBe('blocked');
  });
});

describe('applyAnswer', () => {
  it('结算 frontier 中的节点：写入答案、递增轮次、追加历史', () => {
    const before = createGrillState([node('a')]);
    const after = applyAnswer(before, 'a', 'yes', T0);

    expect(after.nodes[0]?.answer).toBe('yes');
    expect(after.round).toBe(1);
    expect(after.history).toEqual([{ nodeId: 'a', answer: 'yes', at: T0 }]);
  });

  it('不可变：不修改入参 state', () => {
    const before = createGrillState([node('a')]);
    applyAnswer(before, 'a', 'yes', T0);
    expect(before.nodes[0]?.answer).toBeUndefined();
    expect(before.round).toBe(0);
    expect(before.history).toEqual([]);
  });

  it('未知节点：原样返回（同一引用），不抛错', () => {
    const state = createGrillState([node('a')]);
    expect(applyAnswer(state, 'ghost', 'x', T0)).toBe(state);
  });

  it('blocked 节点：原样返回，不推进', () => {
    const state = createGrillState([node('a'), node('b', ['a'])]);
    expect(applyAnswer(state, 'b', 'x', T0)).toBe(state);
  });

  it('已结算节点：幂等，二次应答原样返回', () => {
    const settled = applyAnswer(createGrillState([node('a')]), 'a', 'first', T0);
    expect(applyAnswer(settled, 'a', 'second', T0)).toBe(settled);
  });
});

describe('needsConfirmation / confirmGrill', () => {
  const withConfirm = () => createGrillState([node('a'), buildConfirmNode(['a'])]);

  it('frontier 仍含常规问题时为 false', () => {
    expect(needsConfirmation(withConfirm())).toBe(false);
  });

  it('所有常规问题已结算、仅剩确认节点时为 true', () => {
    const state = applyAnswer(withConfirm(), 'a', 'yes', T0);
    expect(needsConfirmation(state)).toBe(true);
    expect(isFrontierEmpty(state)).toBe(false);
  });

  it('无确认节点的树结算完成为 false（确认是可选装配）', () => {
    const state = applyAnswer(createGrillState([node('a')]), 'a', 'yes', T0);
    expect(isFrontierEmpty(state)).toBe(true);
    expect(needsConfirmation(state)).toBe(false);
  });

  it('confirmGrill 写入 confirmedAt 并结算确认节点，之后 needsConfirmation 为 false', () => {
    const pending = applyAnswer(withConfirm(), 'a', 'yes', T0);
    const confirmed = confirmGrill(pending, T0 + 1);

    expect(confirmed.confirmedAt).toBe(T0 + 1);
    expect(confirmed.nodes.find((n) => n.id === CONFIRM_NODE_ID)?.answer).toBe(CONFIRM_ANSWER);
    expect(needsConfirmation(confirmed)).toBe(false);
  });

  it('确认节点收到 rejected：不结算、不写 confirmedAt、记录历史并递增轮次', () => {
    const pending = applyAnswer(withConfirm(), 'a', 'yes', T0);
    const rejected = applyAnswer(pending, CONFIRM_NODE_ID, REJECT_ANSWER, T0 + 1);

    expect(rejected.confirmedAt).toBeUndefined();
    expect(rejected.nodes.find((n) => n.id === CONFIRM_NODE_ID)?.answer).toBeUndefined();
    expect(rejected.round).toBe(pending.round + 1);
    expect(rejected.history.at(-1)).toEqual({
      nodeId: CONFIRM_NODE_ID,
      answer: REJECT_ANSWER,
      at: T0 + 1,
    });
    expect(needsConfirmation(rejected)).toBe(true);
  });

  it('确认节点收到推荐选项标签（如「确认」）同样视为确认', () => {
    const pending = applyAnswer(withConfirm(), 'a', 'yes', T0);
    const confirmed = applyAnswer(pending, CONFIRM_NODE_ID, '确认', T0 + 2);

    expect(confirmed.confirmedAt).toBe(T0 + 2);
    expect(confirmed.nodes.find((n) => n.id === CONFIRM_NODE_ID)?.answer).toBe('确认');
    expect(needsConfirmation(confirmed)).toBe(false);
  });

  it('确认节点收到非推荐标签（如「需修改」）不视为确认', () => {
    const pending = applyAnswer(withConfirm(), 'a', 'yes', T0);
    const stillPending = applyAnswer(pending, CONFIRM_NODE_ID, '需修改', T0 + 3);

    expect(stillPending.confirmedAt).toBeUndefined();
    expect(stillPending.nodes.find((n) => n.id === CONFIRM_NODE_ID)?.answer).toBeUndefined();
    expect(needsConfirmation(stillPending)).toBe(true);
  });
});

describe('isConfirmAffirmative — 肯定确认文案判定（A/C 共用的 SSOT）', () => {
  it('字面量 confirmed 与常见肯定措辞视为肯定', () => {
    for (const label of ['confirmed', '确认', '可以', '是的', '是，开始实现', 'OK', 'Go ahead']) {
      expect(isConfirmAffirmative(label)).toBe(true);
    }
  });

  it('否定 / 修饰性文案不视为肯定', () => {
    for (const label of ['需修改', 'rejected', '先不实现', '继续澄清', '重新讨论']) {
      expect(isConfirmAffirmative(label)).toBe(false);
    }
  });

  it('两侧空白不影响判定，空串不是肯定', () => {
    expect(isConfirmAffirmative('  确认  ')).toBe(true);
    expect(isConfirmAffirmative('   ')).toBe(false);
  });
});

describe('buildClarificationQuestions / seedGrillState — T-03 迁移路径', () => {
  it('全量模板构建器返回全部 4 个维度（不施加轮次上限）', () => {
    const questions = buildClarificationQuestions('check and update the parser');
    expect(questions.map((q) => q.dimension)).toEqual([
      'goal',
      'constraint',
      'deliverable',
      'acceptance',
    ]);
  });

  it('经引擎种子化后全部维度同处 frontier，acceptance 可达（修复 legacy 上限缺陷）', () => {
    const state = seedGrillState(buildClarificationQuestions('check and update the parser'));
    expect(computeFrontier(state).map((n) => n.id)).toEqual([
      'goal',
      'constraint',
      'deliverable',
      'acceptance',
    ]);
  });

  it('逐一结算全部维度后进入待确认态', () => {
    let state = seedGrillState(buildClarificationQuestions('check and update the parser'));
    for (const dimension of ['goal', 'constraint', 'deliverable', 'acceptance'] as const) {
      state = applyAnswer(state, dimension, 'ok', T0);
    }
    expect(needsConfirmation(state)).toBe(true);
  });
});

describe('seedGrillState', () => {
  const questions: ClarificationQuestion[] = [
    { dimension: 'goal', question: 'g?', options: [{ label: 'g1' }] },
    { dimension: 'constraint', question: 'c?' },
  ];

  it('按维度生成节点，id 取维度名', () => {
    const state = seedGrillState(questions, { withConfirmation: false });
    expect(state.nodes.map((n) => n.id)).toEqual(['goal', 'constraint']);
    expect(state.nodes[0]?.options).toEqual([{ label: 'g1' }]);
    expect(state.nodes[1]?.options).toEqual([]);
  });

  it('默认追加确认节点，依赖全部问题节点', () => {
    const state = seedGrillState(questions);
    const confirm = state.nodes.find((n) => n.id === CONFIRM_NODE_ID);
    expect(confirm?.dependsOn).toEqual(['goal', 'constraint']);
    expect(computeNodeStatus(state, CONFIRM_NODE_ID)).toBe('blocked');
  });

  it('所有种子问题节点同处初始 frontier（一轮问整个 frontier）', () => {
    const state = seedGrillState(questions);
    expect(computeFrontier(state).map((n) => n.id)).toEqual(['goal', 'constraint']);
  });

  it('withConfirmation:false 时不追加确认节点', () => {
    const state = seedGrillState(questions, { withConfirmation: false });
    expect(state.nodes.some((n) => n.id === CONFIRM_NODE_ID)).toBe(false);
  });
});

describe('buildConfirmNode', () => {
  it('使用保留 id、acceptance 维度、且推荐项为"确认"', () => {
    const confirm = buildConfirmNode(['a']);
    expect(confirm.id).toBe(CONFIRM_NODE_ID);
    expect(confirm.dimension).toBe('acceptance');
    expect(confirm.options.find((o) => o.recommended)?.label).toBe('确认');
  });
});

describe('serializeGrillState / parseGrillState', () => {
  it('往返保留节点、轮次、历史与 confirmedAt', () => {
    const pending = applyAnswer(
      createGrillState([node('a'), buildConfirmNode(['a'])]),
      'a',
      'yes',
      T0,
    );
    const confirmed = confirmGrill(pending, T0 + 5);

    const restored = parseGrillState(serializeGrillState(confirmed));
    expect(restored).toEqual(confirmed);
  });

  it('非法 JSON 返回 null', () => {
    expect(parseGrillState('{not json')).toBeNull();
  });

  it('结构不符（缺 nodes / round 类型错）返回 null', () => {
    expect(parseGrillState(JSON.stringify({ round: 0, history: [] }))).toBeNull();
    expect(parseGrillState(JSON.stringify({ nodes: [], round: 'zero', history: [] }))).toBeNull();
    expect(
      parseGrillState(JSON.stringify({ nodes: [{ id: 1 }], round: 0, history: [] })),
    ).toBeNull();
  });

  it('parse 结果与输入无引用共享（深拷贝）', () => {
    const state = createGrillState([node('a')]);
    const restored = parseGrillState(serializeGrillState(state));
    restored!.nodes[0]!.options[0]!.label = 'mutated';
    expect(state.nodes[0]?.options[0]?.label).toBe('a');
  });

  it('往返保留 rejections 与 exhaustedAt（persist→read 不丢字段）', () => {
    let state = applyAnswer(createGrillState(awaitingConfirm()), 'a', 'yes', T0);
    for (let attempt = 0; attempt < GRILL_MAX_ROUNDS; attempt += 1) {
      state = applyAnswer(state, CONFIRM_NODE_ID, '需修改', T0 + attempt + 1);
    }

    const restored = parseGrillState(serializeGrillState(state));
    expect(restored).toEqual(state);
    expect(restored?.rejections).toHaveLength(GRILL_MAX_ROUNDS);
    expect(restored?.exhaustedAt).toBe(state.exhaustedAt);
  });
});

function awaitingConfirm(): ClarificationNode[] {
  return [node('a'), buildConfirmNode(['a'])];
}

function optionNode(
  id: string,
  dimension: ClarificationDimension,
  options: string[],
): ClarificationNode {
  return {
    id,
    dimension,
    question: `${dimension} 问题`,
    options: options.map((label) => ({ label })),
    dependsOn: [],
  };
}

describe('确认驳回记录（rejections）与有界上限', () => {
  it('驳回时追加 rejections，outstanding 列出全部共识项（不含确认节点）', () => {
    const pending = applyAnswer(createGrillState(awaitingConfirm()), 'a', 'yes', T0);
    const rejected = applyAnswer(pending, CONFIRM_NODE_ID, '需修改', T0 + 1);

    expect(rejected.rejections).toEqual([{ at: T0 + 1, answer: '需修改', outstanding: ['a'] }]);
    expect(rejected.exhaustedAt).toBeUndefined();
    expect(isGrillExhausted(rejected)).toBe(false);
  });

  it('第 6 次驳回写入 exhaustedAt，前 5 次不判定为耗尽', () => {
    let state = applyAnswer(createGrillState(awaitingConfirm()), 'a', 'yes', T0);
    for (let attempt = 0; attempt < GRILL_MAX_ROUNDS; attempt += 1) {
      state = applyAnswer(state, CONFIRM_NODE_ID, '需修改', T0 + attempt + 1);
      if (attempt < GRILL_MAX_ROUNDS - 1) {
        expect(isGrillExhausted(state)).toBe(false);
        expect(state.exhaustedAt).toBeUndefined();
      }
    }

    expect(state.rejections).toHaveLength(GRILL_MAX_ROUNDS);
    expect(state.exhaustedAt).toBe(T0 + GRILL_MAX_ROUNDS);
    expect(isGrillExhausted(state)).toBe(true);
  });

  it('陈旧状态（无 rejections）不被追溯判定为耗尽，即使 round 很大', () => {
    const pending = applyAnswer(createGrillState(awaitingConfirm()), 'a', 'yes', T0);
    expect(isGrillExhausted({ ...pending, round: 99 })).toBe(false);
  });

  it('确认成功后 confirmedAt 生效，既有 rejections 不影响收口', () => {
    let state = applyAnswer(createGrillState(awaitingConfirm()), 'a', 'yes', T0);
    state = applyAnswer(state, CONFIRM_NODE_ID, '需修改', T0 + 1);
    const confirmed = confirmGrill(state, T0 + 2);
    expect(confirmed.confirmedAt).toBe(T0 + 2);
    expect(confirmed.rejections).toHaveLength(1);
  });
});

describe('parseMultiGrillReply — 一轮多答解析', () => {
  const fourNodes = (): ClarificationNode[] => [
    optionNode('goal', 'goal', ['改单文件', '跨模块']),
    optionNode('constraint', 'constraint', ['无约束', '必须兼容']),
    optionNode('deliverable', 'deliverable', ['代码变更', '仅方案']),
    optionNode('acceptance', 'acceptance', ['测试通过', '需新测试']),
  ];

  it('序号式：一次回复多项，按序号映射到节点', () => {
    const parsed = parseMultiGrillReply(fourNodes(), '1. 改单文件；2. 无约束');
    expect(parsed.assigned).toEqual([
      { nodeId: 'goal', answer: '改单文件' },
      { nodeId: 'constraint', answer: '无约束' },
    ]);
    expect(parsed.ambiguous).toEqual([]);
  });

  it('维度式：用「维度：答案」在句内一次回答多项', () => {
    const parsed = parseMultiGrillReply(fourNodes(), '目标：改单文件。约束：无约束。');
    expect(parsed.assigned).toEqual([
      { nodeId: 'goal', answer: '改单文件' },
      { nodeId: 'constraint', answer: '无约束' },
    ]);
  });

  it('单段纯文本回复保持历史语义：落到 frontier[0]', () => {
    const parsed = parseMultiGrillReply(fourNodes(), '就按最省事的来');
    expect(parsed.assigned).toEqual([{ nodeId: 'goal', answer: '就按最省事的来' }]);
  });

  it('段数与前沿数一致且均无目标：按位置一一对应', () => {
    const parsed = parseMultiGrillReply(fourNodes(), '改单文件\n无约束\n代码变更\n测试通过');
    expect(parsed.assigned).toEqual([
      { nodeId: 'goal', answer: '改单文件' },
      { nodeId: 'constraint', answer: '无约束' },
      { nodeId: 'deliverable', answer: '代码变更' },
      { nodeId: 'acceptance', answer: '测试通过' },
    ]);
  });

  it('同一节点被两段命中：第二段进入 ambiguous，禁止 last-wins', () => {
    const parsed = parseMultiGrillReply(fourNodes(), '1. 改单文件；1. 跨模块');
    expect(parsed.assigned).toEqual([{ nodeId: 'goal', answer: '改单文件' }]);
    expect(parsed.ambiguous).toEqual([{ segment: '1. 跨模块', reason: 'duplicate-target' }]);
  });

  it('多段均无目标且段数不足：不猜，全部标记 no-target', () => {
    const parsed = parseMultiGrillReply(fourNodes(), '第一点\n第二点');
    expect(parsed.assigned).toEqual([]);
    expect(parsed.ambiguous.map((item) => item.reason)).toEqual(['no-target', 'no-target']);
  });

  it('共享选项标签且段数与前沿数一致：不按位置硬塞，标记 shared-label', () => {
    const frontier = [
      optionNode('a', 'goal', ['是', '否']),
      optionNode('b', 'constraint', ['是', '否']),
    ];
    const parsed = parseMultiGrillReply(frontier, '是；是');
    expect(parsed.assigned).toEqual([]);
    expect(parsed.ambiguous.map((item) => item.reason)).toEqual(['shared-label', 'shared-label']);
  });

  it('序号越界不落位，标记 no-target', () => {
    const frontier = [
      optionNode('a', 'goal', ['是', '否']),
      optionNode('b', 'constraint', ['是', '否']),
    ];
    const parsed = parseMultiGrillReply(frontier, '9. 越界');
    expect(parsed.assigned).toEqual([]);
    expect(parsed.ambiguous).toEqual([{ segment: '9. 越界', reason: 'no-target' }]);
  });
});
