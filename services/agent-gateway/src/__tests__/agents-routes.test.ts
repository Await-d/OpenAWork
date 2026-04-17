import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedDb = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  state: {
    agentCatalogValue: undefined as string | undefined,
    legacyPreferencesValue: undefined as string | undefined,
  },
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: unknown }) => {
    request.user = { sub: 'user-1', email: 'admin@openAwork.local' };
  },
}));

vi.mock('../db.js', () => ({
  sqliteGet: mockedDb.sqliteGetMock,
  sqliteRun: mockedDb.sqliteRunMock,
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

vi.mock('@openAwork/shared', () => ({
  REFERENCE_AGENT_ROLE_METADATA: {
    oracle: {
      canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
      aliases: ['architect', 'debugger', 'code-reviewer', 'init-architect'],
    },
    explore: {
      canonicalRole: { coreRole: 'researcher', preset: 'explore', confidence: 'high' },
      aliases: ['explorer'],
    },
  },
}));

import { agentsRoutes } from '../routes/agents.js';

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  mockedDb.state.agentCatalogValue = undefined;
  mockedDb.state.legacyPreferencesValue = undefined;
  mockedDb.sqliteGetMock.mockReset();
  mockedDb.sqliteRunMock.mockReset();

  mockedDb.sqliteGetMock.mockImplementation((query: string) => {
    if (query.includes("key = 'agent_catalog'")) {
      return mockedDb.state.agentCatalogValue
        ? { value: mockedDb.state.agentCatalogValue }
        : undefined;
    }
    if (query.includes("key = 'agent_preferences'")) {
      return mockedDb.state.legacyPreferencesValue
        ? { value: mockedDb.state.legacyPreferencesValue }
        : undefined;
    }
    return undefined;
  });

  mockedDb.sqliteRunMock.mockImplementation((_query: string, params: unknown[]) => {
    mockedDb.state.agentCatalogValue = String(params[1]);
  });

  app = Fastify();
  await app.register(agentsRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('agentsRoutes', () => {
  it('creates a custom agent and returns it in the managed list', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        label: '自定义调试助手',
        description: '用于快速排查问题',
        aliases: ['debug-pro'],
        canonicalRole: { coreRole: 'executor', preset: 'debugger', confidence: 'high' },
        systemPrompt: '请协助诊断并修复问题。',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.body) as {
      agent: { id: string; origin: string; source: string; enabled: boolean };
    };
    expect(created.agent).toMatchObject({
      origin: 'custom',
      source: 'custom',
      enabled: true,
    });

    const listResponse = await app.inject({ method: 'GET', url: '/agents' });
    const body = JSON.parse(listResponse.body) as { agents: Array<{ id: string; label: string }> };
    expect(
      body.agents.some(
        (agent) => agent.id === created.agent.id && agent.label === '自定义调试助手',
      ),
    ).toBe(true);
  });

  it('updates builtin model settings and resets them back to default', async () => {
    const listBefore = await app.inject({ method: 'GET', url: '/agents' });
    expect(listBefore.statusCode).toBe(200);
    const listBeforeBody = JSON.parse(listBefore.body) as {
      agents: Array<{ id: string; systemPrompt?: string }>;
    };
    expect(
      listBeforeBody.agents.some(
        (agent) =>
          agent.id === 'oracle' &&
          typeof agent.systemPrompt === 'string' &&
          agent.systemPrompt.length > 0,
      ),
    ).toBe(true);

    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/agents/oracle',
      payload: { model: 'openai/gpt-5.4-mini', variant: 'high' },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(JSON.parse(updateResponse.body)).toMatchObject({
      agent: {
        id: 'oracle',
        label: 'oracle',
        enabled: true,
        model: 'openai/gpt-5.4-mini',
        variant: 'high',
        origin: 'builtin',
        resettable: true,
      },
    });

    const resetResponse = await app.inject({ method: 'POST', url: '/agents/oracle/reset' });
    expect(resetResponse.statusCode).toBe(200);
    expect(JSON.parse(resetResponse.body)).toMatchObject({
      agent: {
        id: 'oracle',
        label: 'oracle',
        enabled: true,
        origin: 'builtin',
        resettable: false,
      },
    });
  });

  it('keeps builtin model-only overrides instead of treating them as empty', async () => {
    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/agents/oracle',
      payload: {
        model: 'openai/gpt-5.4-mini',
        variant: 'high',
        fallbackModels: ['claude-opus-4-6'],
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(JSON.parse(updateResponse.body)).toMatchObject({
      agent: {
        id: 'oracle',
        model: 'openai/gpt-5.4-mini',
        variant: 'high',
        fallbackModels: ['claude-opus-4-6'],
      },
    });

    const listResponse = await app.inject({ method: 'GET', url: '/agents' });
    expect(JSON.parse(listResponse.body)).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: 'oracle',
          model: 'openai/gpt-5.4-mini',
          variant: 'high',
          fallbackModels: ['claude-opus-4-6'],
        }),
      ]),
    });
  });

  it('removes custom agents and reset-all restores defaults for remaining entities', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        id: 'custom-reviewer',
        label: '自定义评审员',
        description: '自定义评审 agent',
        note: '初始版本',
        systemPrompt: '请作为额外评审 agent 提供意见。',
      },
    });
    expect(createResponse.statusCode).toBe(201);

    await app.inject({
      method: 'PUT',
      url: '/agents/custom-reviewer',
      payload: { label: '修改后的评审员', enabled: false },
    });
    await app.inject({
      method: 'PUT',
      url: '/agents/explore',
      payload: { model: 'openai/gpt-5.4-mini' },
    });

    const resetAllResponse = await app.inject({ method: 'POST', url: '/agents/reset-all' });
    expect(resetAllResponse.statusCode).toBe(200);
    const resetAllBody = JSON.parse(resetAllResponse.body) as {
      agents: Array<{ id: string; label: string; enabled: boolean }>;
    };
    expect(
      resetAllBody.agents.some(
        (agent) =>
          agent.id === 'custom-reviewer' && agent.label === '自定义评审员' && agent.enabled,
      ),
    ).toBe(true);
    expect(
      resetAllBody.agents.some(
        (agent) => agent.id === 'explore' && agent.label === 'explore' && agent.enabled,
      ),
    ).toBe(true);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/agents/custom-reviewer',
    });
    expect(deleteResponse.statusCode).toBe(204);
  });

  it('rejects duplicate custom agent ids and empty updates with stable error codes', async () => {
    const firstCreate = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        id: 'custom-debugger',
        label: '自定义调试助手',
        systemPrompt: '请帮助用户调试问题。',
      },
    });
    expect(firstCreate.statusCode).toBe(201);

    const duplicateCreate = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        id: 'custom-debugger',
        label: '另一个自定义调试助手',
        systemPrompt: '另一个调试提示词。',
      },
    });
    expect(duplicateCreate.statusCode).toBe(409);

    const emptyUpdate = await app.inject({
      method: 'PUT',
      url: '/agents/oracle',
      payload: {},
    });
    expect(emptyUpdate.statusCode).toBe(400);
  });

  it('rejects builtin non-model updates and custom creation without prompt', async () => {
    const invalidBuiltinUpdate = await app.inject({
      method: 'PUT',
      url: '/agents/oracle',
      payload: { label: '首席架构顾问' },
    });

    expect(invalidBuiltinUpdate.statusCode).toBe(400);
    expect(JSON.parse(invalidBuiltinUpdate.body)).toMatchObject({
      error: 'Builtin agents only allow model configuration updates',
    });

    const missingPromptCreate = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        label: '缺少提示词的自定义 Agent',
      },
    });

    expect(missingPromptCreate.statusCode).toBe(400);
  });

  it('rejects removing builtin agents with 409', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/agents/oracle',
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'Builtin agent oracle cannot be removed',
    });
  });
});
