/**
 * Regression: `resolveAuxiliaryLlmConfig` is the single source of truth
 * for the auxiliary (non-agent) LLM credentials used by the prompt
 * optimizer / translator (`routes/workflows.ts`), team interaction-agent
 * rewrite + leader dispatch (`routes/team.ts`), and the companion
 * (宠物) chat (`routes/settings.ts`).
 *
 * Before the consolidation, the team + settings call sites read the
 * `AI_API_*` env vars directly, which silently dropped `providerType`
 * and `upstreamProtocol`. Users on `anthropic_messages` / `responses`
 * therefore had every team-leader rewrite, dispatch, and companion
 * reply degrade to `chat_completions`. This test pins the contract:
 *
 *   1. user-configured fast/inline provider wins, and its
 *      `providerType` + `upstreamProtocol` are included verbatim;
 *   2. when no user provider is configured, the env-var fallback is
 *      used and protocol fields are intentionally absent (caller
 *      relies on the workflow LLM's hostname-based inference);
 *   3. no provider + no env vars => `null` so the caller can surface
 *      a structured 503.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  getFastProviderConfig: vi.fn(),
  getActiveChatProviderConfig: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
}));

vi.mock('../../provider/provider-config.js', () => ({
  getFastProviderConfig: mocks.getFastProviderConfig,
  getActiveChatProviderConfig: mocks.getActiveChatProviderConfig,
}));

import { resolveAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';

describe('resolveAuxiliaryLlmConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    mocks.getFastProviderConfig.mockReset();
    mocks.getActiveChatProviderConfig.mockReset();
    // Default to no env vars so each test opts in explicitly.
    delete process.env['AI_API_BASE_URL'];
    delete process.env['AI_API_KEY'];
    delete process.env['AI_DEFAULT_MODEL'];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("forwards the user provider's providerType and upstreamProtocol", async () => {
    mocks.sqliteGet.mockReturnValue(undefined);
    mocks.getFastProviderConfig.mockResolvedValue({
      provider: {
        id: 'p1',
        type: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant',
        upstreamProtocol: 'anthropic_messages',
      },
      modelId: 'claude-3-5-sonnet-latest',
    });

    const cfg = await resolveAuxiliaryLlmConfig('user-1');

    expect(cfg).toEqual({
      apiBaseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant',
      model: 'claude-3-5-sonnet-latest',
      providerType: 'anthropic',
      upstreamProtocol: 'anthropic_messages',
    });
    // Active-chat lookup must not run when fast already returned a hit.
    expect(mocks.getActiveChatProviderConfig).not.toHaveBeenCalled();
  });

  it('falls back to active-chat provider when fast is unavailable', async () => {
    mocks.sqliteGet.mockReturnValue(undefined);
    mocks.getFastProviderConfig.mockResolvedValue(null);
    mocks.getActiveChatProviderConfig.mockResolvedValue({
      provider: {
        id: 'p2',
        type: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        upstreamProtocol: 'responses',
      },
      modelId: 'gpt-4o',
    });

    const cfg = await resolveAuxiliaryLlmConfig('user-1');

    expect(cfg?.providerType).toBe('openai');
    expect(cfg?.upstreamProtocol).toBe('responses');
    expect(cfg?.model).toBe('gpt-4o');
  });

  it('omits upstreamProtocol when the provider has none configured', async () => {
    mocks.sqliteGet.mockReturnValue(undefined);
    mocks.getFastProviderConfig.mockResolvedValue({
      provider: {
        id: 'p3',
        type: 'openai',
        name: 'OpenAI Compatible',
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-relay',
        // no upstreamProtocol
      },
      modelId: 'gpt-4o-mini',
    });

    const cfg = await resolveAuxiliaryLlmConfig('user-1');

    expect(cfg?.providerType).toBe('openai');
    expect(cfg).not.toHaveProperty('upstreamProtocol');
  });

  it('falls back to env vars when no provider is configured', async () => {
    mocks.sqliteGet.mockReturnValue(undefined);
    mocks.getFastProviderConfig.mockResolvedValue(null);
    mocks.getActiveChatProviderConfig.mockResolvedValue(null);
    process.env['AI_API_BASE_URL'] = 'https://env.example.com/v1';
    process.env['AI_API_KEY'] = 'env-key';
    process.env['AI_DEFAULT_MODEL'] = 'env-model';

    const cfg = await resolveAuxiliaryLlmConfig('user-1');

    expect(cfg).toEqual({
      apiBaseUrl: 'https://env.example.com/v1',
      apiKey: 'env-key',
      model: 'env-model',
    });
    // Env fallback intentionally has no providerType / upstreamProtocol;
    // workflow-llm.ts performs hostname-based inference for that case.
    expect(cfg).not.toHaveProperty('providerType');
    expect(cfg).not.toHaveProperty('upstreamProtocol');
  });

  it('returns null when neither providers nor env vars are configured', async () => {
    mocks.sqliteGet.mockReturnValue(undefined);
    mocks.getFastProviderConfig.mockResolvedValue(null);
    mocks.getActiveChatProviderConfig.mockResolvedValue(null);

    const cfg = await resolveAuxiliaryLlmConfig('user-1');
    expect(cfg).toBeNull();
  });

  it('skips provider entries missing baseUrl or apiKey', async () => {
    mocks.sqliteGet.mockReturnValue(undefined);
    mocks.getFastProviderConfig.mockResolvedValue({
      provider: {
        id: 'broken',
        type: 'openai',
        name: 'Misconfigured',
        baseUrl: '',
        apiKey: '',
        upstreamProtocol: 'anthropic_messages',
      },
      modelId: 'gpt-4o',
    });
    mocks.getActiveChatProviderConfig.mockResolvedValue({
      provider: {
        id: 'good',
        type: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant',
        upstreamProtocol: 'anthropic_messages',
      },
      modelId: 'claude-3-5-sonnet-latest',
    });

    const cfg = await resolveAuxiliaryLlmConfig('user-1');
    expect(cfg?.providerType).toBe('anthropic');
    expect(cfg?.upstreamProtocol).toBe('anthropic_messages');
  });
});
