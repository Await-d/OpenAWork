import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SubagentDepthModule from '../../task/subagent-depth.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'subagent-depth-test-secret-1234567890';

let dbModule: typeof DbModule;
let depth: typeof SubagentDepthModule;

const USER_ID = 'u-subagent-depth';

function chainRow(
  parentSessionId: string | null,
  id = 'sess',
): {
  id: string;
  metadata_json: string;
} {
  return {
    id,
    metadata_json: JSON.stringify(parentSessionId ? { parentSessionId } : {}),
  };
}

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  depth = await import('../../task/subagent-depth.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'subagent-depth@example.test',
    'x',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings WHERE user_id = ?', [USER_ID]);
});

function seedChain(parentSessionId: string | null, id: string): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', ?, ?)`,
    [id, USER_ID, chainRow(parentSessionId, id).metadata_json, id],
  );
}

describe('computeSubagentDepth（纯函数）', () => {
  it('顶层会话深度为 0，逐层递增', () => {
    const rows = new Map([
      ['root', chainRow(null, 'root')],
      ['child', chainRow('root', 'child')],
      ['grandchild', chainRow('child', 'grandchild')],
    ]);

    const load = (id: string) => rows.get(id);
    expect(depth.computeSubagentDepth('root', load)).toBe(0);
    expect(depth.computeSubagentDepth('child', load)).toBe(1);
    expect(depth.computeSubagentDepth('grandchild', load)).toBe(2);
  });

  it('会话不存在时返回 0（不抛错）', () => {
    expect(depth.computeSubagentDepth('missing', () => undefined)).toBe(0);
  });

  it('父链断裂时在断点停止', () => {
    const rows = new Map([
      ['child', chainRow('unknown-parent', 'child')],
      ['grandchild', chainRow('child', 'grandchild')],
    ]);
    const load = (id: string) => rows.get(id);

    expect(depth.computeSubagentDepth('child', load)).toBe(1);
    expect(depth.computeSubagentDepth('grandchild', load)).toBe(2);
  });

  it('父链自环时不死循环', () => {
    const rows = new Map([
      ['a', chainRow('a', 'a')],
      ['b', chainRow('b', 'b')],
    ]);
    const load = (id: string) => rows.get(id);

    expect(depth.computeSubagentDepth('a', load)).toBe(0);
    expect(depth.computeSubagentDepth('b', load)).toBe(0);
  });

  it('metadata_json 损坏时按 0 深度处理', () => {
    const load = () => ({ id: 'x', metadata_json: '{not-json' });
    expect(depth.computeSubagentDepth('x', load)).toBe(0);
  });
});

describe('resolveSubagentDepthLimit', () => {
  it('无设置时回落上游默认值 1', () => {
    expect(depth.resolveSubagentDepthLimit(USER_ID)).toBe(1);
  });

  it('读取用户设置', () => {
    dbModule.sqliteRun(
      "INSERT OR REPLACE INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
      [USER_ID, 'subagent_depth', JSON.stringify(3)],
    );

    expect(depth.resolveSubagentDepthLimit(USER_ID)).toBe(3);
  });

  it('非法值回落默认值，超大值被护栏收敛', () => {
    const cases: Array<{ stored: string; expected: number }> = [
      { stored: JSON.stringify(0), expected: 1 },
      { stored: JSON.stringify(-2), expected: 1 },
      { stored: JSON.stringify('junk'), expected: 1 },
      { stored: JSON.stringify(999), expected: 8 },
    ];

    for (const testCase of cases) {
      dbModule.sqliteRun(
        "INSERT OR REPLACE INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
        [USER_ID, 'subagent_depth', testCase.stored],
      );
      expect(depth.resolveSubagentDepthLimit(USER_ID)).toBe(testCase.expected);
    }
  });
});

describe('checkSubagentDepthAllowed（真实 SQLite 父链）', () => {
  it('顶层会话允许派生第一层子代理', () => {
    seedChain(null, 'root-sess');
    const result = depth.checkSubagentDepthAllowed({
      parentSessionId: 'root-sess',
      userId: USER_ID,
    });

    expect(result.allowed).toBe(true);
    expect(result.depth).toBe(0);
    expect(result.limit).toBe(1);
  });

  it('已处于第一层的子会话默认被拒绝（对齐上游默认 1）', () => {
    seedChain(null, 'root-sess-2');
    seedChain('root-sess-2', 'child-sess-2');

    const result = depth.checkSubagentDepthAllowed({
      parentSessionId: 'child-sess-2',
      userId: USER_ID,
    });

    expect(result.allowed).toBe(false);
    expect(result.depth).toBe(1);
    if (result.allowed) {
      throw new Error('应当被拒绝');
    }
    expect(result.message).toContain('子代理嵌套深度上限');
    expect(result.message).toContain('设置页');
  });

  it('提高用户设置后同一会话恢复允许', () => {
    seedChain(null, 'root-sess-3');
    seedChain('root-sess-3', 'child-sess-3');
    dbModule.sqliteRun(
      "INSERT OR REPLACE INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
      [USER_ID, 'subagent_depth', JSON.stringify(2)],
    );

    const result = depth.checkSubagentDepthAllowed({
      parentSessionId: 'child-sess-3',
      userId: USER_ID,
    });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(2);
  });

  it('注入 loader 时不需要数据库', () => {
    const result = depth.checkSubagentDepthAllowed({
      parentSessionId: 'deep',
      userId: USER_ID,
      loadSession: (id) =>
        id === 'deep'
          ? chainRow('mid', 'deep')
          : id === 'mid'
            ? chainRow('root', 'mid')
            : id === 'root'
              ? chainRow(null, 'root')
              : undefined,
    });

    expect(result.allowed).toBe(false);
    expect(result.depth).toBe(2);
  });
});
