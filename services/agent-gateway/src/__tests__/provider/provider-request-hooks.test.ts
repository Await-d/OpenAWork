/**
 * 不变量回归：「所有出站模型请求必须经过同一套 hook 链」。
 *
 * 1. `resolveModelRoute()` 的 env 回退路径与 provider 选择 / 压缩路径一样，
 *    执行 `request.headers` / `request.body`（咽喉点：model-router 的
 *    `applyProviderRequestHooks`）。
 * 2. 非流式 `runUpstreamGenerate()` 与流式 `runUpstreamStream()` 一样派发
 *    `chat.params`。
 */
import { Effect, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import * as OpenAI from '@openAwork/opencode-llm/providers/openai';
import type { AIProvider } from '@openAwork/agent-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProviderPlugin, type RequestBodyContext } from '../../provider/provider-plugin.js';
import { resolveModelRoute, resolveModelRouteFromProvider } from '../../provider/model-router.js';
import { _registerPluginForTest, _resetPluginsForTest } from '../../runtime/plugin-host.js';
import { runUpstreamGenerate } from '../../v2-runtime/upstream/run-upstream-generate.js';
import { runUpstreamStream } from '../../v2-runtime/upstream/stream-runner.js';
import '../../provider/plugins/index.js';

const buildProvider = (input: Partial<AIProvider> & Pick<AIProvider, 'type'>): AIProvider => ({
  id: input.id ?? 'test-provider',
  name: input.name ?? 'test-provider',
  enabled: true,
  baseUrl: 'https://example.test/v1',
  defaultModels: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...input,
});

const nativeResponse = () =>
  new OpenCodeLLM.LLMResponse({
    message: OpenCodeLLM.Message.assistant('hello'),
    events: [
      OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'hello' }),
      OpenCodeLLM.LLMEvent.finish({
        reason: 'stop',
        usage: new OpenCodeLLM.Usage({ inputTokens: 3, outputTokens: 5, totalTokens: 8 }),
      }),
    ],
    usage: new OpenCodeLLM.Usage({ inputTokens: 3, outputTokens: 5, totalTokens: 8 }),
    finishReason: 'stop',
  });

afterEach(() => {
  _resetPluginsForTest();
  vi.restoreAllMocks();
});

describe('resolveModelRoute() 回退路径执行 request.headers', () => {
  it('内置 anthropic 模型注入 anthropic-beta 头', () => {
    const route = resolveModelRoute({
      model: 'claude-opus-4-0',
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.providerType).toBe('anthropic');
    expect(route.requestOverrides.headers?.['anthropic-beta']).toContain(
      'interleaved-thinking-2025-05-14',
    );
  });

  it('内置 openrouter 模型注入 X-Title / HTTP-Referer', () => {
    const route = resolveModelRoute({
      model: 'anthropic/claude-sonnet-4-0',
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.providerType).toBe('openrouter');
    expect(route.requestOverrides.headers).toMatchObject({
      'X-Title': 'OpenAWork',
      'HTTP-Referer': 'https://openAwork.local',
    });
  });

  it('未命中内置索引的 claude 变体仍按 anthropic 注入头', () => {
    const route = resolveModelRoute({
      model: 'claude-3-5-sonnet-latest',
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.providerType).toBe('anthropic');
    expect(route.requestOverrides.headers?.['anthropic-beta']).toBeDefined();
  });

  it('provider 配置的 headers 与插件头合并，插件值优先', () => {
    const provider = buildProvider({
      type: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      requestOverrides: { headers: { 'X-Title': 'Custom', 'X-Custom': 'keep' } },
      defaultModels: [{ id: 'x/y', label: 'X', enabled: true }],
    });

    const route = resolveModelRouteFromProvider(provider, 'x/y', {
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.requestOverrides.headers?.['X-Custom']).toBe('keep');
    expect(route.requestOverrides.headers?.['HTTP-Referer']).toBe('https://openAwork.local');
    expect(route.requestOverrides.headers?.['X-Title']).toBe('OpenAWork');
  });
});

describe('request.body hook 接线', () => {
  it('插件 body 字段合并进 requestOverrides.body 并抵达非流式上游 http.body', async () => {
    registerProviderPlugin({
      providerType: 'custom',
      name: 'test-request-body',
      hooks: {
        'request.body': ({ body }: RequestBodyContext) => {
          body['service_tier'] = 'flex';
        },
      },
    });

    const provider = buildProvider({ type: 'custom', apiKey: 'test-key' });
    const route = resolveModelRouteFromProvider(provider, 'stub-model', {
      maxTokens: 512,
      temperature: 1,
    });
    expect(route.requestOverrides.body).toEqual({ service_tier: 'flex' });

    const generateSpy = vi.spyOn(OpenCodeLLM.LLMClient, 'generate');
    generateSpy.mockReturnValue(Effect.succeed(nativeResponse()));

    await Effect.runPromise(
      runUpstreamGenerate({
        providerType: 'custom',
        model: route.model,
        baseURL: route.apiBaseUrl,
        messages: [OpenCodeLLM.Message.user('ping')],
        requestOverrides: route.requestOverrides,
      }),
    );

    const request = generateSpy.mock.calls[0]?.[0];
    expect(request?.http?.body).toEqual({ service_tier: 'flex' });
  });

  it('同一份 requestOverrides 在流式路径也抵达 http.body', async () => {
    registerProviderPlugin({
      providerType: 'custom',
      name: 'test-request-body-stream',
      hooks: {
        'request.body': ({ body }: RequestBodyContext) => {
          body['service_tier'] = 'flex';
        },
      },
    });

    const provider = buildProvider({ type: 'custom', apiKey: 'test-key' });
    const route = resolveModelRouteFromProvider(provider, 'stub-model', {
      maxTokens: 512,
      temperature: 1,
    });

    let request: OpenCodeLLM.LLMRequest | undefined;
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockImplementation((value) => {
      request = value;
      return Stream.fromIterable([OpenCodeLLM.LLMEvent.finish({ reason: 'stop' })]);
    });

    await Effect.runPromise(
      Stream.runDrain(
        runUpstreamStream({
          model: OpenAI.chat('stub-model'),
          messages: [OpenCodeLLM.Message.user('q')],
          requestOverrides: route.requestOverrides,
        }),
      ),
    );

    expect(request?.http?.body).toEqual({ service_tier: 'flex' });
  });
});

describe('runUpstreamGenerate() 派发 chat.params', () => {
  it('插件设置的采样参数在非流式路径生效，sessionID 缺省为空串', async () => {
    const seen: Array<{ sessionID: string; modelId: string }> = [];
    _registerPluginForTest('test-chat-params', {
      'chat.params': (input, output) => {
        seen.push({ sessionID: input.sessionID, modelId: input.modelId });
        output.temperature = 0;
        output.maxOutputTokens = 77;
        output.options['presencePenalty'] = 0.5;
      },
    });

    const generateSpy = vi.spyOn(OpenCodeLLM.LLMClient, 'generate');
    generateSpy.mockReturnValue(Effect.succeed(nativeResponse()));

    await Effect.runPromise(
      runUpstreamGenerate({
        providerType: 'openai',
        model: 'stub-model',
        baseURL: 'https://example.test/v1',
        messages: [OpenCodeLLM.Message.user('ping')],
        temperature: 0.9,
        maxOutputTokens: 500,
      }),
    );

    const request = generateSpy.mock.calls[0]?.[0];
    expect(request?.generation).toMatchObject({
      temperature: 0,
      maxTokens: 77,
      presencePenalty: 0.5,
    });
    expect(seen).toEqual([{ sessionID: '', modelId: 'stub-model' }]);
  });

  it('传入 sessionId 时按约定派发，插件未改动时保持调用方参数', async () => {
    const seen: string[] = [];
    _registerPluginForTest('test-chat-params-recorder', {
      'chat.params': (input) => {
        seen.push(input.sessionID);
      },
    });

    const generateSpy = vi.spyOn(OpenCodeLLM.LLMClient, 'generate');
    generateSpy.mockReturnValue(Effect.succeed(nativeResponse()));

    await Effect.runPromise(
      runUpstreamGenerate({
        providerType: 'openai',
        model: 'stub-model',
        baseURL: 'https://example.test/v1',
        messages: [OpenCodeLLM.Message.user('ping')],
        sessionId: 's-42',
        temperature: 0.3,
        maxOutputTokens: 42,
      }),
    );

    expect(seen).toEqual(['s-42']);
    const request = generateSpy.mock.calls[0]?.[0];
    expect(request?.generation).toMatchObject({ temperature: 0.3, maxTokens: 42 });
  });

  it('流式路径共用同一合并语义（重构回归）', async () => {
    _registerPluginForTest('test-chat-params-stream', {
      'chat.params': (_input, output) => {
        output.temperature = 0;
        output.options['presencePenalty'] = 0.25;
      },
    });

    let request: OpenCodeLLM.LLMRequest | undefined;
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockImplementation((value) => {
      request = value;
      return Stream.fromIterable([OpenCodeLLM.LLMEvent.finish({ reason: 'stop' })]);
    });

    await Effect.runPromise(
      Stream.runDrain(
        runUpstreamStream({
          model: OpenAI.chat('test-model'),
          messages: [OpenCodeLLM.Message.user('q')],
          temperature: 0.7,
          requestOverrides: { temperature: 0.2, maxTokens: 123 },
        }),
      ),
    );

    expect(request?.generation?.temperature).toBe(0);
    expect(request?.generation?.maxTokens).toBe(123);
    expect(request?.generation?.presencePenalty).toBe(0.25);
  });
});
