import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as RuntimeReconcilerModule from '../../session/session-runtime-reconciler.js';
import type * as SubagentLimitsModule from '../../task/subagent-limits.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'subagent-limits-boot-reconcile-secret-1234567890';

let dbModule: typeof DbModule;
let limitsModule: typeof SubagentLimitsModule;
let reconcilerModule: typeof RuntimeReconcilerModule;

const USER_ID = 'u-boot-reconcile';
const ROOT_SESSION_ID = 'root-session';

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  limitsModule = await import('../../task/subagent-limits.js');
  reconcilerModule = await import('../../session/session-runtime-reconciler.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'subagent-limits-boot@example.test',
    'x',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings WHERE user_id = ?', [USER_ID]);
  dbModule.sqliteRun('DELETE FROM permission_requests WHERE session_id LIKE ?', [`%${USER_ID}%`]);
  dbModule.sqliteRun('DELETE FROM sessions WHERE user_id = ?', [USER_ID]);
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', '{}', ?)`,
    [ROOT_SESSION_ID, USER_ID, ROOT_SESSION_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'subagent_limits', ?)`,
    [USER_ID, JSON.stringify({ maxActivePerRoot: 1, maxNestingDepth: 1 })],
  );
});

/** 崩溃遗留的子会话：状态仍是 running，但既无运行线程也无在途流。 */
function seedStaleTaskChildSession(input: {
  id: string;
  stateStatus?: string;
  parentSessionId?: string;
}): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', ?, ?, ?)`,
    [
      input.id,
      USER_ID,
      input.stateStatus ?? 'running',
      JSON.stringify({ createdByTool: 'task', parentSessionId: input.parentSessionId ?? null }),
      input.id,
    ],
  );
}

function seedPendingPermissionRequest(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests (id, session_id, tool_name, scope, reason, risk_level, status)
     VALUES (?, ?, 'write_file', 'session', '需要写入文件', 'medium', 'pending')`,
    [`perm-${sessionId}`, sessionId],
  );
}

function readStateStatus(sessionId: string): string | undefined {
  return dbModule.sqliteGet<{ state_status: string }>(
    'SELECT state_status FROM sessions WHERE id = ?',
    [sessionId],
  )?.state_status;
}

describe('网关重启对账与子代理活跃名额', () => {
  it('崩溃遗留的 running 子会话在启动对账后释放活跃名额，不把任务树锁死', async () => {
    seedStaleTaskChildSession({ id: 'child-stale-running', parentSessionId: ROOT_SESSION_ID });

    // 对账前：持久化状态仍是 running，判定为活跃并占掉唯一名额。
    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toContain('活跃的子代理已达到上限（1）');

    // 启动期批量对账（index.ts 的 gateway.reconcile-session-runtimes）。
    const result = await reconcilerModule.reconcileAllSessionRuntimes();

    expect(result.failedSessionIds).not.toContain('child-stale-running');
    expect(readStateStatus('child-stale-running')).toBe('idle');
    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('崩溃遗留的待交互子会话在启动对账后转为 paused 并继续占用名额', async () => {
    seedStaleTaskChildSession({ id: 'child-stale-paused', parentSessionId: ROOT_SESSION_ID });
    seedPendingPermissionRequest('child-stale-paused');

    await reconcilerModule.reconcileAllSessionRuntimes();

    // 保留待答复的请求 = 子代理仍可被恢复执行，因此按活跃计名（有意为之）。
    expect(readStateStatus('child-stale-paused')).toBe('paused');
    expect(
      limitsModule.getTaskSessionLimitError({
        currentSessionId: ROOT_SESSION_ID,
        userId: USER_ID,
      }),
    ).toContain('活跃的子代理已达到上限（1）');
  });
});
