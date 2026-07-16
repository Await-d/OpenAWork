import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as UserWorkspaceAllowlistModule from '../../workspace/user-workspace-allowlist.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'workspace-allowlist-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ACCESS_MODE'] = 'unrestricted';

let dbModule: typeof DbModule;
let workspaceAllowlistModule: typeof UserWorkspaceAllowlistModule;

const USER_ID = 'u-workspace-allowlist';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  workspaceAllowlistModule = await import('../../workspace/user-workspace-allowlist.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  workspaceAllowlistModule.__resetUserWorkspaceAllowlistCacheForTest();

  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'workspace-allowlist@example.com',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('user workspace allowlist', () => {
  it('会保留 Windows 绝对路径工作区并允许命中子路径', () => {
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'workspace', ?, 'idle')`,
      [
        's-workspace-windows',
        USER_ID,
        JSON.stringify({ workingDirectory: 'D:\\Projects\\OpenAWork' }),
      ],
    );

    expect(workspaceAllowlistModule.getUserWorkspaceAllowlist(USER_ID)).toEqual([
      'D:\\Projects\\OpenAWork',
    ]);
    expect(
      workspaceAllowlistModule.isPathInUserAllowlist(
        USER_ID,
        'D:\\Projects\\OpenAWork\\apps\\web\\src\\App.tsx',
      ),
    ).toBe(true);
  });
});
