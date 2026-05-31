import { describe, expect, it } from 'vitest';
import {
  applyCaching,
  buildBaseProviderOptions,
  buildPromptCacheModelInfo,
  buildProviderOptions,
  providerOptions,
  type ProviderOptionsModelInfo,
  type ThinkingConfig,
} from '../../v2-runtime/upstream/index.js';
import type { ModelMessage } from 'ai';

const baseThinking: ThinkingConfig = {
  enabled: true,
  effort: 'medium',
  providerType: 'anthropic',
  supportsThinking: true,
};

describe('buildProviderOptions', () => {
  it('emits anthropic.thinking with the matching budgetTokens', () => {
    const options = buildProviderOptions({
      thinking: baseThinking,
      model: 'claude-sonnet-4-5',
    });
    expect(options).toBeDefined();
    expect(options?.['anthropic']).toMatchObject({
      sendReasoning: true,
      thinking: { type: 'enabled', budgetTokens: 8192 },
    });
  });

  it('reports thinking disabled but still keeps sendReasoning', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, enabled: false },
      model: 'claude-sonnet-4-5',
    });
    expect(options?.['anthropic']).toMatchObject({
      sendReasoning: true,
      thinking: { type: 'disabled' },
    });
  });

  it('returns undefined when thinking is unsupported', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, supportsThinking: false },
      model: 'claude-sonnet-4-5',
    });
    expect(options).toBeUndefined();
  });

  it('maps openai providerType to openai.reasoningEffort', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openai' },
      model: 'gpt-5',
    });
    expect(options?.['openai']).toMatchObject({ reasoningEffort: 'medium' });
  });

  it('emits qwen.body.enable_thinking for qwen', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'qwen', enabled: true },
      model: 'qwen-max',
    });
    const oc = options?.['qwen'] as { body?: Record<string, unknown> } | undefined;
    expect(oc?.body).toEqual({ enable_thinking: true });
  });

  it('opts into gemini-3 thinking_level rather than thinking_budget for gemini-3 models', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'gemini' },
      model: 'gemini-3-pro',
    });
    const oc = options?.['gemini'] as
      | {
          body?: { google?: { thinking_config?: Record<string, unknown> } };
        }
      | undefined;
    expect(oc?.body?.google?.thinking_config).toMatchObject({
      include_thoughts: true,
      thinking_level: 'medium',
    });
  });

  it('skips moonshot non-thinking model variants', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'moonshot' },
      model: 'moonshot-v1-32k',
    });
    expect(options).toBeUndefined();
  });

  it('emits mimo.body.thinking enabled for mimo models', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'mimo', enabled: true },
      model: 'mimo-v2.5-pro',
    });
    const oc = options?.['mimo'] as { body?: Record<string, unknown> } | undefined;
    expect(oc?.body).toEqual({ thinking: { type: 'enabled' } });
  });

  it('emits mimo.body.thinking disabled when thinking is turned off', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'mimo', enabled: false },
      model: 'mimo-v2.5',
    });
    const oc = options?.['mimo'] as { body?: Record<string, unknown> } | undefined;
    expect(oc?.body).toEqual({ thinking: { type: 'disabled' } });
  });

  it('returns undefined for unrecognised providerType', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'unknown-vendor' },
      model: 'whatever',
    });
    expect(options).toBeUndefined();
  });
});

describe('buildBaseProviderOptions', () => {
  it('disables OpenAI response storage and sets promptCacheKey when a session id is provided', () => {
    expect(
      buildBaseProviderOptions({ providerType: 'openai', model: 'gpt-5', sessionId: 'session-1' }),
    ).toEqual({
      openai: { store: false, promptCacheKey: 'session-1' },
    });
  });

  it('omits promptCacheKey for OpenAI when sessionId is missing', () => {
    expect(buildBaseProviderOptions({ providerType: 'openai', model: 'gpt-5' })).toEqual({
      openai: { store: false },
    });
  });

  it('passes Azure cache key under both OpenAI and Azure namespaces', () => {
    expect(
      buildBaseProviderOptions({ providerType: 'azure', model: 'gpt-5', sessionId: 'session-1' }),
    ).toEqual({
      openai: { store: false, promptCacheKey: 'session-1' },
      azure: { store: false, promptCacheKey: 'session-1' },
    });
  });

  it('passes OpenRouter prompt_cache_key alongside usage accounting and gemini-3 reasoning', () => {
    expect(
      buildBaseProviderOptions({
        providerType: 'openrouter',
        model: 'google/gemini-3-pro',
        sessionId: 'session-1',
      }),
    ).toEqual({
      openrouter: {
        usage: { include: true },
        prompt_cache_key: 'session-1',
        reasoning: { effort: 'high' },
      },
    });
  });

  it('omits prompt_cache_key for OpenRouter when sessionId is missing', () => {
    expect(
      buildBaseProviderOptions({ providerType: 'openrouter', model: 'google/gemini-3-pro' }),
    ).toEqual({
      openrouter: { usage: { include: true }, reasoning: { effort: 'high' } },
    });
  });

  it('enables Vercel AI Gateway auto caching', () => {
    expect(
      buildBaseProviderOptions({ providerType: 'gateway', model: 'anthropic/claude-sonnet-4-5' }),
    ).toEqual({
      gateway: { caching: 'auto' },
    });
  });

  it('sets Venice promptCacheKey when sessionId is provided', () => {
    expect(
      buildBaseProviderOptions({
        providerType: 'venice',
        model: 'venice-uncensored',
        sessionId: 'session-1',
      }),
    ).toEqual({
      venice: { promptCacheKey: 'session-1' },
    });
  });
});

describe('providerOptions', () => {
  it('routes gateway model options under the upstream slug while preserving gateway options', () => {
    const model: ProviderOptionsModelInfo = {
      providerID: 'gateway',
      id: 'anthropic/claude-sonnet-4-5',
      api: { id: 'anthropic/claude-sonnet-4-5', npm: '@ai-sdk/gateway' },
    };

    expect(
      providerOptions(model, {
        gateway: { order: ['anthropic'] },
        thinking: { type: 'enabled', budgetTokens: 8192 },
      }),
    ).toEqual({
      gateway: { order: ['anthropic'] },
      anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 } },
    });
  });

  it('maps amazon gateway slug to bedrock', () => {
    const model: ProviderOptionsModelInfo = {
      providerID: 'gateway',
      id: 'amazon/nova-2-lite',
      api: { id: 'amazon/nova-2-lite', npm: '@ai-sdk/gateway' },
    };

    expect(providerOptions(model, { cachePoint: { type: 'default' } })).toEqual({
      bedrock: { cachePoint: { type: 'default' } },
    });
  });

  it('merges non-gateway options into gateway when no slug is available', () => {
    const model: ProviderOptionsModelInfo = {
      providerID: 'gateway',
      id: 'custom-model',
      api: { id: 'custom-model', npm: '@ai-sdk/gateway' },
    };

    expect(providerOptions(model, { gateway: { order: ['openai'] }, store: false })).toEqual({
      gateway: { order: ['openai'], store: false },
    });
  });

  it('passes azure options under both openai and azure namespaces', () => {
    const model: ProviderOptionsModelInfo = {
      providerID: 'azure',
      id: 'gpt-5',
      api: { id: 'gpt-5', npm: '@ai-sdk/azure' },
    };

    expect(providerOptions(model, { reasoningEffort: 'medium' })).toEqual({
      openai: { reasoningEffort: 'medium' },
      azure: { reasoningEffort: 'medium' },
    });
  });

  it('uses dot-split provider names for openai-compatible providers', () => {
    const model: ProviderOptionsModelInfo = {
      providerID: 'wafer.ai',
      id: 'claude-compatible',
      api: { id: 'claude-compatible', npm: '@ai-sdk/openai-compatible' },
    };

    expect(providerOptions(model, { body: { foo: 'bar' } })).toEqual({
      wafer: { body: { foo: 'bar' } },
    });
  });
});

describe('applyCaching', () => {
  function buildMessages(): ModelMessage[] {
    return [
      { role: 'system', content: 'sys-1' },
      { role: 'user', content: 'turn-1' },
      { role: 'assistant', content: 'reply-1' },
      { role: 'user', content: 'turn-2' },
      { role: 'assistant', content: 'reply-2' },
    ];
  }

  it('marks the system message and last 2 non-system messages on anthropic providers', () => {
    const result = applyCaching(
      buildMessages(),
      buildPromptCacheModelInfo({ providerType: 'anthropic', model: 'claude-sonnet-4-5' }),
    );
    const cacheMarked = result.map(
      (m) => ((m.providerOptions?.['anthropic'] ?? {}) as { cacheControl?: unknown }).cacheControl,
    );
    expect(cacheMarked[0]).toEqual({ type: 'ephemeral' });
    expect(cacheMarked[1]).toBeUndefined();
    expect(cacheMarked[2]).toBeUndefined();
    expect(cacheMarked[3]).toEqual({ type: 'ephemeral' });
    expect(cacheMarked[4]).toEqual({ type: 'ephemeral' });
    expect(result[4]!.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: 'ephemeral' } },
      openrouter: { cacheControl: { type: 'ephemeral' } },
      bedrock: { cachePoint: { type: 'default' } },
      openaiCompatible: { cache_control: { type: 'ephemeral' } },
      copilot: { copilot_cache_control: { type: 'ephemeral' } },
      alibaba: { cacheControl: { type: 'ephemeral' } },
    });
  });

  it('marks the last 2 non-system messages when the tail is a tool result', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'turn-1' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: { type: 'text', value: 'file contents' },
          },
        ],
      },
    ];
    const result = applyCaching(
      messages,
      buildPromptCacheModelInfo({ providerType: 'anthropic', model: 'claude-sonnet-4-5' }),
    );
    const cacheMarked = result.map(
      (m) => ((m.providerOptions?.['anthropic'] ?? {}) as { cacheControl?: unknown }).cacheControl,
    );

    expect(cacheMarked[0]).toEqual({ type: 'ephemeral' });
    expect(cacheMarked[1]).toBeUndefined();
    expect(cacheMarked[2]).toEqual({ type: 'ephemeral' });
    expect(cacheMarked[3]).toEqual({ type: 'ephemeral' });
  });

  it('uses content-level providerOptions for openrouter anthropic-backed array content', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'turn-1' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: { type: 'text', value: 'file contents' },
          },
        ],
      },
    ];
    const result = applyCaching(
      messages,
      buildPromptCacheModelInfo({
        providerType: 'openrouter',
        model: 'anthropic/claude-sonnet-4-5',
      }),
    );
    const assistantContent = result[2]!.content as Array<{
      providerOptions?: Record<string, { cacheControl?: unknown }>;
    }>;
    const toolContent = result[3]!.content as Array<{
      providerOptions?: Record<string, { cacheControl?: unknown }>;
    }>;

    expect(result[0]!.providerOptions?.['openrouter']).toEqual({
      cacheControl: { type: 'ephemeral' },
    });
    expect(result[2]!.providerOptions).toBeUndefined();
    // Last 2 non-system messages get a content-level breakpoint, so the
    // assistant tool-call AND the tool-result both carry cacheControl.
    expect(assistantContent[0]?.providerOptions?.['openrouter']?.cacheControl).toEqual({
      type: 'ephemeral',
    });
    expect(toolContent[0]?.providerOptions?.['openrouter']?.cacheControl).toEqual({
      type: 'ephemeral',
    });
  });

  it('is a noop on non-anthropic-backed providers', () => {
    const original = buildMessages();
    const result = applyCaching(
      original,
      buildPromptCacheModelInfo({ providerType: 'openrouter', model: 'openai/gpt-5' }),
    );
    expect(result).toBe(original);
    expect(result.every((message) => message.providerOptions === undefined)).toBe(true);
  });

  it('preserves caller-provided providerOptions when adding cacheControl', () => {
    const messages: ModelMessage[] = [
      {
        role: 'system',
        content: 'sys',
        providerOptions: { anthropic: { sendReasoning: true } },
      },
      { role: 'user', content: 'q' },
    ];
    const [system] = applyCaching(
      messages,
      buildPromptCacheModelInfo({ providerType: 'anthropic', model: 'claude-sonnet-4-5' }),
    );
    const anthropic = (system!.providerOptions?.['anthropic'] ?? {}) as {
      sendReasoning?: boolean;
      cacheControl?: unknown;
    };
    expect(anthropic.sendReasoning).toBe(true);
    expect(anthropic.cacheControl).toEqual({ type: 'ephemeral' });
  });
});
