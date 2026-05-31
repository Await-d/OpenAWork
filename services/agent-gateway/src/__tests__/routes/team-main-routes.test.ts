import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamRoutesModule from '../../routes/team.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
}));

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamRoutes: typeof TeamRoutesModule.teamRoutes;

const USER_ID = 'u-team-main-route';
const TEAM_WORKSPACE_ID = 'tw-team-main-route';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamRoutes);
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

function seedWorkspace(teamWorkspaceId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO team_workspaces (
      id, user_id, name, description, visibility, default_working_root, default_team_roster_json
    ) VALUES (?, ?, '团队工作区', NULL, 'private', NULL, '[]')`,
    [teamWorkspaceId, userId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  teamRoutes = (await import('../../routes/team.js')).teamRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM team_runtime_alert_controls', []);
  dbModule.sqliteRun('DELETE FROM workflow_templates', []);
  dbModule.sqliteRun('DELETE FROM team_workspaces', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team main routes error contracts', () => {
  it('GET /team/workspaces/:teamWorkspaceId 对不存在工作区返回结构化 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/team/workspaces/missing-workspace',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_workspace_not_found',
        error: '目标团队工作区不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/workspaces/:id/sessions 对不存在模板返回结构化 404', async () => {
    seedWorkspace(TEAM_WORKSPACE_ID, USER_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/sessions`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          source: {
            kind: 'saved-template',
            templateId: 'missing-template',
          },
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_template_not_found',
        error: '目标模板不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/workspaces/:id/sessions 在 source.kind 非 blank 且缺少 templateId 时返回中文 issue', async () => {
    seedWorkspace(TEAM_WORKSPACE_ID, USER_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/sessions`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          source: {
            kind: 'saved-template',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: {
          message: '请求体参数无效。',
          kind: 'Body',
          issues: [
            expect.objectContaining({
              message: '当 source.kind 不是 blank 时，必须提供 templateId。',
            }),
          ],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/workspaces/:id/sessions 对非法 optional agent 返回结构化 400', async () => {
    seedWorkspace(TEAM_WORKSPACE_ID, USER_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/sessions`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          optionalAgentIds: ['missing-agent'],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'team_optional_agent_not_found',
        error: '可选团队代理不存在或未启用。',
        agentId: 'missing-agent',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/workspaces/:id/threads 对不存在父会话返回结构化 404', async () => {
    seedWorkspace(TEAM_WORKSPACE_ID, USER_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/threads`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            parentSessionId: 'missing-parent-session',
          },
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_parent_session_not_found',
        error: '父会话不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/workspaces/:id/imports 对超大导入返回结构化 413', async () => {
    seedWorkspace(TEAM_WORKSPACE_ID, USER_ID);
    const oversizedMessages = Array.from({ length: 501 }, (_value, index) => ({
      role: 'user',
      content: [{ type: 'text', text: `message-${index}` }],
    }));

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/imports`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          messages: oversizedMessages,
        },
      });

      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({
        code: 'team_import_payload_too_large',
        error: '导入内容超出允许范围。',
      });
      expect((response.json() as { detail?: string }).detail).toContain('导入消息数量超过上限');
    } finally {
      await app.close();
    }
  });

  it('POST /team/runtime/alerts/:alertCode/remediate 对无自动修复告警返回结构化 409', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/pending-decisions/remediate',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'team_runtime_alert_no_remediation',
        error: '该告警不支持自动修复。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/runtime/alerts/:alertCode/acknowledge 对未激活告警返回结构化 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/stale-runtime-threads/acknowledge',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_runtime_alert_not_active',
        error: '目标告警当前未激活。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/runtime/alerts/:alertCode/clear 对不存在控制记录返回结构化 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/runtime/alerts/stale-runtime-threads/clear',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_runtime_alert_control_not_found',
        error: '目标告警控制记录不存在。',
      });
    } finally {
      await app.close();
    }
  });
});
