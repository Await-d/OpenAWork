/**
 * 260515-team-phase-b · T-03 路由测试
 *
 * 覆盖只读 handoff 端点 + cancel 端点。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamHandoffsModule from '../../routes/team-handoffs.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamHandoffsRoutes: typeof TeamHandoffsModule.teamHandoffsRoutes;
let store: typeof HandoffStoreModule;
let teamEventsBus: typeof TeamEventsBusModule;

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

function seedSession(
  sessionId: string,
  userId: string,
  input?: {
    paused?: boolean;
    pausedAt?: string | null;
    pausedByUserId?: string | null;
    pauseReason?: string | null;
    roleLayer?: string | null;
    teamParentSessionId?: string | null;
  },
): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (
       id, user_id, title, metadata_json, role_layer, team_parent_session_id,
       paused, paused_at, paused_by_user_id, pause_reason
     )
     VALUES (?, ?, 'demo', '{}', ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      userId,
      input?.roleLayer ?? null,
      input?.teamParentSessionId ?? null,
      input?.paused ? 1 : 0,
      input?.pausedAt ?? null,
      input?.pausedByUserId ?? null,
      input?.pauseReason ?? null,
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const team = await import('../../routes/team-handoffs.js');
  teamHandoffsRoutes = team.teamHandoffsRoutes;
  store = await import('../../handoff/store/handoff-store.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  dbModule.sqliteRun('DELETE FROM session_inbound_messages', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'rt@example.com');
  seedSession(FROM_SESSION_ID, USER_ID, { roleLayer: 'reception' });
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
      expect(res.json()).toMatchObject({
        code: 'team_parent_session_not_found',
        error: '目标团队父会话不存在。',
      });
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
      expect(res.json()).toMatchObject({
        code: 'team_handoff_source_session_not_found',
        error: '源团队会话不存在。',
      });
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
      expect(res.json()).toMatchObject({
        code: 'team_handoff_not_found',
        error: '目标 handoff 不存在。',
      });
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

  it('session 不存在时返回结构化 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/sessions/nope/handoffs',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        code: 'team_session_not_found',
        error: '目标团队会话不存在。',
      });
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
      expect(res.json()).toMatchObject({
        code: 'team_handoff_cannot_cancel',
        error: '当前状态不允许取消该 handoff。',
        state: 'completed',
      });
    } finally {
      await app.close();
    }
  });
});

describe('POST /team/handoffs/:handoffId/pause', () => {
  it('running handoff 可以 pause，并写入控制信号、事件和审计', async () => {
    const app = await buildApp();
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => {
      events.push(event);
    });
    try {
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'pm2',
        toRoleLayer: 'executor',
      });
      store.claimHandoff({ handoffId: created.id, claimToken: 'tok-pause' });
      store.startHandoff({
        handoffId: created.id,
        claimToken: 'tok-pause',
        toSessionId: TO_SESSION_ID,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/pause`,
        headers: { authorization: bearer(app) },
        payload: { reason: 'network-degraded' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ handoff: { id: created.id, paused: true } });

      const inbound = dbModule.sqliteGet<{ message_type: string; payload_json: string }>(
        `SELECT message_type, payload_json
           FROM session_inbound_messages
          WHERE to_session_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [TO_SESSION_ID],
      );
      expect(inbound?.message_type).toBe('pause_signal');
      expect(JSON.parse(inbound?.payload_json ?? '{}')).toMatchObject({
        action: 'pause',
        handoffId: created.id,
        reason: 'network-degraded',
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'scheduler.task-paused',
          taskId: created.id,
          sessionId: TO_SESSION_ID,
          userId: USER_ID,
        }),
      );

      const audit = dbModule.sqliteGet<{ action: string; entity_type: string; summary: string }>(
        `SELECT action, entity_type, summary
           FROM team_audit_logs
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [],
      );
      expect(audit).toMatchObject({
        action: 'handoff_control',
        entity_type: 'handoff',
      });
      expect(audit?.summary).toContain('handoff pause');
    } finally {
      unsubscribe();
      await app.close();
    }
  });

  it('已 pause 的 handoff 再次 pause 返回 409', async () => {
    const app = await buildApp();
    try {
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      expect(store.pauseHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/pause`,
        headers: { authorization: bearer(app) },
        payload: { reason: 'duplicate' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'team_handoff_cannot_pause',
        error: '当前状态不允许暂停该 handoff。',
        state: 'pending',
        paused: true,
      });
    } finally {
      await app.close();
    }
  });
});

describe('POST /team/handoffs/:handoffId/resume', () => {
  it('paused handoff 可以 resume，并写入恢复信号、事件和审计', async () => {
    const app = await buildApp();
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => {
      events.push(event);
    });
    try {
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'pm2',
        toRoleLayer: 'executor',
      });
      store.claimHandoff({ handoffId: created.id, claimToken: 'tok-resume' });
      store.startHandoff({
        handoffId: created.id,
        claimToken: 'tok-resume',
        toSessionId: TO_SESSION_ID,
      });
      expect(store.pauseHandoff({ userId: USER_ID, handoffId: created.id, reason: 'manual' })).toBe(
        true,
      );

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/resume`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ handoff: { id: created.id, paused: false } });

      const inbound = dbModule.sqliteGet<{ message_type: string; payload_json: string }>(
        `SELECT message_type, payload_json
           FROM session_inbound_messages
          WHERE to_session_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [TO_SESSION_ID],
      );
      expect(inbound?.message_type).toBe('resume_signal');
      expect(JSON.parse(inbound?.payload_json ?? '{}')).toMatchObject({
        action: 'resume',
        handoffId: created.id,
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'scheduler.task-resumed',
          taskId: created.id,
          sessionId: TO_SESSION_ID,
          userId: USER_ID,
        }),
      );

      const audit = dbModule.sqliteGet<{ action: string; entity_type: string; summary: string }>(
        `SELECT action, entity_type, summary
           FROM team_audit_logs
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [],
      );
      expect(audit).toMatchObject({
        action: 'handoff_control',
        entity_type: 'handoff',
      });
      expect(audit?.summary).toContain('handoff resume');
    } finally {
      unsubscribe();
      await app.close();
    }
  });

  it('未 pause 的 handoff 直接 resume 返回 409', async () => {
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
        url: `/team/handoffs/${created.id}/resume`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'team_handoff_cannot_resume',
        error: '当前状态不允许恢复该 handoff。',
        state: 'pending',
        paused: false,
      });
    } finally {
      await app.close();
    }
  });
});

describe('POST /team/handoffs/:handoffId/review-actions/:action', () => {
  it('非法 review action 返回 400', async () => {
    const app = await buildApp();
    try {
      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/review-actions/not-allowed`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('redispatch 会把 failed 的 pm2 handoff 退回 pending 并递增 retryCount', async () => {
    const app = await buildApp();
    try {
      const PM1_SESSION_ID = 's-review-pm1';
      seedSession(PM1_SESSION_ID, USER_ID, {
        roleLayer: 'pm1',
        teamParentSessionId: FROM_SESSION_ID,
      });
      const PM2_SESSION_ID = 's-review-pm2';
      seedSession(PM2_SESSION_ID, USER_ID, {
        roleLayer: 'pm2',
        teamParentSessionId: PM1_SESSION_ID,
      });

      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: PM1_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });
      store.claimHandoff({ handoffId: created.id, claimToken: 'tok-review-redispatch' });
      store.startHandoff({
        handoffId: created.id,
        claimToken: 'tok-review-redispatch',
        toSessionId: PM2_SESSION_ID,
      });
      dbModule.sqliteRun(
        `UPDATE handoff_records
            SET state = 'failed', failure_reason = '已重试 2 轮仍未通过，需要用户介入', retry_count = 2
          WHERE id = ?`,
        [created.id],
      );

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/review-actions/redispatch`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        action: 'redispatch',
        handoffId: created.id,
        handoffs: [
          expect.objectContaining({
            id: created.id,
            retryCount: 3,
            state: 'pending',
            toSessionId: null,
          }),
        ],
      });

      const after = store.getHandoff({ userId: USER_ID, handoffId: created.id });
      expect(after).toMatchObject({
        state: 'pending',
        failureReason: null,
        retryCount: 3,
        toSessionId: null,
      });
      expect(
        (after?.payload as Record<string, unknown>)['reviewDispositionHandledAt'],
      ).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('return-to-c 会基于原 reception→pm1 payload 创建一条新的 pm1 handoff', async () => {
    const app = await buildApp();
    try {
      const PM1_SESSION_ID = 's-review-pm1-return';
      seedSession(PM1_SESSION_ID, USER_ID, {
        roleLayer: 'pm1',
        teamParentSessionId: FROM_SESSION_ID,
      });
      const PM2_SESSION_ID = 's-review-pm2-return';
      seedSession(PM2_SESSION_ID, USER_ID, {
        roleLayer: 'pm2',
        teamParentSessionId: PM1_SESSION_ID,
      });

      const upstream = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        payload: {
          sourceIntent: '原始需求',
          rewrittenIntent: '改写需求',
          teamWorkspaceId: 'tw-demo',
        },
      });
      dbModule.sqliteRun(
        `UPDATE handoff_records
            SET to_session_id = ?, state = 'completed'
          WHERE id = ?`,
        [PM1_SESSION_ID, upstream.id],
      );

      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: PM1_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });
      store.claimHandoff({ handoffId: created.id, claimToken: 'tok-review-return' });
      store.startHandoff({
        handoffId: created.id,
        claimToken: 'tok-review-return',
        toSessionId: PM2_SESSION_ID,
      });
      dbModule.sqliteRun(
        `UPDATE handoff_records
            SET state = 'failed', failure_reason = 'Spec Review 未通过：遗漏验收场景'
          WHERE id = ?`,
        [created.id],
      );

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/review-actions/return-to-c`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json() as {
        createdHandoffId: string;
        handoffs: Array<{ id: string; toRoleLayer: string; fromSessionId: string; state: string }>;
      };
      expect(typeof data.createdHandoffId).toBe('string');
      expect(data.handoffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.id,
            toRoleLayer: 'pm2',
            state: 'failed',
          }),
          expect.objectContaining({
            id: data.createdHandoffId,
            fromSessionId: FROM_SESSION_ID,
            toRoleLayer: 'pm1',
            state: 'pending',
          }),
        ]),
      );

      const replay = store.getHandoff({ userId: USER_ID, handoffId: data.createdHandoffId });
      expect(replay).toMatchObject({
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        state: 'pending',
      });
      expect(replay?.payload).toMatchObject({
        sourceIntent: '原始需求',
        rewrittenIntent: '改写需求',
        teamWorkspaceId: 'tw-demo',
      });

      const handledPm2 = store.getHandoff({ userId: USER_ID, handoffId: created.id });
      expect(handledPm2?.payload).toMatchObject({
        reviewDisposition: expect.objectContaining({
          action: 'return-to-c',
          status: 'handled',
        }),
        reviewDispositionHandledAction: 'return-to-c',
      });
    } finally {
      await app.close();
    }
  });

  it('escalate-to-user 会返回已标记 handled 的 pm2 handoff preview', async () => {
    const app = await buildApp();
    try {
      const PM1_SESSION_ID = 's-review-pm1-escalate';
      seedSession(PM1_SESSION_ID, USER_ID, {
        roleLayer: 'pm1',
        teamParentSessionId: FROM_SESSION_ID,
      });
      const PM2_SESSION_ID = 's-review-pm2-escalate';
      seedSession(PM2_SESSION_ID, USER_ID, {
        roleLayer: 'pm2',
        teamParentSessionId: PM1_SESSION_ID,
      });

      const created = store.createHandoff({
        userId: USER_ID,
        fromSessionId: PM1_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });
      store.claimHandoff({ handoffId: created.id, claimToken: 'tok-review-escalate' });
      store.startHandoff({
        handoffId: created.id,
        claimToken: 'tok-review-escalate',
        toSessionId: PM2_SESSION_ID,
      });
      dbModule.sqliteRun(
        `UPDATE handoff_records
            SET state = 'failed', failure_reason = '已重试 3 轮仍未通过，需要用户介入'
          WHERE id = ?`,
        [created.id],
      );

      const res = await app.inject({
        method: 'POST',
        url: `/team/handoffs/${created.id}/review-actions/escalate-to-user`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        action: 'escalate-to-user',
        handoffId: created.id,
        handoffs: [
          expect.objectContaining({
            id: created.id,
            state: 'failed',
            toSessionId: PM2_SESSION_ID,
          }),
        ],
      });

      const handledPm2 = store.getHandoff({ userId: USER_ID, handoffId: created.id });
      expect(handledPm2?.payload).toMatchObject({
        reviewDisposition: expect.objectContaining({
          action: 'escalate-to-user',
          status: 'handled',
        }),
        reviewDispositionHandledAction: 'escalate-to-user',
      });
    } finally {
      await app.close();
    }
  });
});

describe('POST /team/sessions/:sessionId/pause-all', () => {
  it('会暂停子树 handoff，写入子 session 暂停元数据并发出汇总事件', async () => {
    const app = await buildApp();
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => {
      events.push(event);
    });
    try {
      const PM1_SESSION_ID = 's-pm1-rt';
      seedSession(PM1_SESSION_ID, USER_ID, {
        roleLayer: 'pm1',
        teamParentSessionId: FROM_SESSION_ID,
      });

      const handoffRunning = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      store.claimHandoff({ handoffId: handoffRunning.id, claimToken: 'tok-bulk-pause-running' });
      store.startHandoff({
        handoffId: handoffRunning.id,
        claimToken: 'tok-bulk-pause-running',
        toSessionId: PM1_SESSION_ID,
      });

      const handoffPending = store.createHandoff({
        userId: USER_ID,
        fromSessionId: PM1_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${FROM_SESSION_ID}/pause-all`,
        headers: { authorization: bearer(app) },
        payload: { reason: 'network-degraded' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        pausedHandoffCount: 2,
        pausedSessionCount: 1,
        sessionId: FROM_SESSION_ID,
      });

      const rootRow = dbModule.sqliteGet<{ paused: number; paused_at: string | null }>(
        `SELECT paused, paused_at FROM sessions WHERE id = ?`,
        [FROM_SESSION_ID],
      );
      const childRow = dbModule.sqliteGet<{
        paused: number;
        paused_at: string | null;
        paused_by_user_id: string | null;
        pause_reason: string | null;
      }>(
        `SELECT paused, paused_at, paused_by_user_id, pause_reason
           FROM sessions
          WHERE id = ?`,
        [PM1_SESSION_ID],
      );
      expect(rootRow).toMatchObject({
        paused: 0,
        paused_at: null,
      });
      expect(childRow).toMatchObject({
        paused: 1,
        paused_by_user_id: USER_ID,
        pause_reason: 'network-degraded',
      });
      expect(typeof childRow?.paused_at).toBe('string');

      const pausedHandoffs = dbModule.sqliteAll<{ id: string; paused: number }>(
        `SELECT id, paused
           FROM handoff_records
          WHERE id IN (?, ?)
          ORDER BY id ASC`,
        [handoffPending.id, handoffRunning.id],
      );
      expect(pausedHandoffs).toEqual(
        expect.arrayContaining([
          { id: handoffPending.id, paused: 1 },
          { id: handoffRunning.id, paused: 1 },
        ]),
      );

      const inbound = dbModule.sqliteGet<{ message_type: string; payload_json: string }>(
        `SELECT message_type, payload_json
           FROM session_inbound_messages
          WHERE to_session_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [PM1_SESSION_ID],
      );
      expect(inbound?.message_type).toBe('pause_signal');
      expect(JSON.parse(inbound?.payload_json ?? '{}')).toMatchObject({
        action: 'pause',
        handoffId: handoffRunning.id,
        reason: 'network-degraded',
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'scheduler.all-paused',
          sessionId: FROM_SESSION_ID,
          userId: USER_ID,
        }),
      );

      const audit = dbModule.sqliteGet<{ action: string; entity_type: string; summary: string }>(
        `SELECT action, entity_type, summary
           FROM team_audit_logs
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [],
      );
      expect(audit).toMatchObject({
        action: 'handoff_control',
        entity_type: 'session',
      });
      expect(audit?.summary).toContain('team pause-all');
    } finally {
      unsubscribe();
      await app.close();
    }
  });
});

describe('POST /team/sessions/:sessionId/resume-all', () => {
  it('会恢复子树 handoff，清除暂停元数据并返回 staleSessionCount', async () => {
    const app = await buildApp();
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => {
      events.push(event);
    });
    try {
      const PM1_SESSION_ID = 's-pm1-resume-rt';
      seedSession(PM1_SESSION_ID, USER_ID, {
        roleLayer: 'pm1',
        teamParentSessionId: FROM_SESSION_ID,
        paused: true,
        pausedAt: '2000-01-01 00:00:00',
        pausedByUserId: USER_ID,
        pauseReason: 'network-degraded',
      });

      const handoffRunning = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      store.claimHandoff({ handoffId: handoffRunning.id, claimToken: 'tok-bulk-resume-running' });
      store.startHandoff({
        handoffId: handoffRunning.id,
        claimToken: 'tok-bulk-resume-running',
        toSessionId: PM1_SESSION_ID,
      });
      expect(
        store.pauseHandoff({
          userId: USER_ID,
          handoffId: handoffRunning.id,
          reason: 'network-degraded',
        }),
      ).toBe(true);

      const handoffPending = store.createHandoff({
        userId: USER_ID,
        fromSessionId: PM1_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });
      expect(
        store.pauseHandoff({
          userId: USER_ID,
          handoffId: handoffPending.id,
          reason: 'network-degraded',
        }),
      ).toBe(true);

      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${FROM_SESSION_ID}/resume-all`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        resumedHandoffCount: 2,
        resumedSessionCount: 1,
        sessionId: FROM_SESSION_ID,
        staleSessionCount: 1,
      });

      const childRow = dbModule.sqliteGet<{
        paused: number;
        paused_at: string | null;
        paused_by_user_id: string | null;
        pause_reason: string | null;
      }>(
        `SELECT paused, paused_at, paused_by_user_id, pause_reason
           FROM sessions
          WHERE id = ?`,
        [PM1_SESSION_ID],
      );
      expect(childRow).toMatchObject({
        paused: 0,
        paused_at: null,
        paused_by_user_id: null,
        pause_reason: null,
      });

      const resumedHandoffs = dbModule.sqliteAll<{ id: string; paused: number }>(
        `SELECT id, paused
           FROM handoff_records
          WHERE id IN (?, ?)
          ORDER BY id ASC`,
        [handoffPending.id, handoffRunning.id],
      );
      expect(resumedHandoffs).toEqual(
        expect.arrayContaining([
          { id: handoffPending.id, paused: 0 },
          { id: handoffRunning.id, paused: 0 },
        ]),
      );

      const inbound = dbModule.sqliteGet<{ message_type: string; payload_json: string }>(
        `SELECT message_type, payload_json
           FROM session_inbound_messages
          WHERE to_session_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [PM1_SESSION_ID],
      );
      expect(inbound?.message_type).toBe('resume_signal');
      expect(JSON.parse(inbound?.payload_json ?? '{}')).toMatchObject({
        action: 'resume',
        handoffId: handoffRunning.id,
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'scheduler.all-resumed',
          sessionId: FROM_SESSION_ID,
          userId: USER_ID,
        }),
      );

      const audit = dbModule.sqliteGet<{ action: string; entity_type: string; summary: string }>(
        `SELECT action, entity_type, summary
           FROM team_audit_logs
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [],
      );
      expect(audit).toMatchObject({
        action: 'handoff_control',
        entity_type: 'session',
      });
      expect(audit?.summary).toContain('team resume-all');
    } finally {
      unsubscribe();
      await app.close();
    }
  });
});
