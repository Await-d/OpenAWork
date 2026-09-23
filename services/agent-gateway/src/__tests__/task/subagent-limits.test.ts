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
  it('无任何设置时返回默认值（4 / 24 / 1）', () => {
    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 4,
      maxTotalPerRoot: 24,
      maxNestingDepth: 1,
    });
  });

  it('读取已保存的完整限制', () => {
    writeUserSetting('subagent_limits', {
      maxRunningPerRoot: 6,
      maxTotalPerRoot: 30,
      maxNestingDepth: 2,
    });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 6,
      maxTotalPerRoot: 30,
      maxNestingDepth: 2,
    });
  });

  it('部分字段缺失时逐项回落默认值', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 8 });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 8,
      maxTotalPerRoot: 24,
      maxNestingDepth: 1,
    });
  });

  it('历史 subagent_depth 键作为嵌套深度回落来源', () => {
    writeUserSetting('subagent_depth', 3);

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 4,
      maxTotalPerRoot: 24,
      maxNestingDepth: 3,
    });
  });

  it('新键的深度优先于历史键', () => {
    writeUserSetting('subagent_depth', 2);
    writeUserSetting('subagent_limits', {
      maxRunningPerRoot: 4,
      maxTotalPerRoot: 24,
      maxNestingDepth: 5,
    });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID).maxNestingDepth).toBe(5);
  });

  it('越界值收敛到护栏边界', () => {
    writeUserSetting('subagent_limits', {
      maxRunningPerRoot: 999,
      maxTotalPerRoot: 999,
      maxNestingDepth: 99,
    });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 16,
      maxTotalPerRoot: 200,
      maxNestingDepth: 8,
    });
  });

  it('低于下限的累计上限收敛到边界后再抬升到并发上限', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 3, maxTotalPerRoot: -1 });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 3,
      maxTotalPerRoot: 3,
      maxNestingDepth: 1,
    });
  });

  it('累计上限小于并发上限时自动抬升累计上限', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 10, maxTotalPerRoot: 5 });

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 10,
      maxTotalPerRoot: 10,
      maxNestingDepth: 1,
    });
  });

  it('损坏的存储值不抛错，回落默认值', () => {
    dbModule.sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'subagent_limits', ?)`,
      [USER_ID, 'not-json'],
    );

    expect(limitsModule.resolveSubagentLimitsForUser(USER_ID)).toEqual({
      maxRunningPerRoot: 4,
      maxTotalPerRoot: 24,
      maxNestingDepth: 1,
    });
  });
});

describe('getTaskSessionLimitError（用户级可调）', () => {
  it('并发上限达到时拒绝新委派', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 1, maxTotalPerRoot: 24 });
    seedChildSession({
      id: 'child-running',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    const message = limitsModule.getTaskSessionLimitError({
      currentSessionId: ROOT_SESSION_ID,
      isNewChildSession: true,
      userId: USER_ID,
    });

    expect(message).toContain('正在运行的子代理已达到上限（1）');
  });

  it('提高并发上限后同一场景放行（设置即时生效）', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 2, maxTotalPerRoot: 24 });
    seedChildSession({
      id: 'child-running',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        isNewChildSession: true,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('resume 目标不占并发位（excludeRunningSessionId）', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 1, maxTotalPerRoot: 24 });
    seedChildSession({
      id: 'child-running',
      createdByTool: 'task',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        excludeRunningSessionId: 'child-running',
        isNewChildSession: true,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('非 task 工具创建的 running 会话不占并发位', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 1, maxTotalPerRoot: 24 });
    seedChildSession({
      id: 'handoff-child',
      parentSessionId: ROOT_SESSION_ID,
      stateStatus: 'running',
    });

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        isNewChildSession: true,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('累计上限达到时拒绝新建（已完成子会话同样计入）', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 2, maxTotalPerRoot: 2 });
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

    const message = limitsModule.getTaskSessionLimitError({
      currentSessionId: ROOT_SESSION_ID,
      isNewChildSession: true,
      userId: USER_ID,
    });

    expect(message).toContain('子代理数量已达到上限（2）');
  });

  it('resume（isNewChildSession=false）不受累计上限约束', () => {
    writeUserSetting('subagent_limits', { maxRunningPerRoot: 2, maxTotalPerRoot: 2 });
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

    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        isNewChildSession: false,
        userId: USER_ID,
      }),
    ).toBeNull();
  });
});
