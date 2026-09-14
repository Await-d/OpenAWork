import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serializeGrillState } from '@openAwork/agent-core';
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
