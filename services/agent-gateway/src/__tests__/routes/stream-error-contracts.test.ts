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
  getProviderForSelection: vi.fn(),
}));

vi.mock('../../provider/provider-catalog.js', () => providerCatalogMocks);

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let streamRequestSchema: typeof StreamRoutesModule.streamRequestSchema;
let streamRoutes: typeof StreamRoutesPluginModule.streamRoutes;
let STREAM_ERROR_MESSAGES: typeof StreamRoutesModule.STREAM_ERROR_MESSAGES;
let STREAM_PLUGIN_ERROR_MESSAGES: typeof StreamRoutesPluginModule.STREAM_PLUGIN_ERROR_MESSAGES;
let buildSseClientDisconnectedAuditLog: typeof StreamRoutesPluginModule.buildSseClientDisconnectedAuditLog;
let toolsRequiringNonEmptyArgs: typeof StreamRoutesModule.TOOLS_REQUIRING_NON_EMPTY_ARGS;
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
  toolsRequiringNonEmptyArgs = streamModule.TOOLS_REQUIRING_NON_EMPTY_ARGS;
  const pluginModule = await import('../../routes/stream-routes-plugin.js');
  streamRoutes = pluginModule.streamRoutes;
  STREAM_PLUGIN_ERROR_MESSAGES = pluginModule.STREAM_PLUGIN_ERROR_MESSAGES;
  buildSseClientDisconnectedAuditLog = pluginModule.buildSseClientDisconnectedAuditLog;
}, STREAM_ERROR_CONTRACTS_COLD_IMPORT_HOOK_TIMEOUT_MS);

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  providerCatalogMocks.getChatProvider.mockReset();
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
      undefined,
      'req-1',
      '上游返回 503 Service Unavailable',
    );

    expect(chunk).toMatchObject({
      type: 'error',
      code: 'REQUEST_REPLAY_FAILED',
      message: '请求重放失败。',
      requestId: 'req-1',
      technicalDetail: '上游返回 503 Service Unavailable',
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

  it('SSE 客户端主动断开仅记录非错误审计事件', () => {
    expect(
      buildSseClientDisconnectedAuditLog({
        clientRequestId: 'req-disconnect',
        sessionId: SESSION_ID,
      }),
    ).toEqual({
      sessionId: SESSION_ID,
      category: 'route',
      sourceName: 'SSE_CLIENT_DISCONNECTED',
      requestId: 'req-disconnect',
      output: {
        code: 'SSE_CLIENT_DISCONNECTED',
        message: STREAM_PLUGIN_ERROR_MESSAGES.sseClientDisconnected,
      },
      isError: false,
    });
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
          afterSeq: 0,
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
      { fallbackToChat: false, honorRequestedModel: false },
    );
  });

  it('仅依赖 session metadata 选型时按会话绑定解析主对话流', async () => {
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
        afterSeq: 0,
        clientRequestId: 'req-metadata-selection',
        maxTokens: 2048,
        message: 'hello',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.model).toBe('gpt-4o');
    expect(route.providerType).toBe('openai');
    expect(route.upstreamProtocol).toBe('responses');
    expect(providerCatalogMocks.getProviderForSelection).toHaveBeenCalledWith(
      USER_ID,
      {
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
      },
      { fallbackToChat: true, honorRequestedModel: false },
    );
  });

  it('请求未带 agentId 时回退到会话绑定的 Agent', async () => {
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: chatProvider,
      modelId: 'gpt-4o',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
        agentId: 'general',
      }),
      requestData: {
        afterSeq: 0,
        clientRequestId: 'req-session-agent',
        message: 'hello',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.effectiveAgentId).toBe('general');
    expect(route.systemPrompt).toContain('general-purpose software work');
  });

  it('请求显式 agentId 优先于会话绑定', async () => {
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: chatProvider,
      modelId: 'gpt-4o',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
        agentId: 'general',
      }),
      requestData: {
        afterSeq: 0,
        agentId: 'plan',
        clientRequestId: 'req-explicit-agent-wins',
        message: 'hello',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.effectiveAgentId).toBe('plan');
  });

  it('渠道会话未绑定 Agent 时用渠道人设作为 route system prompt', async () => {
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: chatProvider,
      modelId: 'gpt-4o',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
        source: 'channel',
        channelPersona: {
          resourceId: 'resource-soul-balanced-collaborator',
          title: '稳健协作者',
          content: '# SOUL.md\n保持稳健协作。',
        },
      }),
      requestData: {
        afterSeq: 0,
        clientRequestId: 'req-channel-persona',
        message: 'hello',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.systemPrompt).toContain('<channel-persona>');
    expect(route.systemPrompt).toContain('当前消息通道绑定的人设资源：稳健协作者');
    expect(route.systemPrompt).toContain('# SOUL.md\n保持稳健协作。');
  });

  it('渠道会话显式请求的 systemPrompt 优先于渠道人设', async () => {
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: chatProvider,
      modelId: 'gpt-4o',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
        source: 'channel',
        channelPersona: {
          resourceId: 'resource-soul-balanced-collaborator',
          title: '稳健协作者',
          content: '# SOUL.md\n保持稳健协作。',
        },
      }),
      requestData: {
        afterSeq: 0,
        clientRequestId: 'req-channel-persona-override',
        message: 'hello',
        systemPrompt: '显式指定的系统提示',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.systemPrompt).toBe('显式指定的系统提示');
  });

  it('非渠道会话不会注入渠道人设', async () => {
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: chatProvider,
      modelId: 'gpt-4o',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
        source: 'chat',
        channelPersona: {
          resourceId: 'resource-soul-balanced-collaborator',
          title: '稳健协作者',
          content: '# SOUL.md\n保持稳健协作。',
        },
      }),
      requestData: {
        afterSeq: 0,
        clientRequestId: 'req-non-channel-persona',
        message: 'hello',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.systemPrompt ?? null).toBeNull();
  });

  it('对话未指定额度时不下发 max_tokens，显式请求与模型覆盖仍优先', async () => {
    // 模型声明的 maxOutputTokens 是「模型理论上限」（如 384000），只用于压缩 /
    // 溢出计算，**不参与请求额度**；未指定时请求不下发 max_tokens（对齐 opencode）。
    const provider = {
      ...chatProvider,
      defaultModels: [{ ...chatProvider.defaultModels[0]!, maxOutputTokens: 32_000 }],
    };
    providerCatalogMocks.getProviderForSelection.mockResolvedValue({ provider, modelId: 'gpt-4o' });
    const requestData = streamRequestSchema.parse({
      clientRequestId: 'req-output-limit',
      message: 'hello',
    });

    const inferred = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData,
      userId: USER_ID,
    });
    expect(inferred.maxTokens).toBeUndefined();

    providerCatalogMocks.getProviderForSelection.mockResolvedValue({
      provider: chatProvider,
      modelId: 'gpt-4o',
    });
    const unknownLimit = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData,
      userId: USER_ID,
    });
    expect(unknownLimit.maxTokens).toBeUndefined();

    providerCatalogMocks.getProviderForSelection.mockResolvedValue({ provider, modelId: 'gpt-4o' });

    const explicit = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData: { ...requestData, maxTokens: 4096 },
      userId: USER_ID,
    });
    expect(explicit.maxTokens).toBe(4096);

    providerCatalogMocks.getProviderForSelection.mockResolvedValue({
      provider: {
        ...provider,
        defaultModels: [{ ...provider.defaultModels[0]!, requestOverrides: { maxTokens: 8192 } }],
      },
      modelId: 'gpt-4o',
    });
    const overridden = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData,
      userId: USER_ID,
    });
    expect(overridden.maxTokens).toBe(8192);

    const explicitWithOverride = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData: { ...requestData, maxTokens: 4096 },
      userId: USER_ID,
    });
    // 模型级 `requestOverrides.maxTokens` 是用户在该模型上的长期配置，优先于
    // 单次请求的显式值——与 look_at 内层调用共用同一契约
    //（见 `__tests__/provider/inner-max-tokens-precedence.test.ts`）。
    expect(explicitWithOverride.maxTokens).toBe(8192);
    expect(explicitWithOverride.requestOverrides.maxTokens).toBe(8192);
  });

  it('会话级 contextWindowOverride 优先于模型级挡位（不再跨会话串味）', async () => {
    // 模型级挡位（user_settings.providers 里该模型的 contextWindowOverride）
    // 是该用户下所有会话共享的默认值；会话 metadata 一旦写了同名键，必须由它生效。
    providerCatalogMocks.getProviderForSelection.mockResolvedValue({
      provider: {
        ...chatProvider,
        defaultModels: [{ ...chatProvider.defaultModels[0]!, contextWindowOverride: 200_000 }],
      },
      modelId: 'gpt-4o',
    });
    const requestData = streamRequestSchema.parse({
      clientRequestId: 'req-session-context-window',
      message: 'hello',
    });

    const modelLevelOnly = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData,
      userId: USER_ID,
    });
    expect(modelLevelOnly.contextWindowOverride).toBe(200_000);

    const sessionOverrides = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({ contextWindowOverride: 400_000 }),
      requestData,
      userId: USER_ID,
    });
    expect(sessionOverrides.contextWindowOverride).toBe(400_000);
  });

  it('请求显式指定与会话绑定一致的 provider/model 时以请求为准', async () => {
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
        afterSeq: 0,
        clientRequestId: 'req-explicit-chat-model',
        maxTokens: 2048,
        message: 'hello',
        model: 'gpt-4o',
        providerId: 'openai-chat',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.model).toBe('gpt-4o');
    expect(route.providerId).toBe('openai-chat');
    expect(providerCatalogMocks.getProviderForSelection).toHaveBeenCalledWith(
      USER_ID,
      {
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
      },
      { fallbackToChat: true, honorRequestedModel: true },
    );
  });

  it('请求显式选择与会话 metadata 绑定不一致时以请求为准', async () => {
    providerCatalogMocks.getProviderForSelection.mockResolvedValueOnce({
      provider: anthropicProvider,
      modelId: 'claude-opus-4-0',
    });

    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({
        providerId: 'openai-chat',
        modelId: 'gpt-4o',
      }),
      requestData: {
        afterSeq: 0,
        clientRequestId: 'req-explicit-wins',
        maxTokens: 2048,
        message: 'hello',
        model: 'claude-opus-4-0',
        providerId: 'anthropic-chat',
        temperature: 1,
      },
      userId: USER_ID,
    });

    expect(route.model).toBe('claude-opus-4-0');
    expect(route.providerId).toBe('anthropic-chat');
    expect(route.providerType).toBe('anthropic');
    expect(providerCatalogMocks.getProviderForSelection).toHaveBeenCalledWith(
      USER_ID,
      {
        providerId: 'anthropic-chat',
        modelId: 'claude-opus-4-0',
      },
      { fallbackToChat: true, honorRequestedModel: true },
    );
  });

  it('provider 缺失的 delegated model 绑定按会话 metadata 解析', async () => {
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
        afterSeq: 0,
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
    expect(providerCatalogMocks.getProviderForSelection).toHaveBeenCalledWith(
      USER_ID,
      {
        providerId: undefined,
        modelId: 'grok-code-fast-1',
      },
      { fallbackToChat: true, honorRequestedModel: false },
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

describe('stream · 自助管理工具空参数拦截登记守卫', () => {
  it('全部自助管理工具均已登记（新增管理工具时必须同步补全）', () => {
    const requiredSelfServiceTools = [
      'mcp_manage_servers',
      'memory_manage',
      'skill_manage',
      'plugin_manage',
      'schedule_manage',
      'agent_manage',
      'team_workspace_manage',
    ] satisfies string[];

    const missing = requiredSelfServiceTools.filter(
      (tool) => !toolsRequiringNonEmptyArgs.has(tool),
    );
    expect(missing).toEqual([]);
  });

  it('委派工具的规范名与历史别名必须同时登记（261102 规范名收敛遗留）', () => {
    // 模型可见名是规范名 `subagent`（`TASK_TOOL_NAME`），历史别名 `task` 仍可能来自存量调用；
    // 只登记别名会让规范名的空参调用漏过前置拦截，白跑一次 sandbox 往返。
    // 该断言在补登记之前会失败（旧集合只有 `task`）。
    expect(toolsRequiringNonEmptyArgs.has('task')).toBe(true);
    expect(toolsRequiringNonEmptyArgs.has('subagent')).toBe(true);
  });
});
