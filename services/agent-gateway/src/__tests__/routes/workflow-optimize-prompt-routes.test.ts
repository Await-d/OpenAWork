import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as WorkflowRoutesModule from '../../routes/workflows.js';

const mocks = vi.hoisted(() => ({
  requestWorkflowLlmCompletion: vi.fn(),
  resolveAuxiliaryLlmConfig: vi.fn(),
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: mocks.requestWorkflowLlmCompletion,
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: mocks.resolveAuxiliaryLlmConfig,
}));

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'workflow-optimize-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let workflowRoutes: typeof WorkflowRoutesModule.workflowRoutes;

const USER_ID = 'u-workflow-optimize-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(workflowRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
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
  workflowRoutes = (await import('../../routes/workflows.js')).workflowRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  mocks.resolveAuxiliaryLlmConfig.mockReset();
  mocks.requestWorkflowLlmCompletion.mockReset();
  mocks.resolveAuxiliaryLlmConfig.mockResolvedValue({
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5-mini',
    providerType: 'openai',
    upstreamProtocol: 'responses',
  });
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('workflow optimize prompt route', () => {
  it('上游错误时返回脱敏后的稳定中文提示', async () => {
    mocks.requestWorkflowLlmCompletion.mockRejectedValueOnce(
      new Error('AI_APICallError: 401 https://secret.example.com/token'),
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/workflows/optimize-prompt',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          originalPrompt: '优化这个提示词',
        },
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({
        code: 'upstream_unavailable',
        error: '优化提示词失败：上游模型暂时不可用，请稍后重试。',
        retryable: true,
      });
    } finally {
      await app.close();
    }
  });

  it('模型返回无效结果时返回稳定格式错误提示', async () => {
    mocks.requestWorkflowLlmCompletion.mockResolvedValueOnce('not-json-response');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/workflows/optimize-prompt',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          originalPrompt: '优化这个提示词',
        },
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({
        code: 'invalid_response',
        error: '优化提示词失败：模型返回结果格式无效，请重试。',
        retryable: false,
      });
    } finally {
      await app.close();
    }
  });
});
