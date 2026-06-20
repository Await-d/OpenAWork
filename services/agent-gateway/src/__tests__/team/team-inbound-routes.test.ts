import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamInboundModule from '../../routes/team-inbound.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';
import { registerErrorHandler } from '../../infra/error-handler.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const orchestrateReceptionInputMock = vi.fn<() => Promise<{ triggered: boolean }>>();

vi.mock('../../handoff/runner/reception-orchestrator.js', () => ({
  orchestrateReceptionInput: orchestrateReceptionInputMock,
}));

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamInboundRoutes: typeof TeamInboundModule.teamInboundRoutes;
let teamEventsBus: typeof TeamEventsBusModule;

const USER_ID = 'u-team-inbound';
const OTHER_USER_ID = 'u-team-inbound-other';
const SESSION_ID = 's-team-inbound';
const TEAM_WORKSPACE_ID = 'tw-team-inbound';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamInboundRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedReceptionSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
     VALUES (?, ?, 'Reception', ?, 'reception', 'idle')`,
    [sessionId, userId, JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID })],
  );
}

function seedPm1Session(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
     VALUES (?, ?, 'PM1', ?, 'pm1', 'running')`,
    [sessionId, userId, JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID })],
  );
}

function countRows(tableName: string): number {
  const row = dbModule.sqliteGet<{ c: number }>(`SELECT COUNT(*) AS c FROM ${tableName}`, []);
  return row?.c ?? 0;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const teamInbound = await import('../../routes/team-inbound.js');
  teamInboundRoutes = teamInbound.teamInboundRoutes;
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
  orchestrateReceptionInputMock.mockReset();
  orchestrateReceptionInputMock.mockResolvedValue({ triggered: false });
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  dbModule.sqliteRun('DELETE FROM session_inbound_messages', []);
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM session_entry', []);
  dbModule.sqliteRun('DELETE FROM event_log', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
  seedReceptionSession(SESSION_ID, USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('POST /team/sessions/:sessionId/inbound-messages', () => {
  it('需要认证', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        payload: { messageType: 'user_input', payload: { text: 'hello' } },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('其他用户访问已有 session 时返回 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app, OTHER_USER_ID) },
        payload: { messageType: 'user_input', payload: { text: 'hello' } },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        code: 'team_session_not_found',
        error: '目标团队会话不存在。',
      });
      expect(countRows('session_inbound_messages')).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('新 user_input 返回 201 并写入 inbound 与 message_v2', async () => {
    const app = await buildApp();
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => {
      events.push(event);
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: {
          messageType: 'user_input',
          payload: { text: '帮我实现 OAuth 登录' },
          clientIdempotencyKey: 'route-user-input-1',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json() as { messageId: string; createdAt: string };
      expect(data.messageId).toBeTruthy();
      expect(data.createdAt).toBeTruthy();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'session.inbound.submitted',
        sessionId: SESSION_ID,
        layer: 'user',
        userId: USER_ID,
        payload: {
          messageId: data.messageId,
          toSessionId: SESSION_ID,
          messageType: 'user_input',
          fromRoleLayer: 'user',
          reused: false,
          textPreview: '帮我实现 OAuth 登录',
        },
      });
      expect(events[0]?.payload).not.toHaveProperty('payload');
      expect(countRows('session_inbound_messages')).toBe(1);
      expect(countRows('message_v2')).toBe(1);

      const inbound = dbModule.sqliteGet<{
        client_idempotency_key: string | null;
        from_role_layer: string;
        message_type: string;
        payload_json: string;
        to_session_id: string;
      }>(`SELECT * FROM session_inbound_messages WHERE id = ? LIMIT 1`, [data.messageId]);
      expect(inbound).toMatchObject({
        client_idempotency_key: 'route-user-input-1',
        from_role_layer: 'user',
        message_type: 'user_input',
        to_session_id: SESSION_ID,
      });
      expect(JSON.parse(inbound?.payload_json ?? '{}')).toEqual({ text: '帮我实现 OAuth 登录' });

      const persistedMessage = dbModule.sqliteGet<{ data: string }>(
        `SELECT data FROM message_v2 WHERE session_id = ? LIMIT 1`,
        [SESSION_ID],
      );
      expect(persistedMessage?.data).toContain('user');
      expect(orchestrateReceptionInputMock).toHaveBeenCalledWith({
        userId: USER_ID,
        receptionSessionId: SESSION_ID,
        userIntent: '帮我实现 OAuth 登录',
        teamWorkspaceId: TEAM_WORKSPACE_ID,
        streamClientRequestId: 'route-user-input-1',
        persistUserMessage: false,
      });
    } finally {
      unsubscribe();
      await app.close();
    }
  });

  it('未传 clientIdempotencyKey 时生成内部 clientRequestId 并传给编排', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: {
          messageType: 'user_input',
          payload: { text: '没有显式幂等键' },
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json() as { messageId: string };
      const inbound = dbModule.sqliteGet<{ client_idempotency_key: string | null }>(
        `SELECT client_idempotency_key FROM session_inbound_messages WHERE id = ? LIMIT 1`,
        [data.messageId],
      );
      const generatedKey = inbound?.client_idempotency_key ?? '';
      expect(generatedKey).toMatch(/^team-inbound:user_input:/);
      expect(generatedKey.length).toBeLessThanOrEqual(128);
      expect(orchestrateReceptionInputMock).toHaveBeenCalledWith(
        expect.objectContaining({
          persistUserMessage: false,
          receptionSessionId: SESSION_ID,
          streamClientRequestId: generatedKey,
          userId: USER_ID,
          userIntent: '没有显式幂等键',
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('长 clientIdempotencyKey 原样用于入站幂等，stream 使用规范化 clientRequestId', async () => {
    const app = await buildApp();
    const longKey = 'x'.repeat(200);
    const expectedStreamKey = `team-client:${createHash('sha256')
      .update(longKey)
      .digest('hex')
      .slice(0, 48)}`;
    try {
      const first = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: {
          messageType: 'user_input',
          payload: { text: '长幂等键输入' },
          clientIdempotencyKey: longKey,
        },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: {
          messageType: 'user_input',
          payload: { text: '重复长幂等键输入' },
          clientIdempotencyKey: longKey,
        },
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect((second.json() as { messageId: string }).messageId).toBe(
        (first.json() as { messageId: string }).messageId,
      );
      const inbound = dbModule.sqliteGet<{ client_idempotency_key: string | null }>(
        `SELECT client_idempotency_key FROM session_inbound_messages LIMIT 1`,
      );
      expect(inbound?.client_idempotency_key).toBe(longKey);
      const persistedMessage = dbModule.sqliteGet<{ data: string }>(
        `SELECT data FROM message_v2 WHERE session_id = ? LIMIT 1`,
        [SESSION_ID],
      );
      expect(persistedMessage?.data).toContain(expectedStreamKey);
      expect(orchestrateReceptionInputMock).toHaveBeenCalledTimes(1);
      expect(orchestrateReceptionInputMock).toHaveBeenCalledWith(
        expect.objectContaining({
          persistUserMessage: false,
          receptionSessionId: SESSION_ID,
          streamClientRequestId: expectedStreamKey,
          userId: USER_ID,
          userIntent: '长幂等键输入',
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('幂等重放返回 200 且不重复写入', async () => {
    const app = await buildApp();
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => {
      events.push(event);
    });
    try {
      const first = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: {
          messageType: 'user_input',
          payload: { text: '第一次' },
          clientIdempotencyKey: 'route-replay-1',
        },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: {
          messageType: 'user_input',
          payload: { text: '第二次' },
          clientIdempotencyKey: 'route-replay-1',
        },
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('session.inbound.submitted');
      expect((second.json() as { messageId: string }).messageId).toBe(
        (first.json() as { messageId: string }).messageId,
      );
      expect(countRows('session_inbound_messages')).toBe(1);
      expect(countRows('message_v2')).toBe(1);
      expect(orchestrateReceptionInputMock).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      await app.close();
    }
  });

  it('非法 messageType 返回 400', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: { messageType: 'not_allowed', payload: { text: 'hello' } },
      });

      expect(res.statusCode).toBe(400);
      expect(countRows('session_inbound_messages')).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('escape hatch 新消息写入 audit log', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: { messageType: 'cancel_signal', payload: { reason: 'stop' } },
      });

      expect(res.statusCode).toBe(201);
      const inbound = dbModule.sqliteGet<{ client_idempotency_key: string | null }>(
        `SELECT client_idempotency_key FROM session_inbound_messages LIMIT 1`,
        [],
      );
      expect(inbound?.client_idempotency_key).toBeNull();
      const audit = dbModule.sqliteGet<{
        action: string;
        entity_type: string;
        summary: string;
        session_id: string | null;
      }>(`SELECT action, entity_type, summary, session_id FROM team_audit_logs LIMIT 1`, []);
      expect(audit).toMatchObject({
        action: 'escape_hatch_used',
        entity_type: 'session_inbound_message',
        session_id: SESSION_ID,
      });
      expect(audit?.summary).toContain('cancel_signal');
    } finally {
      await app.close();
    }
  });

  it('clarification_answer 会回写 needs_clarification 的持久化状态', async () => {
    const PM1_SESSION_ID = 's-team-inbound-pm1';
    seedPm1Session(PM1_SESSION_ID, USER_ID);
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
        (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state)
       VALUES ('clarify-escalation', ?, ?, 'pm1', 'escalation_request', ?, 'pending')`,
      [
        USER_ID,
        SESSION_ID,
        JSON.stringify({
          fromLayer: 'pm1',
          fromSessionId: PM1_SESSION_ID,
          reason: 'needs_clarification',
          escalationRound: 0,
          context: '需要确认认证方式',
          suggestedActions: [{ label: '回答', action: 'answer' }],
          questions: [{ id: 'clarify-q-1', question: '认证方式？', context: '登录模块' }],
        }),
      ],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${PM1_SESSION_ID}/inbound-messages`,
        headers: { authorization: bearer(app) },
        payload: {
          messageType: 'clarification_answer',
          payload: {
            questionId: 'clarify-q-1',
            answer: 'OAuth',
            answeredBy: 'user',
            answeredAt: 1700000000000,
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const escalation = dbModule.sqliteGet<{ payload_json: string; state: string }>(
        `SELECT payload_json, state FROM session_inbound_messages WHERE id = 'clarify-escalation' LIMIT 1`,
        [],
      );
      expect(escalation?.state).toBe('consumed');
      expect(JSON.parse(escalation?.payload_json ?? '{}').questions[0]).toMatchObject({
        id: 'clarify-q-1',
        answer: 'OAuth',
        answeredAt: 1700000000000,
        status: 'answered',
      });
    } finally {
      await app.close();
    }
  });

  it('dismiss clarification 路由会持久化 skipped 状态', async () => {
    const PM1_SESSION_ID = 's-team-inbound-pm1-dismiss';
    seedPm1Session(PM1_SESSION_ID, USER_ID);
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
        (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state)
       VALUES ('clarify-dismiss', ?, ?, 'pm1', 'escalation_request', ?, 'pending')`,
      [
        USER_ID,
        SESSION_ID,
        JSON.stringify({
          fromLayer: 'pm1',
          fromSessionId: PM1_SESSION_ID,
          reason: 'needs_clarification',
          escalationRound: 0,
          context: '需要确认部署方式',
          suggestedActions: [{ label: '回答', action: 'answer' }],
          questions: [{ id: 'clarify-q-dismiss', question: '部署方式？', context: '运维模块' }],
        }),
      ],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${PM1_SESSION_ID}/clarifications/clarify-q-dismiss/dismiss`,
        headers: { authorization: bearer(app) },
        payload: { answeredAt: 1700000001111 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });

      const escalation = dbModule.sqliteGet<{ payload_json: string; state: string }>(
        `SELECT payload_json, state FROM session_inbound_messages WHERE id = 'clarify-dismiss' LIMIT 1`,
        [],
      );
      expect(escalation?.state).toBe('consumed');
      expect(JSON.parse(escalation?.payload_json ?? '{}').questions[0]).toMatchObject({
        id: 'clarify-q-dismiss',
        answeredAt: 1700000001111,
        status: 'dismissed',
      });
    } finally {
      await app.close();
    }
  });

  it('dismiss clarification 在问题不存在时返回结构化 404', async () => {
    const PM1_SESSION_ID = 's-team-inbound-dismiss-missing';
    seedPm1Session(PM1_SESSION_ID, USER_ID);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${PM1_SESSION_ID}/clarifications/missing-question/dismiss`,
        headers: { authorization: bearer(app) },
        payload: { answeredAt: 1700000002222 },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        code: 'team_clarification_not_found',
        error: '目标澄清问题不存在。',
      });
    } finally {
      await app.close();
    }
  });
});
