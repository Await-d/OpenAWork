/**
 * 260515-team-phase-b · T-03 路由测试
 *
 * 覆盖只读 handoff 端点 + cancel 端点。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../db.js';
import type * as AuthModule from '../auth.js';
import type * as RequestWorkflowModule from '../request-workflow.js';
import type * as TeamHandoffsModule from '../routes/team-handoffs.js';
import type * as HandoffStoreModule from '../handoff/handoff-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamHandoffsRoutes: typeof TeamHandoffsModule.teamHandoffsRoutes;
let store: typeof HandoffStoreModule;

const USER_ID = 'u-handoff-rt';
const FROM_SESSION_ID = 's-from-rt';
const TO_SESSION_ID = 's-to-rt';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamHandoffsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json)
     VALUES (?, ?, 'demo', '{}')`,
    [sessionId, userId],
  );
}

beforeAll(async () => {
  dbModule = await import('../db.js');
  await dbModule.migrate();
  const auth = await import('../auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const team = await import('../routes/team-handoffs.js');
  teamHandoffsRoutes = team.teamHandoffsRoutes;
  store = await import('../handoff/handoff-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'rt@example.com');
  seedSession(FROM_SESSION_ID, USER_ID);
  seedSession(TO_SESSION_ID, USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('POST /team/sessions', () => {
  it('创建带 role_layer 的子 session', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/team/sessions',
        headers: { authorization: bearer(app) },
        payload: { roleLayer: 'pm1', teamParentSessionId: FROM_SESSION_ID },
      });
      expect(res.statusCode).toBe(201);
      const data = res.json() as { sessionId: string };
      expect(typeof data.sessionId).toBe('string');

      const row = dbModule.sqliteGet<{
        role_layer: string | null;
        team_parent_session_id: string | null;
      }>(`SELECT role_layer, team_parent_session_id FROM sessions WHERE id = ?`, [data.sessionId]);
      expect(row?.role_layer).toBe('pm1');
      expect(row?.team_parent_session_id).toBe(FROM_SESSION_ID);
    } finally {
      await app.close();
    }
  });

  it('teamParentSessionId 不存在返回 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/team/sessions',
        headers: { authorization: bearer(app) },
        payload: { roleLayer: 'pm1', teamParentSessionId: 'nope' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('非法 roleLayer 返回 400', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/team/sessions',
        headers: { authorization: bearer(app) },
        payload: { roleLayer: 'banana' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('POST /team/handoffs', () => {
  it('正常创建 pending handoff', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/team/handoffs',
        headers: { authorization: bearer(app) },
        payload: {
          fromSessionId: FROM_SESSION_ID,
          fromRoleLayer: 'reception',
          toRoleLayer: 'pm1',
          payload: { intent: 'test' },
        },
      });
      expect(res.statusCode).toBe(201);
      const data = res.json() as { handoff: { id: string; state: string } };
      expect(data.handoff.state).toBe('pending');
    } finally {
      await app.close();
    }
  });

  it('fromSessionId 不存在返回 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/team/handoffs',
        headers: { authorization: bearer(app) },
        payload: {
          fromSessionId: 'nope',
          fromRoleLayer: 'reception',
          toRoleLayer: 'pm1',
        },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('GET /team/handoffs/:handoffId', () => {
  it('已存在的 handoff 返回 200', async () => {
    const app = await buildApp();
    try {
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/team/handoffs/${created.id}`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ handoff: { id: created.id, state: 'pending' } });
    } finally {
      await app.close();
    }
  });

  it('不存在返回 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/handoffs/nope',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('其他用户 404（隔离）', async () => {
    const app = await buildApp();
    try {
      seedUser('u-other-rt', 'other-rt@example.com');
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/team/handoffs/${created.id}`,
        headers: { authorization: bearer(app, 'u-other-rt') },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('GET /team/sessions/:sessionId/handoffs', () => {
  it('返回该 session 涉及的所有 handoff', async () => {
    const app = await buildApp();
    try {
      store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/team/sessions/${FROM_SESSION_ID}/handoffs`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as { handoffs: unknown[] };
      expect(data.handoffs).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

describe('POST /team/handoffs/:handoffId/cancel', () => {
  it('pending 可被 cancel', async () => {
    const app = await buildApp();
    try {
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/cancel`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as { handoff: { state: string } };
      expect(data.handoff.state).toBe('cancelled');
    } finally {
      await app.close();
    }
  });

  it('completed 的不能 cancel，409', async () => {
    const app = await buildApp();
    try {
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
      store.startHandoff({
        handoffId: created.id,
        claimToken: 'tok',
        toSessionId: TO_SESSION_ID,
      });
      store.completeHandoff({ handoffId: created.id, claimToken: 'tok' });

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/cancel`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe('cannot-cancel');
    } finally {
      await app.close();
    }
  });
});
