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
  getProviderConfigForSelection: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
}));

vi.mock('../../provider/provider-config.js', () => ({
  getFastProviderConfig: mocks.getFastProviderConfig,
  getActiveChatProviderConfig: mocks.getActiveChatProviderConfig,
  getProviderConfigForSelection: mocks.getProviderConfigForSelection,
}));

import {
  resolveAuxiliaryLlmConfig,
  resolveAuxiliaryLlmConfigCandidates,
} from '../../provider/auxiliary-llm-config.js';

function mockStoredSettings(input: { providers?: unknown; activeSelection?: unknown }): void {
  mocks.sqliteGet.mockImplementation((query: string) => {
    if (query.includes(`key = 'providers'`)) {
      return input.providers === undefined ? undefined : { value: JSON.stringify(input.providers) };
    }
    if (query.includes(`key = 'active_selection'`)) {
      return input.activeSelection === undefined
        ? undefined
        : { value: JSON.stringify(input.activeSelection) };
    }
    return undefined;
  });
}

describe('resolveAuxiliaryLlmConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    mocks.getFastProviderConfig.mockReset();
    mocks.getActiveChatProviderConfig.mockReset();
    mocks.getProviderConfigForSelection.mockReset();
    // Default to no env vars so each test opts in explicitly.
    delete process.env['AI_API_BASE_URL'];
    delete process.env['AI_API_KEY'];
    delete process.env['AI_DEFAULT_MODEL'];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("forwards the user provider's providerType and upstreamProtocol", async () => {
    mockStoredSettings({ providers: [{ id: 'stored-fast' }] });
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

  it('forwards OpenAI fast provider through the Responses protocol', async () => {
    mockStoredSettings({ providers: [{ id: 'stored-fast' }] });
    mocks.getFastProviderConfig.mockResolvedValue({
      provider: {
        id: 'openai-fast',
        type: 'openai',
        name: 'OpenAI Fast',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai-fast',
        upstreamProtocol: 'responses',
      },
      modelId: 'gpt-5.4-nano',
    });

    const cfg = await resolveAuxiliaryLlmConfig('user-1');

    expect(cfg).toEqual({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai-fast',
      model: 'gpt-5.4-nano',
      providerType: 'openai',
      upstreamProtocol: 'responses',
    });
    expect(mocks.getActiveChatProviderConfig).not.toHaveBeenCalled();
  });

  it('falls back to active-chat provider when fast is unavailable', async () => {
    mockStoredSettings({ providers: [{ id: 'stored-chat' }] });
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
    mockStoredSettings({ providers: [{ id: 'stored-openai' }] });
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
    mockStoredSettings({ providers: [{ id: 'stored-broken' }] });
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

  it('does not fallback to active chat or env when an explicit override is unavailable', async () => {
    mockStoredSettings({ providers: [{ id: 'stored-override' }] });
    mocks.getProviderConfigForSelection.mockResolvedValue(null);
    mocks.getFastProviderConfig.mockResolvedValue({
      provider: {
        id: 'fast',
        type: 'openai',
        name: 'Fast',
        baseUrl: 'https://fast.example.com/v1',
        apiKey: 'fast-key',
      },
      modelId: 'fast-model',
    });
    mocks.getActiveChatProviderConfig.mockResolvedValue({
      provider: {
        id: 'chat',
        type: 'openai',
        name: 'Chat',
        baseUrl: 'https://chat.example.com/v1',
        apiKey: 'chat-key',
      },
      modelId: 'chat-model',
    });
    process.env['AI_API_BASE_URL'] = 'https://env.example.com/v1';
    process.env['AI_API_KEY'] = 'env-key';
    process.env['AI_DEFAULT_MODEL'] = 'env-model';

    const cfg = await resolveAuxiliaryLlmConfig('user-1', {
      providerId: 'fixed-provider',
      modelId: 'fixed-model',
    });

    expect(cfg).toBeNull();
    expect(mocks.getProviderConfigForSelection).toHaveBeenCalledWith(
      [{ id: 'stored-override' }],
      undefined,
      {
        providerId: 'fixed-provider',
        modelId: 'fixed-model',
      },
      { fallbackToChat: false },
    );
    expect(mocks.getFastProviderConfig).not.toHaveBeenCalled();
    expect(mocks.getActiveChatProviderConfig).not.toHaveBeenCalled();
  });

  it('falls back to env vars when a stored setting row is corrupt JSON (does not throw)', async () => {
    // §0.115: a corrupt `providers` / `active_selection` value must degrade to
    // "unset" — NOT throw out of the resolver and short-circuit the env-var
    // fallback. Otherwise a user with valid AI_API_* env creds still can't run
    // any team handoff just because a stored setting row got corrupted.
    mocks.sqliteGet.mockReturnValue({ value: '{not valid json' });
    mocks.getFastProviderConfig.mockResolvedValue(null);
    mocks.getActiveChatProviderConfig.mockResolvedValue(null);
    process.env['AI_API_BASE_URL'] = 'https://env.example.com/v1';
    process.env['AI_API_KEY'] = 'env-key';
    process.env['AI_DEFAULT_MODEL'] = 'env-model';

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let cfg: Awaited<ReturnType<typeof resolveAuxiliaryLlmConfig>> | undefined;
    try {
      // Must not throw despite both setting rows holding corrupt JSON.
      cfg = await resolveAuxiliaryLlmConfig('user-1');
    } finally {
      warn.mockRestore();
    }

    expect(cfg).toEqual({
      apiBaseUrl: 'https://env.example.com/v1',
      apiKey: 'env-key',
      model: 'env-model',
    });
  });

  it('candidate resolver returns fast, active-chat, then env fallback in order', async () => {
    mockStoredSettings({ providers: [{ id: 'stored-fast' }] });
    mocks.getFastProviderConfig.mockResolvedValue({
      provider: {
        id: 'fast',
        type: 'openai',
        name: 'Fast',
        baseUrl: 'https://fast.example.com/v1',
        apiKey: 'fast-key',
      },
      modelId: 'fast-model',
    });
    mocks.getActiveChatProviderConfig.mockResolvedValue({
      provider: {
        id: 'chat',
        type: 'anthropic',
        name: 'Chat',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'chat-key',
        upstreamProtocol: 'anthropic_messages',
      },
      modelId: 'claude-model',
    });
    process.env['AI_API_BASE_URL'] = 'https://env.example.com/v1';
    process.env['AI_API_KEY'] = 'env-key';
    process.env['AI_DEFAULT_MODEL'] = 'env-model';

    const configs = await resolveAuxiliaryLlmConfigCandidates('user-1');

    expect(configs).toEqual([
      {
        apiBaseUrl: 'https://fast.example.com/v1',
        apiKey: 'fast-key',
        model: 'fast-model',
        providerType: 'openai',
      },
      {
        apiBaseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'chat-key',
        model: 'claude-model',
        providerType: 'anthropic',
        upstreamProtocol: 'anthropic_messages',
      },
      {
        apiBaseUrl: 'https://env.example.com/v1',
        apiKey: 'env-key',
        model: 'env-model',
      },
    ]);
  });

  it('candidate resolver de-duplicates fast and active-chat when they resolve to the same provider', async () => {
    const provider = {
      id: 'same',
      type: 'openai',
      name: 'Same',
      baseUrl: 'https://same.example.com/v1',
      apiKey: 'same-key',
    };
    mockStoredSettings({ providers: [{ id: 'stored-same' }] });
    mocks.getFastProviderConfig.mockResolvedValue({ provider, modelId: 'same-model' });
    mocks.getActiveChatProviderConfig.mockResolvedValue({ provider, modelId: 'same-model' });

    const configs = await resolveAuxiliaryLlmConfigCandidates('user-1');

    expect(configs).toHaveLength(1);
    expect(configs[0]?.apiBaseUrl).toBe('https://same.example.com/v1');
  });
});
