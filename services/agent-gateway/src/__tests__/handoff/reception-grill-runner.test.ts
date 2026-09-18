import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildConfirmNode,
  createGrillState,
  serializeGrillState,
  type ClarificationNode,
} from '@openAwork/agent-core';
import type * as DbModule from '../../infra/db.js';
import type * as GrillModule from '../../handoff/runner/reception-grill-runner.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let grill: typeof GrillModule;

const USER_ID = 'u-grill';
const SESSION_ID = 's-grill';
const INTENT = 'refactor the entire system architecture';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  grill = await import('../../handoff/runner/reception-grill-runner.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@openawork.local`,
    'hash',
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
    [SESSION_ID, USER_ID],
  );
});

describe('startReceptionGrill', () => {
  it('种子化 4 个维度 + 确认节点，且维度节点同处 frontier', () => {
    const state = grill.startReceptionGrill(INTENT);
    const ids = state.nodes.map((node) => node.id);
    expect(ids).toEqual(['goal', 'constraint', 'deliverable', 'acceptance', '__grill_confirm__']);
    expect(state.confirmedAt).toBeUndefined();
  });

  it('每个维度题至少有一个推荐选项', () => {
    const state = grill.startReceptionGrill(INTENT);
    for (const node of state.nodes.filter((item) => item.id !== '__grill_confirm__')) {
      expect(node.options.some((option) => option.recommended === true)).toBe(true);
    }
  });
});

describe('formatFrontierPrompt', () => {
  it('列出 frontier 问题并标注推荐选项', () => {
    const text = grill.formatFrontierPrompt(grill.startReceptionGrill(INTENT));
    expect(text).toContain('1.');
    expect(text).toContain('← 推荐');
    expect(text).toContain('请直接回复你的选择');
  });
});

describe('advanceReceptionGrill', () => {
  it('逐条推进：每轮答案结算一个节点，4 条后进入待确认', () => {
    let state = grill.startReceptionGrill(INTENT);
    const replies = ['改单文件', '无约束', '代码变更', '测试通过'];
    let lastKind = '';
    for (const reply of replies) {
      const advanced = grill.advanceReceptionGrill({ state, reply });
      state = advanced.state;
      lastKind = advanced.kind;
    }
    expect(lastKind).toBe('awaiting-confirmation');
    expect(
      state.nodes
        .filter((node) => node.id !== '__grill_confirm__')
        .every((n) => n.answer !== undefined),
    ).toBe(true);
  });

  it('空回复不推进，保持在当前问题', () => {
    const state = grill.startReceptionGrill(INTENT);
    const advanced = grill.advanceReceptionGrill({ state, reply: '   ' });
    expect(advanced.kind).toBe('question');
    expect(advanced.state).toBe(state);
  });

  it('确认阶段回复肯定词 → confirmed 且写入 confirmedAt', () => {
    let state = grill.startReceptionGrill(INTENT);
    for (const reply of ['改单文件', '无约束', '代码变更', '测试通过']) {
      state = grill.advanceReceptionGrill({ state, reply }).state;
    }
    const confirmed = grill.advanceReceptionGrill({ state, reply: '可以' });
    expect(confirmed.kind).toBe('confirmed');
    expect(typeof confirmed.state.confirmedAt).toBe('number');
  });

  it('确认阶段回复否定 → 不确认，仍待确认', () => {
    let state = grill.startReceptionGrill(INTENT);
    for (const reply of ['改单文件', '无约束', '代码变更', '测试通过']) {
      state = grill.advanceReceptionGrill({ state, reply }).state;
    }
    const rejected = grill.advanceReceptionGrill({ state, reply: '需修改' });
    expect(rejected.kind).toBe('awaiting-confirmation');
    expect(rejected.state.confirmedAt).toBeUndefined();
  });
});

describe('持久化', () => {
  it('persist → read 往返保留状态与原始意图', () => {
    const state = grill.startReceptionGrill(INTENT);
    grill.persistReceptionGrill(SESSION_ID, state, INTENT);

    const restored = grill.readReceptionGrill(SESSION_ID);
    expect(restored?.intent).toBe(INTENT);
    expect(restored?.state.nodes.map((node) => node.id)).toEqual(
      state.nodes.map((node) => node.id),
    );
  });

  it('无状态时 read 返回 null', () => {
    expect(grill.readReceptionGrill(SESSION_ID)).toBeNull();
  });

  it('仅有 clarificationState（无 intent，模拟 A 层写入）时 intent 读回为空字符串', () => {
    const state = grill.startReceptionGrill(INTENT);
    dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
      JSON.stringify({ clarificationState: serializeGrillState(state) }),
      SESSION_ID,
    ]);

    const restored = grill.readReceptionGrill(SESSION_ID);
    expect(restored).not.toBeNull();
    expect(restored?.intent).toBe('');
  });

  it('clear 后 read 返回 null', () => {
    grill.persistReceptionGrill(SESSION_ID, grill.startReceptionGrill(INTENT), INTENT);
    grill.clearReceptionGrill(SESSION_ID);
    expect(grill.readReceptionGrill(SESSION_ID)).toBeNull();
  });
});

function settleAllDimensions(state: ReturnType<typeof grill.startReceptionGrill>) {
  return grill.advanceReceptionGrill({
    state,
    reply: '1. 改单文件；2. 无约束；3. 代码变更；4. 测试通过',
  });
}

describe('advanceReceptionGrill — 一轮多答（P3）', () => {
  it('一条回复结算整个 frontier，直接进入待确认', () => {
    const state = grill.startReceptionGrill(INTENT);
    const advanced = settleAllDimensions(state);

    expect(advanced.kind).toBe('awaiting-confirmation');
    expect(
      advanced.state.nodes
        .filter((node) => node.id !== '__grill_confirm__')
        .map((node) => node.answer),
    ).toEqual(['改单文件', '无约束', '代码变更', '测试通过']);
    expect(state.nodes.every((node) => node.answer === undefined)).toBe(true);
  });

  it('维度式回复同样可一次回答多项', () => {
    const advanced = grill.advanceReceptionGrill({
      state: grill.startReceptionGrill(INTENT),
      reply: '目标：改单文件。约束：无约束。',
    });
    expect(advanced.state.nodes.find((node) => node.id === 'goal')?.answer).toBe('改单文件');
    expect(advanced.state.nodes.find((node) => node.id === 'constraint')?.answer).toBe('无约束');
    expect(advanced.state.nodes.find((node) => node.id === 'deliverable')?.answer).toBeUndefined();
  });

  it('多段均无法定位时不推进，提示歧义片段', () => {
    const state = grill.startReceptionGrill(INTENT);
    const advanced = grill.advanceReceptionGrill({ state, reply: '第一点\n第二点' });
    expect(advanced.kind).toBe('question');
    expect(advanced.state).toBe(state);
    expect(advanced.text).toContain('我没能确定这几段回复对应哪一项');
  });
});

describe('advanceReceptionGrill — 有界驳回（P2）', () => {
  it('驳回后的重提列出仍需拍板的共识项并记录 rejections', () => {
    const awaiting = settleAllDimensions(grill.startReceptionGrill(INTENT)).state;
    const rejected = grill.advanceReceptionGrill({ state: awaiting, reply: '需修改' });

    expect(rejected.kind).toBe('awaiting-confirmation');
    expect(rejected.text).toContain('还需你拍板的还有 4 项');
    expect(rejected.state.rejections).toHaveLength(1);
    expect(rejected.state.rejections?.[0]?.outstanding).toEqual([
      'goal',
      'constraint',
      'deliverable',
      'acceptance',
    ]);
  });

  it('连续 6 次驳回后进入 exhausted，不再无休止重提', () => {
    let advanced = grill.advanceReceptionGrill({
      state: settleAllDimensions(grill.startReceptionGrill(INTENT)).state,
      reply: '需修改',
    });
    for (let attempt = 1; attempt < 6; attempt += 1) {
      advanced = grill.advanceReceptionGrill({ state: advanced.state, reply: '需修改' });
    }

    expect(advanced.kind).toBe('exhausted');
    expect(advanced.state.exhaustedAt).toBeTypeOf('number');
    expect(advanced.state.rejections).toHaveLength(6);
    expect(advanced.text).toContain('先暂停澄清');
  });
});

describe('formatFrontierPrompt — 多答提示（P3）', () => {
  it('明示可一次回复多项并给出两种写法', () => {
    const text = grill.formatFrontierPrompt(grill.startReceptionGrill(INTENT));
    expect(text).toContain('你可以一次性回复多项');
    expect(text).toContain('写法一（按序号）');
    expect(text).toContain('写法二（按维度）');
  });
});

function exhaustGrill() {
  let advanced = grill.advanceReceptionGrill({
    state: settleAllDimensions(grill.startReceptionGrill(INTENT)).state,
    reply: '需修改',
  });
  for (let attempt = 1; attempt < 6; attempt += 1) {
    advanced = grill.advanceReceptionGrill({ state: advanced.state, reply: '需修改' });
  }
  return advanced.state;
}

describe('advanceReceptionGrill — 耗尽态的两条承诺出路', () => {
  it('已耗尽态 + 「按推荐项继续」→ confirmed 且写入 confirmedAt', () => {
    const advanced = grill.advanceReceptionGrill({ state: exhaustGrill(), reply: '按推荐项继续' });

    expect(advanced.kind).toBe('confirmed');
    expect(typeof advanced.state.confirmedAt).toBe('number');
  });

  it('已耗尽态 + 肯定同义词（确认）→ confirmed', () => {
    const advanced = grill.advanceReceptionGrill({ state: exhaustGrill(), reply: '确认' });

    expect(advanced.kind).toBe('confirmed');
    expect(typeof advanced.state.confirmedAt).toBe('number');
  });

  it('已耗尽态 + 「取消」→ cancelled，状态不变且不写 confirmedAt', () => {
    const state = exhaustGrill();
    const advanced = grill.advanceReceptionGrill({ state, reply: '取消' });

    expect(advanced.kind).toBe('cancelled');
    expect(advanced.state).toBe(state);
    expect(advanced.state.confirmedAt).toBeUndefined();
  });

  it('已耗尽态 + 无关文本 → 仍 exhausted（重述提示），不改状态、不写 confirmedAt', () => {
    const state = exhaustGrill();
    const advanced = grill.advanceReceptionGrill({ state, reply: '随便说点什么' });

    expect(advanced.kind).toBe('exhausted');
    expect(advanced.state).toBe(state);
    expect(advanced.state.confirmedAt).toBeUndefined();
    expect(advanced.text).toContain('先暂停澄清');
  });

  it('已耗尽态 + 空回复 → 仍 exhausted（不退回普通前沿提示）', () => {
    const state = exhaustGrill();
    const advanced = grill.advanceReceptionGrill({ state, reply: '   ' });

    expect(advanced.kind).toBe('exhausted');
    expect(advanced.state).toBe(state);
  });

  it('无推荐选项且无答案的节点：记录显式「未决」标记而非编造答案，仍能确认', () => {
    const nodes: ClarificationNode[] = [
      {
        id: 'goal',
        dimension: 'goal',
        question: '目标？',
        options: [{ label: '默认目标', recommended: true }],
        dependsOn: [],
      },
      {
        id: 'constraint',
        dimension: 'constraint',
        question: '约束？',
        options: [{ label: '约束 X' }, { label: '约束 Y' }],
        dependsOn: [],
      },
    ];
    const state = {
      ...createGrillState([...nodes, buildConfirmNode(['goal', 'constraint'])]),
      exhaustedAt: 1,
    };

    const advanced = grill.advanceReceptionGrill({ state, reply: '按推荐项继续' });

    expect(advanced.kind).toBe('confirmed');
    expect(advanced.state.nodes.find((node) => node.id === 'goal')?.answer).toBe('默认目标');
    const unresolved = advanced.state.nodes.find((node) => node.id === 'constraint')?.answer;
    expect(unresolved).toBe(grill.EXHAUSTED_UNRESOLVED_ANSWER);
    expect(unresolved).toContain('未决');
  });
});
