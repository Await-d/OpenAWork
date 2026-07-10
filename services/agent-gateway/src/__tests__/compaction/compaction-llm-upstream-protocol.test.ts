/**
 * Regression: `callCompactionLlm` must forward the resolved
 * `upstreamProtocol` from its `ModelRouteConfig` to `runUpstreamGenerate`.
 *
 * Prior to the fix, every compaction call silently degraded into the AI
 * SDK's default `chat_completions` protocol — breaking users on
 * `anthropic_messages` and OpenAI `responses` (GPT-5 / o-series). Long
 * sessions are the most common trigger because compaction fires
 * automatically on context pressure, so a regression here is silent and
 * extremely user-visible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return {
    ...actual,
    runUpstreamGenerate: mocks.runUpstreamGenerate,
  };
});

import { callCompactionLlm } from '../../compaction/compaction-llm.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

function createRoute(overrides?: Partial<ModelRouteConfig>): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'gpt-4o-mini',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.openai.com/v1',
    apiKey: overrides?.apiKey ?? 'sk-test',
    maxTokens: overrides?.maxTokens ?? 1024,
    temperature: overrides?.temperature ?? 0,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'chat_completions',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: overrides?.supportsThinking ?? false,
    providerType: overrides?.providerType ?? 'openai',
  };
}

describe('callCompactionLlm — upstreamProtocol forwarding', () => {
  beforeEach(() => {
    mocks.runUpstreamGenerate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards anthropic_messages so the AI SDK targets the native API', async () => {
    mocks.runUpstreamGenerate.mockResolvedValue({
      text: 'summary text',
      inputTokens: 100,
      outputTokens: 20,
      finishReason: 'stop',
    });

    await callCompactionLlm({
      route: createRoute({
        upstreamProtocol: 'anthropic_messages',
        providerType: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        apiBaseUrl: 'https://api.anthropic.com/v1',
      }),
      conversationMessages: [{ role: 'user', content: 'hello' }],
    });

    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { providerType?: string; upstreamProtocol?: string } | undefined;
    expect(callArgs?.providerType).toBe('anthropic');
    expect(callArgs?.upstreamProtocol).toBe('anthropic_messages');
  });

  it('forwards responses for OpenAI providers configured for the Responses API', async () => {
    mocks.runUpstreamGenerate.mockResolvedValue({
      text: 'summary',
      inputTokens: 0,
      outputTokens: 0,
      finishReason: 'stop',
    });

    await callCompactionLlm({
      route: createRoute({ upstreamProtocol: 'responses' }),
      conversationMessages: [{ role: 'user', content: 'hi' }],
    });

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { upstreamProtocol?: string } | undefined;
    expect(callArgs?.upstreamProtocol).toBe('responses');
  });
});
