import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { AIProvider } from '@openAwork/agent-core';

// 仅 mock 上游单发调用，其余(路由解析/错误分类)走真实实现，以验证端到端归类。
const runUpstreamGenerate = vi.fn();
vi.mock('../../v2-runtime/upstream/index.js', () => ({
  runUpstreamGenerate: (...args: unknown[]) => runUpstreamGenerate(...args),
}));

const { testProviderConnectivity } = await import('../../provider/provider-connectivity-test.js');

function buildProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  const now = new Date().toISOString();
  return {
    id: 'mimo',
    type: 'mimo',
    name: 'Xiaomi MiMo',
    enabled: true,
    baseUrl: 'https://api.xiaomimimo.com/v1',
    apiKey: 'sk-test',
    defaultModels: [
      { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', enabled: true, supportsTools: true },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('testProviderConnectivity', () => {
  afterEach(() => {
    runUpstreamGenerate.mockReset();
  });

  it('上游成功 → ok，并带回 latency/outputTokens', async () => {
    runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'pong',
        inputTokens: 3,
        outputTokens: 1,
        finishReason: 'stop',
        raw: {},
      }),
    );

    const result = await testProviderConnectivity({
      provider: buildProvider(),
      modelId: 'mimo-v2.5-pro',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.outputTokens).toBe(1);
    expect(result.baseUrl).toBe('https://api.xiaomimimo.com/v1');
    expect(runUpstreamGenerate).toHaveBeenCalledTimes(1);
  });

  it('缺少 API Key → 直接判定 auth_error，不发起上游调用', async () => {
    const result = await testProviderConnectivity({
      provider: buildProvider({ apiKey: undefined, apiKeyEnv: undefined }),
      modelId: 'mimo-v2.5-pro',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('auth_error');
    expect(runUpstreamGenerate).not.toHaveBeenCalled();
  });

  it('401 错误 → auth_error', async () => {
    runUpstreamGenerate.mockReturnValue(
      Effect.fail(new Error('Request failed: 401 Unauthorized (invalid api key)')),
    );

    const result = await testProviderConnectivity({
      provider: buildProvider(),
      modelId: 'mimo-v2.5-pro',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('auth_error');
  });

  it('429 限流 → rate_limited', async () => {
    runUpstreamGenerate.mockReturnValue(
      Effect.fail(new Error('429 Too Many Requests: rate limit exceeded')),
    );

    const result = await testProviderConnectivity({
      provider: buildProvider(),
      modelId: 'mimo-v2.5-pro',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('rate_limited');
  });

  it('其它错误 → error，并保留原始信息', async () => {
    runUpstreamGenerate.mockReturnValue(Effect.fail(new Error('boom something broke')));

    const result = await testProviderConnectivity({
      provider: buildProvider(),
      modelId: 'mimo-v2.5-pro',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('error');
    expect(result.message).toContain('boom something broke');
  });

  it('404 Not Found → not_found，并提示 Base URL 与协议不匹配', async () => {
    runUpstreamGenerate.mockReturnValue(Effect.fail(new Error('Not Found')));

    const result = await testProviderConnectivity({
      provider: buildProvider({
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
        upstreamProtocol: 'chat_completions',
      }),
      modelId: 'mimo-v2.5-pro',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_found');
    expect(result.message).toContain('Base URL');
  });

  it('向上游透传 requestOverrides(含 GPT-5 的 omitBodyKeys: temperature)，避免误报', async () => {
    runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
        raw: {},
      }),
    );

    const provider = buildProvider({
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      defaultModels: [{ id: 'gpt-5.1', label: 'GPT-5.1', enabled: true, supportsTools: true }],
    });

    await testProviderConnectivity({ provider, modelId: 'gpt-5.1' });

    expect(runUpstreamGenerate).toHaveBeenCalledTimes(1);
    const callArg = runUpstreamGenerate.mock.calls[0]?.[0] as {
      requestOverrides?: { omitBodyKeys?: string[] };
      model?: string;
    };
    // gpt-5 家族会被 buildRequestOverrides 自动加入 omitBodyKeys: ['temperature']。
    expect(callArg.requestOverrides?.omitBodyKeys).toContain('temperature');
    expect(callArg.model).toBe('gpt-5.1');
  });
});
