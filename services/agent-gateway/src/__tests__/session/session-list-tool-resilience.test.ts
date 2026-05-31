import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SessionManagerToolsModule from '../../session/session-manager-tools.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

// Mock only the dynamically-imported runtime reconciler so we can control
// whether a session's reconciliation throws, while every other dependency
// (DB, message adapter) runs for real.
const reconcileSessionRuntime = vi.fn();
vi.mock('../../session/session-runtime-reconciler.js', () => ({
  reconcileSessionRuntime: (input: { sessionId: string; userId: string }) =>
    reconcileSessionRuntime(input),
}));

let dbModule: typeof DbModule;
let runSessionListTool: typeof SessionManagerToolsModule.runSessionListTool;

const USER_ID = 'u-session-list-resilience';

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(id: string, title: string, stateStatus = 'idle'): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, messages_json, metadata_json, state_status, created_at, updated_at)
     VALUES (?, ?, ?, '[]', '{}', ?, datetime('now'), datetime('now'))`,
    [id, USER_ID, title, stateStatus],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  runSessionListTool = (await import('../../session/session-manager-tools.js')).runSessionListTool;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  reconcileSessionRuntime.mockReset();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('runSessionListTool 行级韧性', () => {
  it('单个会话的运行时状态读取抛错时整列不失败，损坏行降级为持久状态', async () => {
    seedSession('sess-x', '会话X', 'error');
    reconcileSessionRuntime.mockImplementation(() => {
      throw new Error('reconcile boom');
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Must resolve (not reject) despite reconciliation throwing.
    const output = await runSessionListTool(USER_ID, {});

    const line = output.split('\n').find((l) => l.includes('sess-x'));
    expect(line).toBeDefined();
    // Degraded row: message count '?' + persisted state_status fallback.
    expect(line).toContain('| ? |');
    expect(line).toContain('error');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('会话运行时状态读取正常时返回协调后的状态', async () => {
    seedSession('sess-1', '会话一', 'idle');
    reconcileSessionRuntime.mockResolvedValue({ status: 'paused' });

    const output = await runSessionListTool(USER_ID, {});
    const line = output.split('\n').find((l) => l.includes('sess-1'));
    expect(line).toContain('paused');
    // Healthy row keeps the real message count (0), not the degraded '?'.
    expect(line).toContain('| 0 |');
  });
});
