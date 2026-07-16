import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AgentCoreModule from '@openAwork/agent-core';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as StreamRoutesPluginModule from '../../routes/stream-routes-plugin.js';
import type * as StreamRoutesModule from '../../routes/stream.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'stream-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const providerCatalogMocks = vi.hoisted(() => ({
  getChatProvider: vi.fn(),
  getFastProvider: vi.fn(),
  getProviderForSelection: vi.fn(),
}));

vi.mock('../../provider/provider-catalog.js', () => providerCatalogMocks);

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let streamRequestSchema: typeof StreamRoutesModule.streamRequestSchema;
let streamRoutes: typeof StreamRoutesPluginModule.streamRoutes;
let STREAM_ERROR_MESSAGES: typeof StreamRoutesModule.STREAM_ERROR_MESSAGES;
let STREAM_PLUGIN_ERROR_MESSAGES: typeof StreamRoutesPluginModule.STREAM_PLUGIN_ERROR_MESSAGES;
let createStreamErrorChunk: typeof StreamRoutesModule.createStreamErrorChunk;
let createStreamUpstreamRouteChunk: typeof StreamRoutesModule.createStreamUpstreamRouteChunk;
let resolveStreamModelRoute: typeof StreamRoutesModule.resolveStreamModelRoute;

const SESSION_ID = 'sess-stream-routes';
const USER_ID = 'u-stream-routes';
const STREAM_ERROR_CONTRACTS_COLD_IMPORT_HOOK_TIMEOUT_MS = 30_000;

const chatProvider = {
  id: 'openai-chat',
  type: 'openai',
  name: 'OpenAI Chat',
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  defaultModels: [{ id: 'gpt-4o', label: 'GPT-4o', enabled: true }],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
} satisfies AgentCoreModule.AIProvider;

const fastProvider = {
  id: 'openai-fast',
  type: 'openai',
  name: 'OpenAI Fast',
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  upstreamProtocol: 'responses',
  defaultModels: [{ id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', enabled: true }],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
} satisfies AgentCoreModule.AIProvider;

const anthropicProvider = {
  id: 'anthropic-chat',
  type: 'anthropic',
  name: 'Anthropic Chat',
  enabled: true,
  baseUrl: 'https://api.anthropic.com/v1',
  defaultModels: [{ id: 'claude-opus-4-0', label: 'Claude Opus 4', enabled: true }],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
} satisfies AgentCoreModule.AIProvider;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(authPlugin);
  await app.register(streamRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return app.jwt.sign({ sub: USER_ID, email: 'stream@example.com' });
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'stream session', '{}', 'idle')`,
    [sessionId, USER_ID],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  const streamModule = await import('../../routes/stream.js');
  streamRequestSchema = streamModule.streamRequestSchema;
  STREAM_ERROR_MESSAGES = streamModule.STREAM_ERROR_MESSAGES;
  createStreamErrorChunk = streamModule.createStreamErrorChunk;
  createStreamUpstreamRouteChunk = streamModule.createStreamUpstreamRouteChunk;
  resolveStreamModelRoute = streamModule.resolveStreamModelRoute;
  const pluginModule = await import('../../routes/stream-routes-plugin.js');
  streamRoutes = pluginModule.streamRoutes;
  STREAM_PLUGIN_ERROR_MESSAGES = pluginModule.STREAM_PLUGIN_ERROR_MESSAGES;
}, STREAM_ERROR_CONTRACTS_COLD_IMPORT_HOOK_TIMEOUT_MS);

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  providerCatalogMocks.getChatProvider.mockReset();
  providerCatalogMocks.getFastProvider.mockReset();
  providerCatalogMocks.getProviderForSelection.mockReset();
  seedUser(USER_ID);
  seedSession(SESSION_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('stream error contracts', () => {
  it('streamRequestSchema 对缺少来源的 input_image 返回中文 issue', () => {
    const result = streamRequestSchema.safeParse({
      clientRequestId: 'req-1',
      inputParts: [{ type: 'input_image' }],
      message: 'hello',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: STREAM_ERROR_MESSAGES.inputImageMissingSource,
        }),
      ]),
    );
  });

  it('createStreamErrorChunk 保留中文 replay message', () => {
    const chunk = createStreamErrorChunk(
      'REQUEST_REPLAY_FAILED',
      STREAM_ERROR_MESSAGES.requestReplayFailed,
      'run-1',
    );

    expect(chunk).toMatchObject({
      type: 'error',
      code: 'REQUEST_REPLAY_FAILED',
      message: '请求重放失败。',
      runId: 'run-1',
    });
  });

  it('createStreamUpstreamRouteChunk 暴露真实上游模型与 provider', () => {
    const chunk = createStreamUpstreamRouteChunk(
      {
        model: 'gpt-5.4',
        providerId: 'openai-fast',
        providerType: 'openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: 'test',
        maxTokens: 2048,
        temperature: 1,
        upstreamProtocol: 'responses',
        requestOverrides: {},
        supportsThinking: false,
      },
      'run-route-1',
      { value: 1 },
      'req-route-1',
    );

    expect(chunk).toMatchObject({
      type: 'upstream_route',
      modelId: 'gpt-5.4',
      providerId: 'openai-fast',
      requestId: 'req-route-1',
      runId: 'run-route-1',
    });
  });

  it('导出 WS/SSE 运行中断中文错误常量', () => {
    expect(STREAM_PLUGIN_ERROR_MESSAGES.wsStreamError).toBe(
      'WebSocket 流式响应处理中断，请稍后重试。',
    );
    expect(STREAM_PLUGIN_ERROR_MESSAGES.sseStreamError).toBe('SSE 流式响应处理中断，请稍后重试。');
  });

  it('Team metadata 固定模型不可用时不 fallback 到 Chat 默认模型', async () => {
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce(null);

    await expect(
      resolveStreamModelRoute({
        metadataJson: JSON.stringify({
          teamDefinition: { version: 2 },
          providerId: 'fixed-provider',
          modelId: 'fixed-model',
        }),
        requestData: {
          clientRequestId: 'req-fixed-model',
          maxTokens: 2048,
          message: 'hello',
          temperature: 1,
        },
        userId: USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'TEAM_MODEL_BINDING_UNAVAILABLE' });

    expect(providerCatalogMocks.getProviderForSelection).toHaveBeenCalledWith(
      USER_ID,
      {
        providerId: 'fixed-provider',
        modelId: 'fixed-model',
      },
      { fallbackToChat: false },
    );
  });

  it('请求仅回显 session chat 模型时仍允许 Fast 覆盖主对话流', async () => {
    providerCatalogMocks.getFastProvider.mockResolvedValueOnce({
      provider: fastProvider,
      modelId: 'gpt-5.4-nano',
    });
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: chatProvider,
      modelId: 'gpt-4o',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
      }),
      requestData: {
        clientRequestId: 'req-fast-echo',
        maxTokens: 2048,
        message: 'hello',
        model: 'gpt-4o',
        providerId: 'openai-chat',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.model).toBe('gpt-5.4-nano');
    expect(route.providerType).toBe('openai');
    expect(route.upstreamProtocol).toBe('responses');
    expect(providerCatalogMocks.getFastProvider).toHaveBeenCalledWith(USER_ID);
    expect(providerCatalogMocks.getProviderForSelection).not.toHaveBeenCalled();
  });

  it('provider 缺失的 delegated model 绑定不会被 Fast 覆盖', async () => {
    providerCatalogMocks.getFastProvider.mockResolvedValueOnce({
      provider: fastProvider,
      modelId: 'gpt-5.4-nano',
    });
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: anthropicProvider,
      modelId: 'claude-opus-4-0',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        delegatedSystemPrompt: 'delegated',
        modelId: 'grok-code-fast-1',
      }),
      requestData: {
        agentId: 'explore',
        clientRequestId: 'req-delegated-model-only',
        maxTokens: 2048,
        message: 'hello',
        model: 'grok-code-fast-1',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.model).toBe('claude-opus-4-0');
    expect(route.providerId).toBe('anthropic-chat');
    expect(route.providerType).toBe('anthropic');
    expect(providerCatalogMocks.getFastProvider).not.toHaveBeenCalled();
    expect(providerCatalogMocks.getProviderForSelection).toHaveBeenCalledWith(
      USER_ID,
      {
        providerId: undefined,
        modelId: 'grok-code-fast-1',
      },
      { fallbackToChat: true },
    );
  });

  it('GET /sessions/:id/stream/attach 在请求流已失活时返回中文 409', async () => {
    const app = await buildApp();
    try {
      const token = bearer(app);
      const response = await app.inject({
        method: 'GET',
        url:
          `/sessions/${SESSION_ID}/stream/attach?clientRequestId=req-missing` +
          `&afterSeq=0&token=${encodeURIComponent(token)}`,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        activeClientRequestId: null,
        error: STREAM_PLUGIN_ERROR_MESSAGES.requestedStreamInactive,
      });
    } finally {
      await app.close();
    }
  });
});
