import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as AgentsRoutesModule from '../../routes/agents.js';
import type * as ModelRouterModule from '../../provider/model-router.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'agents-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let agentsRoutes: typeof AgentsRoutesModule.agentsRoutes;
let modelRouterModule: typeof ModelRouterModule;

const USER_ID = 'u-agents-routes';

interface ManagedAgentFixture {
  readonly id: string;
  readonly origin: string;
  readonly removable: boolean;
  readonly label: string;
  readonly description: string;
  readonly systemPrompt?: string;
  readonly promptMetadata?: {
    readonly defaultText?: string;
    readonly hasPromptOverride: boolean;
  };
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
  modelRouterModule = await import('../../provider/model-router.js');
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
      // 文案已随「内置 Agent 允许覆盖系统提示词」变更（label 等字段仍被禁止）。
      expect(response.json()).toMatchObject({
        error: '内置 Agent 仅允许修改模型配置与系统提示词。',
      });
    } finally {
      await app.close();
    }
  });

  it('PUT /agents/:agentId 允许内置 agent 覆盖并清除系统提示词', async () => {
    const app = await buildApp();
    const authorization = bearer(app);
    try {
      const withPrompt = await app.inject({
        method: 'PUT',
        url: '/agents/build',
        headers: { authorization, 'content-type': 'application/json' },
        payload: { systemPrompt: '用户自定义的构建提示词' },
      });
      expect(withPrompt.statusCode).toBe(200);
      const overridden = withPrompt.json<{ agent: ManagedAgentFixture }>().agent;
      expect(overridden.systemPrompt).toBe('用户自定义的构建提示词');
      expect(overridden.promptMetadata?.hasPromptOverride).toBe(true);

      // 重新拉取确认覆盖已持久化（防止「仅改提示词被判定为默认而删除」）。
      const listed = await app.inject({
        method: 'GET',
        url: '/agents',
        headers: { authorization },
      });
      const build = listed.json<AgentsListResponse>().agents.find((agent) => agent.id === 'build');
      expect(build?.systemPrompt).toBe('用户自定义的构建提示词');

      // 只改模型不得丢弃已有提示词覆盖。
      const modelOnly = await app.inject({
        method: 'PUT',
        url: '/agents/build',
        headers: { authorization, 'content-type': 'application/json' },
        payload: { model: 'gpt-5' },
      });
      expect(modelOnly.statusCode).toBe(200);
      expect(modelOnly.json<{ agent: ManagedAgentFixture }>().agent.systemPrompt).toBe(
        '用户自定义的构建提示词',
      );

      // `systemPrompt: null` → 清除覆盖、回落当前默认。
      const cleared = await app.inject({
        method: 'PUT',
        url: '/agents/build',
        headers: { authorization, 'content-type': 'application/json' },
        payload: { systemPrompt: null },
      });
      expect(cleared.statusCode).toBe(200);
      const clearedAgent = cleared.json<{ agent: ManagedAgentFixture }>().agent;
      expect(clearedAgent.promptMetadata?.hasPromptOverride).toBe(false);
      expect(clearedAgent.systemPrompt).not.toBe('用户自定义的构建提示词');
    } finally {
      await app.close();
    }
  });

  it('自定义 Agent 传 systemPrompt: null 保留现值（null 仅对内置 Agent 表示清除）', async () => {
    const app = await buildApp();
    const authorization = bearer(app);
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/agents',
        headers: { authorization, 'content-type': 'application/json' },
        payload: { id: 'custom-null-guard', label: '自定义守卫', systemPrompt: '原始提示词' },
      });
      expect(created.statusCode).toBe(201);

      const updated = await app.inject({
        method: 'PUT',
        url: '/agents/custom-null-guard',
        headers: { authorization, 'content-type': 'application/json' },
        payload: { systemPrompt: null },
      });

      expect(updated.statusCode).toBe(200);
      // 自定义 Agent 必须始终带提示词：`null` 视为「未提供」而非清空，
      // 否则 `normalizeBody` 会把它的提示词静默清掉。
      expect(updated.json<{ agent: ManagedAgentFixture }>().agent.systemPrompt).toBe('原始提示词');
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

  it('POST /agents 接受等于上限的 systemPrompt，拒绝超出一字符的', async () => {
    const app = await buildApp();
    try {
      const max = modelRouterModule.MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS;

      const atCap = await app.inject({
        method: 'POST',
        url: '/agents',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          id: 'at-cap-agent',
          label: 'At Cap Agent',
          systemPrompt: 'x'.repeat(max),
        },
      });
      expect(atCap.statusCode).toBe(201);

      const overCap = await app.inject({
        method: 'POST',
        url: '/agents',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          id: 'over-cap-agent',
          label: 'Over Cap Agent',
          systemPrompt: 'x'.repeat(max + 1),
        },
      });
      expect(overCap.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
