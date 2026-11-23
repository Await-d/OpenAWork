import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as PermissionsRoutesModule from '../../routes/permissions.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'permission-decisions-list-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let permissionsRoutes: typeof PermissionsRoutesModule.permissionsRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

const OWNER_ID = 'u-decisions-owner';
const STRANGER_ID = 'u-decisions-stranger';
const SESSION_ID = 'sess-decisions-owner';
const STRANGER_SESSION_ID = 'sess-decisions-stranger';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(permissionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId: string): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'decisions session', '{}', 'idle')`,
    [sessionId, userId],
  );
}

function seedDecision(input: {
  requestId: string;
  sessionId?: string;
  toolName?: string;
  scope?: string;
  decision?: string;
  reason?: string | null;
  workspaceRoot?: string | null;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_decision_logs
       (request_id, session_id, tool_name, scope, decision, reason, workspace_root, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.requestId,
      input.sessionId ?? SESSION_ID,
      input.toolName ?? 'bash',
      input.scope ?? 'ls -la',
      input.decision ?? 'approved',
      // `reason` is explicitly nullable: `undefined` keeps the default, `null`
      // must stay null (historical rows predate the column).
      input.reason === undefined ? 'user_approved' : input.reason,
      input.workspaceRoot === undefined ? '/workspace/demo' : input.workspaceRoot,
    ],
  );
}

function countDecisionRows(): number {
  const row = dbModule.sqliteGet<{ total: number }>(
    'SELECT COUNT(*) AS total FROM permission_decision_logs',
  );
  return row?.total ?? 0;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  permissionsRoutes = (await import('../../routes/permissions.js')).permissionsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_decision_logs', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(OWNER_ID);
  seedUser(STRANGER_ID);
  seedSession(SESSION_ID, OWNER_ID);
  seedSession(STRANGER_SESSION_ID, STRANGER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /sessions/:sessionId/permissions/decisions', () => {
  it('无 token 返回 401', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions`,
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('跨用户读取返回 404 同一文案，且响应体不含任何决策行', async () => {
    seedDecision({ requestId: 'req-secret-1', scope: 'rm -rf /tmp/secret' });
    seedDecision({ requestId: 'req-secret-2' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions`,
        headers: { authorization: bearer(app, STRANGER_ID) },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: '目标会话不存在。' });
      // 不泄露：既没有行，也没有任何 requestId / tool 名残留。
      expect(response.body).not.toContain('req-secret');
      expect(response.body).not.toContain('rm -rf');
      expect(response.body).not.toContain('decisions');
    } finally {
      await app.close();
    }
  });

  it('不存在的会话与越权会话返回完全相同的响应（不泄露存在性）', async () => {
    const app = await buildApp();
    try {
      const missing = await app.inject({
        method: 'GET',
        url: '/sessions/sess-does-not-exist/permissions/decisions',
        headers: { authorization: bearer(app, STRANGER_ID) },
      });
      const forbidden = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions`,
        headers: { authorization: bearer(app, STRANGER_ID) },
      });
      expect(missing.statusCode).toBe(404);
      expect(forbidden.statusCode).toBe(404);
      expect(missing.body).toBe(forbidden.body);
    } finally {
      await app.close();
    }
  });

  it('按 id 倒序返回并映射为 camelCase，reason 为 null 的历史行原样透出 null', async () => {
    seedDecision({ requestId: 'req-1', reason: 'user_approved' });
    seedDecision({ requestId: 'req-2', reason: null, workspaceRoot: null });
    seedDecision({ requestId: 'req-3', reason: 'rule_denied', decision: 'denied' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        decisions: Array<Record<string, unknown>>;
      };
      expect(body.decisions.map((row) => row['requestId'])).toEqual(['req-3', 'req-2', 'req-1']);
      expect(body.decisions[0]).toEqual({
        id: expect.any(Number),
        requestId: 'req-3',
        sessionId: SESSION_ID,
        toolName: 'bash',
        scope: 'ls -la',
        decision: 'denied',
        reason: 'rule_denied',
        workspaceRoot: '/workspace/demo',
        createdAt: expect.any(String),
      });
      expect(body.decisions[1]?.['reason']).toBeNull();
      expect(body.decisions[1]?.['workspaceRoot']).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('默认 limit 为 50', async () => {
    for (let index = 0; index < 60; index += 1) {
      seedDecision({ requestId: `req-default-${index}` });
    }
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { decisions: unknown[] }).decisions).toHaveLength(50);
    } finally {
      await app.close();
    }
  });

  it('limit 超过上限 200 时截断为 200（不报错）', async () => {
    for (let index = 0; index < 210; index += 1) {
      seedDecision({ requestId: `req-cap-${index}` });
    }
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions?limit=201`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { decisions: unknown[] }).decisions).toHaveLength(200);
    } finally {
      await app.close();
    }
  });

  it('非法 limit 安全回落到默认值（不退化成全表扫描、不注入）', async () => {
    for (let index = 0; index < 60; index += 1) {
      seedDecision({ requestId: `req-bad-limit-${index}` });
    }
    const app = await buildApp();
    try {
      for (const raw of ['abc', '-5', '0', '1;DROP TABLE permission_decision_logs', '']) {
        const response = await app.inject({
          method: 'GET',
          url: `/sessions/${SESSION_ID}/permissions/decisions?limit=${encodeURIComponent(raw)}`,
          headers: { authorization: bearer(app, OWNER_ID) },
        });
        expect(response.statusCode).toBe(200);
        expect((response.json() as { decisions: unknown[] }).decisions).toHaveLength(50);
      }
      // 表依然存在（注入未执行）。
      expect(countDecisionRows()).toBe(60);
    } finally {
      await app.close();
    }
  });

  it('beforeId 游标分页：第 2 页不重复且恰好接续', async () => {
    for (let index = 0; index < 5; index += 1) {
      seedDecision({ requestId: `req-page-${index}` });
    }
    const app = await buildApp();
    try {
      const first = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions?limit=2`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      const firstBody = first.json() as { decisions: Array<{ id: number; requestId: string }> };
      expect(firstBody.decisions.map((row) => row.requestId)).toEqual(['req-page-4', 'req-page-3']);

      const lastId = firstBody.decisions[firstBody.decisions.length - 1]?.id as number;
      const second = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions?limit=2&beforeId=${lastId}`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      const secondBody = second.json() as { decisions: Array<{ id: number; requestId: string }> };
      expect(secondBody.decisions.map((row) => row.requestId)).toEqual([
        'req-page-2',
        'req-page-1',
      ]);
      const overlap = firstBody.decisions.filter((row) =>
        secondBody.decisions.some((other) => other.id === row.id),
      );
      expect(overlap).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('非法 beforeId 安全回落到第一页', async () => {
    seedDecision({ requestId: 'req-cursor-1' });
    seedDecision({ requestId: 'req-cursor-2' });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions?beforeId=abc`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { decisions: unknown[] }).decisions).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('无决策的会话返回空数组而不是 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ decisions: [] });
    } finally {
      await app.close();
    }
  });

  it('只返回本会话的行，不串到其他会话', async () => {
    seedDecision({ requestId: 'req-mine' });
    seedDecision({ requestId: 'req-stranger', sessionId: STRANGER_SESSION_ID });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { decisions: Array<{ requestId: string }> };
      expect(body.decisions.map((row) => row.requestId)).toEqual(['req-mine']);
    } finally {
      await app.close();
    }
  });

  it('只读：调用后表内行数与内容不变', async () => {
    seedDecision({ requestId: 'req-readonly-1' });
    seedDecision({ requestId: 'req-readonly-2' });
    const before = countDecisionRows();

    const app = await buildApp();
    try {
      await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions?limit=200`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/decisions?beforeId=999999`,
        headers: { authorization: bearer(app, OWNER_ID) },
      });
      expect(countDecisionRows()).toBe(before);
    } finally {
      await app.close();
    }
  });
});

describe('级联拒绝的决策流水（与批准级联对称）', () => {
  function seedPending(input: {
    id: string;
    toolName?: string;
    scope?: string;
    sessionId?: string;
  }): void {
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
        (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
       VALUES (?, ?, ?, ?, 'reason', 'medium', NULL, '{}', NULL, NULL, 'pending')`,
      [input.id, input.sessionId ?? SESSION_ID, input.toolName ?? 'bash', input.scope ?? 'ls -la'],
    );
  }

  function decisionRowsFor(
    sessionId: string,
  ): Array<{ request_id: string; decision: string; reason: string | null }> {
    return dbModule.sqliteAll<{ request_id: string; decision: string; reason: string | null }>(
      'SELECT request_id, decision, reason FROM permission_decision_logs WHERE session_id = ? ORDER BY id ASC',
      [sessionId],
    );
  }

  it('拒绝时被级联置为 rejected 的同会话 pending 也写入决策流水', async () => {
    seedPending({ id: 'rj-primary', scope: 'ls -la' });
    seedPending({ id: 'rj-cascade-1', scope: 'git status' });
    seedPending({ id: 'rj-cascade-2', toolName: 'write', scope: 'a.txt' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/permissions/reply`,
        headers: { authorization: bearer(app, OWNER_ID), 'content-type': 'application/json' },
        payload: { requestId: 'rj-primary', decision: 'reject' },
      });
      expect(response.statusCode).toBe(200);

      const rows = decisionRowsFor(SESSION_ID);
      expect(rows.map((row) => row.request_id).sort()).toEqual([
        'rj-cascade-1',
        'rj-cascade-2',
        'rj-primary',
      ]);
      // 与批准级联对齐：reason 一律走可枚举词表，人工作答记 user_rejected。
      for (const row of rows) {
        expect(row).toMatchObject({ decision: 'reject', reason: 'user_rejected' });
      }
    } finally {
      await app.close();
    }
  });

  it('跨会话 pending 不被级联，也不产生决策流水', async () => {
    seedPending({ id: 'rx-primary', scope: 'ls -la' });
    seedPending({ id: 'rx-other-session', sessionId: STRANGER_SESSION_ID });

    const app = await buildApp();
    try {
      await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/permissions/reply`,
        headers: { authorization: bearer(app, OWNER_ID), 'content-type': 'application/json' },
        payload: { requestId: 'rx-primary', decision: 'reject' },
      });
      expect(decisionRowsFor(STRANGER_SESSION_ID)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('重复提交同一拒绝（幂等收口 409）不会为级联行重复记账', async () => {
    seedPending({ id: 'ri-primary', scope: 'ls -la' });
    seedPending({ id: 'ri-cascade', scope: 'git status' });

    const app = await buildApp();
    try {
      await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/permissions/reply`,
        headers: { authorization: bearer(app, OWNER_ID), 'content-type': 'application/json' },
        payload: { requestId: 'ri-primary', decision: 'reject' },
      });
      const afterFirst = decisionRowsFor(SESSION_ID);

      const replay = await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/permissions/reply`,
        headers: { authorization: bearer(app, OWNER_ID), 'content-type': 'application/json' },
        payload: { requestId: 'ri-primary', decision: 'reject' },
      });
      expect(replay.statusCode).toBe(409);
      expect(decisionRowsFor(SESSION_ID)).toEqual(afterFirst);
    } finally {
      await app.close();
    }
  });
});
