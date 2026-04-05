import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  listManagedAgentsForUserMock: vi.fn(),
  resolveModelRouteFromProviderMock: vi.fn(),
  resolveModelRouteMock: vi.fn(),
  selectDelegatedModelForUserMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  getProviderConfigForSelectionMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'full',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/workspace',
  WORKSPACE_ROOTS: ['/workspace'],
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: vi.fn(),
}));

vi.mock('../agent-catalog.js', () => ({
  listManagedAgentsForUser: mocks.listManagedAgentsForUserMock,
}));

vi.mock('../task-model-selection.js', () => ({
  selectDelegatedModelForUser: mocks.selectDelegatedModelForUserMock,
}));

vi.mock('../provider-config.js', () => ({
  getCompactionProviderConfig: vi.fn(async () => null),
  getProviderConfigForSelection: mocks.getProviderConfigForSelectionMock,
}));

vi.mock('../model-router.js', () => {
  const modelRequestSchema = z.object({
    model: z.string().min(1).max(200).optional().default('default'),
    variant: z.string().min(1).max(80).optional(),
    systemPrompt: z.string().max(4000).optional(),
    maxTokens: z.number().int().min(1).max(16384).optional().default(2048),
    temperature: z.number().min(0).max(2).optional().default(1),
  });

  const buildRoute = (input: {
    maxTokens?: number;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    variant?: string;
  }) => ({
    apiBaseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    inputPricePerMillion: undefined,
    maxTokens: input.maxTokens ?? 2048,
    model: input.model ?? 'gpt-4o',
    outputPricePerMillion: undefined,
    providerType: 'openai',
    requestOverrides: {},
    supportsThinking: false,
    systemPrompt: input.systemPrompt,
    temperature: input.temperature ?? 1,
    upstreamProtocol: 'responses',
    variant: input.variant,
  });

  return {
    modelRequestSchema,
    resolveModelRoute: mocks.resolveModelRouteMock.mockImplementation(
      (request: {
        maxTokens?: number;
        model?: string;
        systemPrompt?: string;
        temperature?: number;
        variant?: string;
      }) => buildRoute(request),
    ),
    resolveModelRouteFromProvider: mocks.resolveModelRouteFromProviderMock.mockImplementation(
      (
        _provider: unknown,
        modelId: string,
        request: {
          maxTokens?: number;
          systemPrompt?: string;
          temperature?: number;
          variant?: string;
        },
      ) => buildRoute({ ...request, model: modelId }),
    ),
  };
});

describe('stream agent resolution', () => {
  beforeEach(() => {
    mocks.listManagedAgentsForUserMock.mockReset();
    mocks.resolveModelRouteFromProviderMock.mockClear();
    mocks.resolveModelRouteMock.mockClear();
    mocks.selectDelegatedModelForUserMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.getProviderConfigForSelectionMock.mockReset();

    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes("key = 'providers'")) {
        return { value: JSON.stringify([]) };
      }
      if (query.includes("key = 'active_selection'")) {
        return { value: JSON.stringify({ chat: { modelId: 'gpt-4o', providerId: 'openai' } }) };
      }
      return undefined;
    });

    mocks.getProviderConfigForSelectionMock.mockImplementation(
      async (
        _rawProviders: unknown,
        _rawActiveSelection: unknown,
        selectionOverride?: { modelId?: string; providerId?: string },
      ) => ({
        modelId: selectionOverride?.modelId ?? 'gpt-4o',
        provider: {
          apiKey: 'test-key',
          baseUrl: 'https://example.com/v1',
          defaultModels: [
            {
              enabled: true,
              id: selectionOverride?.modelId ?? 'gpt-4o',
              supportsThinking: false,
            },
          ],
          enabled: true,
          id: selectionOverride?.providerId ?? 'openai',
          type: 'openai',
        },
      }),
    );
  });

  it('accepts an optional request-scoped agentId in the stream request schema', async () => {
    const { streamRequestSchema } = await import('../routes/stream.js');

    const parsed = streamRequestSchema.parse({
      agentId: 'hephaestus',
      clientRequestId: 'req-1',
      message: '请修复这个 bug',
    });

    expect(parsed.agentId).toBe('hephaestus');
    expect(parsed.message).toBe('请修复这个 bug');
  }, 10000);

  it('parses request-scoped thinking settings for websocket and sse payloads', async () => {
    const { streamRequestSchema } = await import('../routes/stream.js');

    const wsParsed = streamRequestSchema.parse({
      clientRequestId: 'req-thinking-ws',
      message: '请认真思考后回答',
      thinkingEnabled: true,
      reasoningEffort: 'high',
    });
    const sseParsed = streamRequestSchema.parse({
      clientRequestId: 'req-thinking-sse',
      message: '请认真思考后回答',
      thinkingEnabled: '1',
      reasoningEffort: 'xhigh',
    });

    expect(wsParsed.thinkingEnabled).toBe(true);
    expect(wsParsed.reasoningEffort).toBe('high');
    expect(sseParsed.thinkingEnabled).toBe(true);
    expect(sseParsed.reasoningEffort).toBe('xhigh');
  });

  it('keeps request-scoped upstream retry ahead of metadata and stored settings', async () => {
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('upstream_retry_policy_v1')) {
        return { value: JSON.stringify({ maxRetries: 0 }) };
      }
      return undefined;
    });

    const { resolveStreamRequestUpstreamRetry, streamRequestSchema } =
      await import('../routes/stream.js');
    const resolved = resolveStreamRequestUpstreamRetry({
      metadataJson: JSON.stringify({ upstreamRetryMaxRetries: 1 }),
      requestData: streamRequestSchema.parse({
        clientRequestId: 'req-retry-request',
        message: '请继续',
        upstreamRetryMaxRetries: 2,
      }),
      userId: 'user-1',
    });

    expect(resolved.upstreamRetryMaxRetries).toBe(2);
    expect(mocks.sqliteGetMock).not.toHaveBeenCalled();
  });

  it('uses session metadata upstream retry before stored settings', async () => {
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('upstream_retry_policy_v1')) {
        return { value: JSON.stringify({ maxRetries: 0 }) };
      }
      return undefined;
    });

    const { resolveStreamRequestUpstreamRetry, streamRequestSchema } =
      await import('../routes/stream.js');
    const resolved = resolveStreamRequestUpstreamRetry({
      metadataJson: JSON.stringify({ upstreamRetryMaxRetries: 1 }),
      requestData: streamRequestSchema.parse({
        clientRequestId: 'req-retry-metadata',
        message: '请继续',
      }),
      userId: 'user-1',
    });

    expect(resolved.upstreamRetryMaxRetries).toBe(1);
    expect(mocks.sqliteGetMock).not.toHaveBeenCalled();
  });

  it('falls back to stored upstream retry settings when request and metadata are empty', async () => {
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteGetMock.mockImplementation((query: string, params?: unknown[]) => {
      if (
        query.includes('SELECT value FROM user_settings') &&
        Array.isArray(params) &&
        params[1] === 'upstream_retry_policy_v1'
      ) {
        expect(params).toEqual(['user-1', 'upstream_retry_policy_v1']);
        return { value: JSON.stringify({ maxRetries: 1 }) };
      }
      return undefined;
    });

    const { resolveStreamRequestUpstreamRetry, streamRequestSchema } =
      await import('../routes/stream.js');
    const resolved = resolveStreamRequestUpstreamRetry({
      metadataJson: '{}',
      requestData: streamRequestSchema.parse({
        clientRequestId: 'req-retry-settings',
        message: '请继续',
      }),
      userId: 'user-1',
    });

    expect(resolved.upstreamRetryMaxRetries).toBe(1);
  });

  it('falls back to the default upstream retry value when nothing is stored', async () => {
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteGetMock.mockReturnValue(undefined);

    const { resolveStreamRequestUpstreamRetry, streamRequestSchema } =
      await import('../routes/stream.js');
    const resolved = resolveStreamRequestUpstreamRetry({
      metadataJson: '{}',
      requestData: streamRequestSchema.parse({
        clientRequestId: 'req-retry-default',
        message: '请继续',
      }),
      userId: 'user-1',
    });

    expect(resolved.upstreamRetryMaxRetries).toBe(3);
  });

  it('applies the matched managed agent to route selection', async () => {
    mocks.listManagedAgentsForUserMock.mockReturnValue([
      {
        aliases: ['programmer'],
        canonicalRole: undefined,
        createdAt: '2026-04-02T00:00:00.000Z',
        description: '程序员代理',
        enabled: true,
        fallbackModels: ['gpt-4o'],
        hasOverrides: false,
        id: 'hephaestus',
        label: 'Hephaestus',
        model: 'gpt-5',
        note: undefined,
        origin: 'builtin',
        removable: false,
        resettable: false,
        source: 'builtin',
        systemPrompt: 'agent prompt',
        updatedAt: '2026-04-02T00:00:00.000Z',
        variant: 'balanced',
      },
    ]);
    mocks.selectDelegatedModelForUserMock.mockReturnValue({
      modelId: 'gpt-5',
      providerId: 'openai',
      variant: 'high',
    });

    const { resolveStreamModelRoute, streamRequestSchema } = await import('../routes/stream.js');
    const route = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData: streamRequestSchema.parse({
        agentId: 'programmer',
        clientRequestId: 'req-2',
        message: '请继续实现',
      }),
      userId: 'user-1',
    });

    expect(route.model).toBe('gpt-5');
    expect(route.variant).toBe('high');
    expect(route.systemPrompt).toBe('agent prompt');
    expect(route.effectiveAgentId).toBe('hephaestus');
    expect(route.requestedAgentId).toBe('programmer');
    expect(route.downgradeReason).toBeUndefined();
    expect(mocks.getProviderConfigForSelectionMock).toHaveBeenCalledWith(
      [],
      { chat: { modelId: 'gpt-4o', providerId: 'openai' } },
      { modelId: 'gpt-5', providerId: 'openai' },
    );
  });

  it('downgrades safely when the requested agent cannot be resolved', async () => {
    mocks.listManagedAgentsForUserMock.mockReturnValue([]);

    const { resolveStreamModelRoute, streamRequestSchema } = await import('../routes/stream.js');
    const route = await resolveStreamModelRoute({
      metadataJson: '{}',
      requestData: streamRequestSchema.parse({
        agentId: 'missing-agent',
        clientRequestId: 'req-missing',
        message: '请继续',
      }),
      userId: 'user-1',
    });

    expect(route.model).toBe('gpt-4o');
    expect(route.requestedAgentId).toBe('missing-agent');
    expect(route.effectiveAgentId).toBeUndefined();
    expect(route.downgradeReason).toBe('agent_not_found');
  });

  it('keeps delegatedSystemPrompt ahead of the agent-derived prompt', async () => {
    mocks.listManagedAgentsForUserMock.mockReturnValue([
      {
        aliases: [],
        canonicalRole: undefined,
        createdAt: '2026-04-02T00:00:00.000Z',
        description: '编程代理',
        enabled: true,
        fallbackModels: [],
        hasOverrides: false,
        id: 'sisyphus-junior',
        label: 'Sisyphus Junior',
        model: 'gpt-5',
        note: undefined,
        origin: 'builtin',
        removable: false,
        resettable: false,
        source: 'builtin',
        systemPrompt: 'agent prompt should lose',
        updatedAt: '2026-04-02T00:00:00.000Z',
        variant: undefined,
      },
    ]);
    mocks.selectDelegatedModelForUserMock.mockReturnValue({
      modelId: 'gpt-5',
      providerId: 'openai',
      variant: undefined,
    });

    const { resolveStreamModelRoute, streamRequestSchema } = await import('../routes/stream.js');
    const route = await resolveStreamModelRoute({
      metadataJson: JSON.stringify({ delegatedSystemPrompt: 'delegated prompt wins' }),
      requestData: streamRequestSchema.parse({
        agentId: 'sisyphus-junior',
        clientRequestId: 'req-3',
        message: '写代码',
      }),
      userId: 'user-1',
    });

    expect(route.systemPrompt).toBe('delegated prompt wins');
    expect(route.effectiveAgentId).toBe('sisyphus-junior');
  });
});
