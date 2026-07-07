import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as ZodModule from 'zod';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';

const mocks = vi.hoisted(() => ({
  requestWorkflowLlmCompletion: vi.fn(),
  resolveAuxiliaryLlmConfig: vi.fn(),
  resolveAuxiliaryLlmConfigCandidates: vi.fn(),
  listMcpToolsForUser: vi.fn(),
  retryMcpConnectionForUser: vi.fn(),
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  isMcpServerConnectedForUser: vi.fn(() => false),
  listMcpToolsForUser: mocks.listMcpToolsForUser,
  loadConfiguredMcpServersForUser: vi.fn(() => []),
  retryMcpConnectionForUser: mocks.retryMcpConnectionForUser,
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: mocks.resolveAuxiliaryLlmConfig,
  resolveAuxiliaryLlmConfigCandidates: mocks.resolveAuxiliaryLlmConfigCandidates,
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: mocks.requestWorkflowLlmCompletion,
}));

vi.mock('../../workspace/companion-settings.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof ZodModule;
  return {
    buildCompanionFeatureState: vi.fn(() => ({ enabled: false })),
    buildCompanionIntroText: vi.fn(() => '温和、简洁地陪伴用户。'),
    buildCompanionWorkspaceContextText: vi.fn(() => ''),
    companionSettingsUpdateSchema: z.object({}).passthrough(),
    getCompanionSettingsKey: vi.fn(() => 'companion'),
    loadCompanionSettingsForUser: vi.fn(() => ({
      profile: {
        name: 'Buddy',
        species: 'fox',
        archetype: 'steady',
        note: '保持低打扰。',
        traits: ['冷静', '简洁'],
      },
    })),
    resolveCompanionProfileForAgent: vi.fn(() => null),
  };
});

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'settings-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-settings-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'settings@example.com' })}`;
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
  settingsRoutes = (await import('../../routes/settings.js')).settingsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  mocks.resolveAuxiliaryLlmConfig.mockReset();
  mocks.resolveAuxiliaryLlmConfigCandidates.mockReset();
  mocks.listMcpToolsForUser.mockReset();
  mocks.requestWorkflowLlmCompletion.mockReset();
  mocks.retryMcpConnectionForUser.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('settings routes error contracts', () => {
  it('PUT /settings/plugins 保存 desktopControl 并由 GET 返回', async () => {
    const app = await buildApp();
    try {
      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/plugins',
        headers: { authorization: bearer(app) },
        payload: {
          imageGeneration: { enabled: false, modelSource: 'global' },
          desktopControl: { enabled: true },
        },
      });

      expect(putResponse.statusCode).toBe(200);
      expect(putResponse.json()).toEqual({
        imageGeneration: { enabled: false, modelSource: 'global' },
        desktopControl: { enabled: true },
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: '/settings/plugins',
        headers: { authorization: bearer(app) },
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toEqual({
        imageGeneration: { enabled: false, modelSource: 'global' },
        desktopControl: { enabled: true },
      });
    } finally {
      await app.close();
    }
  });

  it('GET /settings/mcp-status?includeTools=true 返回工具明细与禁用工具', async () => {
    mocks.listMcpToolsForUser.mockResolvedValue([
      {
        serverId: 'websearch',
        serverName: 'websearch',
        transport: 'sse',
        enabled: true,
        status: 'connected',
        tools: [
          {
            name: 'web_search_exa',
            description: 'Search with Exa',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    ]);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/mcp-status?includeTools=true',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        servers: [
          {
            id: 'websearch',
            builtin: true,
            status: 'connected',
            toolCount: 1,
            tools: [{ name: 'web_search_exa' }],
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/mcp-servers 校验并归一化高级 MCP 字段', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/mcp-servers',
        headers: { authorization: bearer(app) },
        payload: {
          servers: [
            {
              id: 'websearch',
              name: 'websearch',
              transport: 'sse',
              enabled: false,
              disabledTools: ['web_search_exa', 'web_search_exa'],
              headers: { 'x-api-key': 'secret' },
              oauth: false,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        servers: [
          {
            id: 'websearch',
            enabled: false,
            disabledTools: ['web_search_exa'],
            headers: { 'x-api-key': 'secret' },
            oauth: false,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('POST /settings/mcp-servers/:id/retry 在缺少 serverId 时返回中文 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/mcp-servers/%20/retry',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '缺少 MCP 服务标识。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /settings/mcp-servers/:id/retry 对不存在服务返回中文 404', async () => {
    mocks.retryMcpConnectionForUser.mockRejectedValue(new Error('server missing'));
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/mcp-servers/missing/retry',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标 MCP 服务不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /settings/companion/chat 在未配置 LLM 时返回中文 503', async () => {
    mocks.resolveAuxiliaryLlmConfig.mockResolvedValue(null);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/companion/chat',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          message: '你好',
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: 'Companion 陪跑聊天模型尚未配置。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /settings/companion/chat 在 LLM 调用失败时返回中文 500', async () => {
    mocks.resolveAuxiliaryLlmConfig.mockResolvedValue({
      apiBaseUrl: 'https://example.invalid',
      apiKey: 'key',
      model: 'gpt-test',
    });
    mocks.requestWorkflowLlmCompletion.mockRejectedValue(new Error('upstream failed'));
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/companion/chat',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          message: '给我一句提醒',
          context: {
            sessionBusy: true,
          },
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: 'Companion 陪跑聊天失败。',
      });
    } finally {
      await app.close();
    }
  });
});
