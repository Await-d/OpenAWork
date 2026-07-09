import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as AgentsRoutesModule from '../../routes/agents.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'agents-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let agentsRoutes: typeof AgentsRoutesModule.agentsRoutes;

const USER_ID = 'u-agents-routes';

interface ManagedAgentFixture {
  readonly id: string;
  readonly origin: string;
  readonly removable: boolean;
  readonly label: string;
  readonly description: string;
  readonly systemPrompt?: string;
  readonly note?: string;
}

interface AgentsListResponse {
  readonly agents: readonly ManagedAgentFixture[];
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(agentsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'agents@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  agentsRoutes = (await import('../../routes/agents.js')).agentsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('agents routes error contracts', () => {
  it('GET /agents 暴露安全内置 resource agents，并排除 reference-only cron agent', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/agents',
        headers: {
          authorization: bearer(app),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<AgentsListResponse>();
      const resourceCodeReviewer = body.agents.find(
        (agent) => agent.id === 'resource-code-reviewer',
      );
      const resourceApiDesigner = body.agents.find((agent) => agent.id === 'resource-api-designer');

      expect(resourceCodeReviewer).toMatchObject({
        id: 'resource-code-reviewer',
        origin: 'builtin',
        removable: false,
        label: 'code-reviewer',
      });
      expect(resourceCodeReviewer?.description).toContain('code reviews');
      expect(resourceCodeReviewer?.systemPrompt).toContain('Code Review Checklist');
      expect(resourceCodeReviewer?.note).toContain('参考资源 agent:');
      expect(resourceApiDesigner).toMatchObject({
        id: 'resource-api-designer',
        origin: 'builtin',
        removable: false,
      });
      expect(body.agents.some((agent) => agent.id === 'resource-cron-agent')).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('PUT /agents/:agentId 在空更新体时返回中文 issue', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/agents/build',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: {
          message: '请求体参数无效。',
          kind: 'Body',
          issues: [
            expect.objectContaining({
              message: '至少需要提供一个可更新字段。',
            }),
          ],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /agents 对重复 agentId 返回中文 409', async () => {
    const app = await buildApp();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/agents',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          id: 'custom-reviewer',
          label: '自定义 Reviewer',
          systemPrompt: 'review code carefully',
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/agents',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          id: 'custom-reviewer',
          label: '重复 Reviewer',
          systemPrompt: 'review again',
        },
      });

      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        error: '目标 Agent 已存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('PUT /agents/:agentId 对内置 agent 的非法字段更新返回中文 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/agents/build',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          label: '不能改',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '内置 Agent 仅允许修改模型配置。',
      });
    } finally {
      await app.close();
    }
  });

  it('DELETE /agents/:agentId 对内置 agent 返回中文 409', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/agents/build',
        headers: {
          authorization: bearer(app),
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: '内置 Agent 不允许删除。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /agents/:agentId/reset 对不存在 agent 返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/agents/missing-agent/reset',
        headers: {
          authorization: bearer(app),
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标 Agent 不存在。',
      });
    } finally {
      await app.close();
    }
  });
});
