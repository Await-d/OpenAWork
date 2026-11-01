import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PermissionLadder from '../../tools/sandbox/permission-ladder.js';

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

let db: typeof DbModule;
let ladder: typeof PermissionLadder;
const USER_ID = 'permission-lineage-user';

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  ladder = await import('../../tools/sandbox/permission-ladder.js');
}, 60000);

beforeEach(() => {
  db.sqliteRun('DELETE FROM permission_grants', []);
  db.sqliteRun('DELETE FROM permission_requests', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);
  for (const userId of [USER_ID, 'other-user']) {
    db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      userId,
      `${userId}@example.com`,
    ]);
  }
  insertSession('parent');
});

afterAll(async () => {
  await db.closeDb();
});

function insertSession(
  id: string,
  options: { parent?: string; legacyParent?: string; userId?: string } = {},
) {
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, metadata_json, parent_id)
     VALUES (?, ?, ?, ?)`,
    [
      id,
      options.userId ?? USER_ID,
      JSON.stringify(
        options.parent ? { createdByTool: 'task', parentSessionId: options.parent } : {},
      ),
      options.legacyParent ?? null,
    ],
  );
}

function approve(sessionId = 'parent', decision = 'session', scope = 'printf *') {
  const id = `approval-${sessionId}`;
  db.sqliteRun(
    `INSERT INTO permission_requests
       (id, session_id, tool_name, scope, reason, risk_level, status, decision,
        always_json, expires_at, created_at, updated_at)
     VALUES (?, ?, 'bash', ?, 'test', 'medium', 'approved', ?, '[]', 1,
             '2020-01-01 00:00:00', '2020-01-01 00:00:00')`,
    [id, sessionId, scope, decision],
  );
  return id;
}

function check(sessionId: string, command = 'printf second') {
  return ladder.ensurePermissionForTool(
    sessionId,
    { toolCallId: 'lineage-call', toolName: 'bash', rawInput: { command } },
    undefined,
  );
}

describe('会话授权持久化与子代理继承', () => {
  it('任务子会话通过实际持久化的 metadata.parentSessionId 继承授权', async () => {
    insertSession('child', { parent: 'parent' });
    const requestId = approve();

    expect(await check('child')).toEqual({ kind: 'approved', requestId, decision: 'session' });
    expect(db.sqliteAll("SELECT id FROM permission_requests WHERE status = 'pending'", [])).toEqual(
      [],
    );
  });

  it('嵌套任务沿祖先链继承，不因进入下一层子代理重复申请', async () => {
    insertSession('child', { parent: 'parent' });
    insertSession('grandchild', { parent: 'child' });
    const requestId = approve();

    expect(await check('grandchild')).toEqual({ kind: 'approved', requestId, decision: 'session' });
  });

  it('兼容旧 parent_id 父子关系', async () => {
    insertSession('child', { legacyParent: 'parent' });
    const requestId = approve();

    expect(await check('child')).toEqual({ kind: 'approved', requestId, decision: 'session' });
  });

  it('任务来源以 metadata 父会话为准，不误继承旧 parent_id 的授权', async () => {
    insertSession('unrelated');
    insertSession('child', { parent: 'unrelated', legacyParent: 'parent' });
    approve();

    expect(await check('child')).toMatchObject({ kind: 'pending' });
  });

  it('同会话授权在后续检查中持续生效，不按原申请过期时间失效', async () => {
    const requestId = approve();

    expect(await check('parent')).toEqual({ kind: 'approved', requestId, decision: 'session' });
    expect(await check('parent', 'printf later')).toEqual({
      kind: 'approved',
      requestId,
      decision: 'session',
    });
  });

  it('只继承已授权范围，其他命令仍须审批', async () => {
    insertSession('child', { parent: 'parent' });
    approve();

    expect(await check('child', 'git status')).toMatchObject({ kind: 'pending' });
  });

  it('父会话的单次允许不继承给子会话', async () => {
    insertSession('child', { parent: 'parent' });
    approve('parent', 'once', 'printf second');

    expect(await check('child')).toMatchObject({ kind: 'pending' });
  });

  it('单次允许使用后仍须重新审批', async () => {
    const requestId = approve('parent', 'once', 'printf second');
    expect(await check('parent')).toEqual({ kind: 'approved', requestId, decision: 'once' });

    ladder.consumeOncePermission(requestId);

    expect(await check('parent')).toMatchObject({ kind: 'pending' });
  });

  it.each(['metadata', 'parent_id'])('不通过 %s 继承其他用户的会话授权', async (source) => {
    insertSession('foreign', { userId: 'other-user' });
    insertSession(
      'child',
      source === 'metadata' ? { parent: 'foreign' } : { legacyParent: 'foreign' },
    );
    approve('foreign');

    expect(await check('child')).toMatchObject({ kind: 'pending' });
  });

  it('跨用户祖先链必须中断，不能绕回本用户的已授权会话', async () => {
    insertSession('foreign', { parent: 'parent', userId: 'other-user' });
    insertSession('child', { parent: 'foreign' });
    approve();

    expect(await check('child')).toMatchObject({ kind: 'pending' });
  });

  it('不继承兄弟会话的授权', async () => {
    insertSession('child', { parent: 'parent' });
    insertSession('sibling', { parent: 'parent' });
    approve('sibling');

    expect(await check('child')).toMatchObject({ kind: 'pending' });
  });

  it('父会话已删除时不继承残留来源引用', async () => {
    insertSession('child', { parent: 'parent' });
    approve();
    db.sqliteRun('DELETE FROM sessions WHERE id = ?', ['parent']);

    expect(await check('child')).toMatchObject({ kind: 'pending' });
  });

  it('祖先链成环时终止检查，不循环或自动放行', async () => {
    insertSession('child', { parent: 'cycle' });
    insertSession('cycle', { parent: 'child' });
    approve();

    expect(await check('child')).toMatchObject({ kind: 'pending' });
  });
});
