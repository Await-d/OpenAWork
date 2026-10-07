import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SubagentLimitsModule from '../../task/subagent-limits.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'subagent-limits-test-secret-1234567890';

let dbModule: typeof DbModule;
let limitsModule: typeof SubagentLimitsModule;

const USER_ID = 'u-subagent-limits';
const ROOT_SESSION_ID = 'root-session';

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  limitsModule = await import('../../task/subagent-limits.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'subagent-limits@example.test',
    'x',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings WHERE user_id = ?', [USER_ID]);
  dbModule.sqliteRun('DELETE FROM sessions WHERE user_id = ?', [USER_ID]);
});

function seedChildSession(input: {
  id: string;
  createdByTool?: string;
  parentSessionId?: string;
  stateStatus?: string;
}): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', ?, ?, ?)`,
    [
      input.id,
      USER_ID,
      input.stateStatus ?? 'running',
      JSON.stringify({
        ...(input.createdByTool ? { createdByTool: input.createdByTool } : {}),
        ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      }),
      input.id,
    ],
  );
}

function writeUserSetting(key: string, value: unknown): void {
  dbModule.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    [USER_ID, key, JSON.stringify(value)],
  );
}

describe('resolveSubagentLimitsForUser', () => {
  it('无任何设置时返回默认值（4 / 1）', () => {
    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxActivePerRoot: 4,
      maxNestingDepth: 1,
    });
  });

  it('读取已保存的完整限制', () => {
    writeUserSetting('subagent_limits', {
      maxActivePerRoot: 6,
      maxNestingDepth: 2,
    });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxActivePerRoot: 6,
      maxNestingDepth: 2,
    });
  });

  it('部分字段缺失时逐项回落默认值', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 8 });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxActivePerRoot: 8,
      maxNestingDepth: 1,
    });
  });

  it('历史键 maxRunningPerRoot 回落为活跃上限', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 8, maxTotalPerRoot: 30 });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxActivePerRoot: 8,
      maxNestingDepth: 1,
    });
  });

  it('新键优先于历史键 maxRunningPerRoot', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 5, maxRunningPerRoot: 12 });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID).maxActivePerRoot).toBe(5);
  });

  it('历史 subagent_depth 键作为嵌套深度回落来源', () => {
    writeUserSetting('subagent_depth', 3);

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxActivePerRoot: 4,
      maxNestingDepth: 3,
    });
  });

  it('新键的深度优先于历史键', () => {
    writeUserSetting('subagent_depth', 2);
    writeUserSetting('subagent_limits', {
      maxActivePerRoot: 4,
      maxNestingDepth: 5,
    });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID).maxNestingDepth).toBe(5);
  });

  it('越界值收敛到护栏边界', () => {
    writeUserSetting('subagent_limits', {
      maxActivePerRoot: 999,
      maxNestingDepth: 99,
    });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxActivePerRoot: 16,
      maxNestingDepth: 8,
    });
  });

  it('损坏的存储值不抛错，回落默认值', () => {
    dbModule.sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'subagent_limits', ?)`,
      [USER_ID, 'not-json'],
    );

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxActivePerRoot: 4,
      maxNestingDepth: 1,
    });
  });
});

describe('getTaskSessionLimitError（同时活跃上限）', () => {
  it('活跃上限达到时拒绝新委派', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 1 });
    seedChildSession({
      id: 'child-running',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    const message = limitsModule.getTaskSessionLimitError({
      currentSessionId: ROOT_SESSION_ID,
      userId: USER_ID,
    });

    expect(message).toContain('活跃的子代理已达到上限（1）');
  });

  it('paused（待用户交互、未终结）同样占用活跃名额', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 1 });
    seedChildSession({
      id: 'child-paused',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'paused',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toContain('活跃的子代理已达到上限（1）');
  });

  it('已结束（idle）的子代理不再占用名额——名额可随结束释放', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 2 });
    seedChildSession({
      id: 'child-done-1',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'idle',
    });
    seedChildSession({
      id: 'child-done-2',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'idle',
    });
    seedChildSession({
      id: 'child-running',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('大量已结束的子代理不会像累计上限那样把任务树永久锁死', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 2 });
    for (let index = 0; index < 30; index += 1) {
      seedChildSession({
        id: `child-done-${index}`,
        createdByTool: 'task',
        parentSessionId: ROOT_SESSION_ID,
        stateStatus: 'idle',
      });
    }

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('提高上限后同一场景放行（设置即时生效）', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 2 });
    seedChildSession({
      id: 'child-running',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('resume 目标不占活跃名额（excludeActiveSessionId）', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 1 });
    seedChildSession({
      id: 'child-running',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        excludeActiveSessionId: 'child-running',
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('非 task 工具创建的 running 会话不占活跃名额', () => {
    writeUserSetting('subagent_limits', { maxActivePerRoot: 1 });
    seedChildSession({
      id: 'handoff-child',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toBeNull();
  });
});
