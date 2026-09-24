import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Chat from '../openai-chat.js';
import * as OpenAICompatibleChat from '../openai-compatible-chat.js';
import { Route } from '../../route/client.js';
import { Endpoint } from '../../route/endpoint.js';
import { Auth } from '../../route/auth.js';
import { Framing } from '../../route/framing.js';
import {
  GenerationOptions,
  LLMRequest,
  Message,
  ToolCallPart,
  ToolChoice,
  ToolDefinition,
  type ModelCompatibility,
} from '../../schema/index.js';

/**
 * 请求侧兼容 shaping 对齐（对齐 opencode 参考库）：
 * - `max_tokens` vs `max_completion_tokens` 探测与显式覆盖；
 * - `store` / `strict` / `stream_options` 的 provider 探测；
 * - 工具调用 ID 归一化（Mistral / Claude / OpenAI）；
 * - `requireAssistantAfterTool` 桥接；
 * - 路由 `providerMetadataKey` 命名空间（显式 key 粘性 + provider 回退）。
 */

interface LowerOptions {
  readonly provider?: string;
  readonly baseURL?: string;
  readonly id?: string;
  readonly compatibility?: ModelCompatibility.Input;
  readonly maxTokens?: number;
  readonly providerOptions?: Record<string, Record<string, unknown>>;
  readonly messages?: ReadonlyArray<Message>;
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly promptCacheKey?: string;
  readonly cache?: 'auto' | 'none';
  readonly toolChoice?: ToolChoice.Input;
}

const lower = async (options?: LowerOptions) => {
  const route = Chat.route.with({
    ...(options?.provider === undefined ? {} : { provider: options.provider }),
    ...(options?.baseURL === undefined ? {} : { endpoint: { baseURL: options.baseURL } }),
  });
  const request = new LLMRequest({
    model: route.model({
      id: options?.id ?? 'gpt-4.1',
      ...(options?.compatibility === undefined ? {} : { compatibility: options.compatibility }),
    }),
    system: [],
    messages: [...(options?.messages ?? [])],
    tools: [...(options?.tools ?? [])],
    ...(options?.maxTokens === undefined
      ? {}
      : { generation: GenerationOptions.make({ maxTokens: options.maxTokens }) }),
    ...(options?.promptCacheKey === undefined ? {} : { promptCacheKey: options.promptCacheKey }),
    ...(options?.cache === undefined ? {} : { cache: options.cache }),
    ...(options?.toolChoice === undefined
      ? {}
      : { toolChoice: ToolChoice.make(options.toolChoice) }),
    ...(options?.providerOptions === undefined ? {} : { providerOptions: options.providerOptions }),
  });
  return Effect.runPromise(Chat.protocol.body.from(request));
};

const testTool = ToolDefinition.make({
  name: 'read_file',
  description: '读取文件',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
});

const toolCallMessage = (id: string) =>
  Message.make({
    role: 'assistant',
    content: [ToolCallPart.make({ id, name: 'read_file', input: { path: 'a.ts' } })],
  });

describe('OpenAI Chat 请求侧兼容 shaping', () => {
  it('原生 OpenAI 默认使用 max_completion_tokens', async () => {
    const body = await lower({ maxTokens: 512 });

    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
  });

  it('DeepSeek 系（provider / baseURL）仍使用 max_tokens', async () => {
    const byProvider = await lower({ provider: 'deepseek', id: 'deepseek-chat', maxTokens: 512 });
    expect(byProvider.max_tokens).toBe(512);
    expect(byProvider.max_completion_tokens).toBeUndefined();

    const byBaseURL = await lower({
      baseURL: 'https://api.deepseek.com/v1',
      maxTokens: 512,
    });
    expect(byBaseURL.max_tokens).toBe(512);
    expect(byBaseURL.max_completion_tokens).toBeUndefined();
  });

  it('显式 maxTokensField 覆盖探测结果', async () => {
    const body = await lower({
      maxTokens: 256,
      compatibility: { maxTokensField: 'max_tokens' },
    });

    expect(body.max_tokens).toBe(256);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('自定义中转（custom）保守使用 max_tokens / 不发 store / 不发 strict', async () => {
    const body = await lower({ provider: 'custom', maxTokens: 512, tools: [testTool] });

    expect(body.max_tokens).toBe(512);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.store).toBeUndefined();
    expect(body.tools?.[0]?.function.strict).toBeUndefined();
  });

  it('zaiToolStream：ZAI/Zhipu 命中且有可用工具时下发 tool_stream', async () => {
    const zai = await lower({ provider: 'zhipu', id: 'glm-5', tools: [testTool] });
    expect(zai.tool_stream).toBe(true);

    const byUrl = await lower({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      id: 'glm-5',
      tools: [testTool],
    });
    expect(byUrl.tool_stream).toBe(true);

    // GLM 4.5 系列不支持。
    const glm45 = await lower({ provider: 'zhipu', id: 'glm-4.5', tools: [testTool] });
    expect(glm45.tool_stream).toBeUndefined();

    // 无工具 / 非 ZAI / tool_choice: none 均不下发。
    const noTools = await lower({ provider: 'zhipu', id: 'glm-5' });
    expect(noTools.tool_stream).toBeUndefined();

    const nonZai = await lower({ provider: 'openai', id: 'gpt-4.1', tools: [testTool] });
    expect(nonZai.tool_stream).toBeUndefined();

    const disabled = await lower({
      provider: 'zhipu',
      id: 'glm-5',
      tools: [testTool],
      toolChoice: { type: 'none' },
    });
    expect(disabled.tool_stream).toBeUndefined();
  });

  it('strict 按 provider 探测：OpenAI 下发 strict:false，Moonshot 省略', async () => {
    const openai = await lower({ tools: [testTool] });
    expect(openai.tools?.[0]?.function.strict).toBe(false);

    const moonshot = await lower({ provider: 'moonshotai', id: 'kimi-k2', tools: [testTool] });
    expect(moonshot.tools?.[0]?.function.strict).toBeUndefined();
  });

  it('store 按 provider 探测：OpenAI 默认 store:false，DeepSeek 省略，显式值优先', async () => {
    const openai = await lower({});
    expect(openai.store).toBe(false);

    const deepseek = await lower({ provider: 'deepseek', id: 'deepseek-chat' });
    expect(deepseek.store).toBeUndefined();

    const explicit = await lower({ providerOptions: { openai: { store: true } } });
    expect(explicit.store).toBe(true);

    const explicitUnsupported = await lower({
      provider: 'deepseek',
      id: 'deepseek-chat',
      providerOptions: { openai: { store: true } },
    });
    expect(explicitUnsupported.store).toBeUndefined();
  });

  it('supportsUsageInStreaming=false 时省略 stream_options', async () => {
    const body = await lower({ compatibility: { supportsUsageInStreaming: false } });
    expect(body.stream_options).toBeUndefined();
  });

  it('prompt_cache_key 仅在显式支持时下发，并截断到 64 字符', async () => {
    const disabled = await lower({ promptCacheKey: 'session-1' });
    expect(disabled.prompt_cache_key).toBeUndefined();

    const enabled = await lower({
      promptCacheKey: 'session-1',
      compatibility: { supportsPromptCacheKey: true },
    });
    expect(enabled.prompt_cache_key).toBe('session-1');

    const clamped = await lower({
      promptCacheKey: 'x'.repeat(80),
      compatibility: { supportsPromptCacheKey: true },
    });
    expect(clamped.prompt_cache_key).toBe('x'.repeat(64));

    const cacheNone = await lower({
      promptCacheKey: 'session-1',
      cache: 'none',
      compatibility: { supportsPromptCacheKey: true },
    });
    expect(cacheNone.prompt_cache_key).toBeUndefined();
  });

  it('工具调用 ID 归一化：OpenAI 截断到 40 字符且 tool_call_id 同步', async () => {
    const longId = `call_${'x'.repeat(60)}`;
    const body = await lower({
      provider: 'openai',
      messages: [
        toolCallMessage(longId),
        Message.tool({ id: longId, name: 'read_file', result: 'ok' }),
      ],
    });

    const expected = longId.slice(0, 40);
    const assistant = body.messages.find((message) => message.role === 'assistant');
    const tool = body.messages.find((message) => message.role === 'tool');
    expect(assistant?.tool_calls?.[0]?.id).toBe(expected);
    expect(tool?.tool_call_id).toBe(expected);
  });

  it('工具调用 ID 归一化：Claude 字符集替换', async () => {
    const body = await lower({
      id: 'claude-sonnet-4',
      provider: 'anthropic',
      messages: [
        toolCallMessage('call:1/2'),
        Message.tool({ id: 'call:1/2', name: 'read_file', result: 'ok' }),
      ],
    });

    const assistant = body.messages.find((message) => message.role === 'assistant');
    expect(assistant?.tool_calls?.[0]?.id).toBe('call_1_2');
  });

  it('工具调用 ID 归一化：Mistral 9 位字母数字', async () => {
    const body = await lower({
      id: 'mistral-large-latest',
      messages: [
        toolCallMessage('call-1'),
        Message.tool({ id: 'call-1', name: 'read_file', result: 'ok' }),
      ],
    });

    const assistant = body.messages.find((message) => message.role === 'assistant');
    expect(assistant?.tool_calls?.[0]?.id).toBe('call10000');
  });

  it('requireAssistantAfterTool 在工具结果后桥接 assistant 消息', async () => {
    const messages = [
      toolCallMessage('call_1'),
      Message.tool({ id: 'call_1', name: 'read_file', result: 'ok' }),
      Message.user('继续'),
    ];

    const without = await lower({ messages });
    expect(without.messages.map((message) => message.role)).toEqual(['assistant', 'tool', 'user']);

    const withBridge = await lower({
      messages,
      compatibility: { requireAssistantAfterTool: true },
    });
    expect(withBridge.messages.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
    expect(withBridge.messages[2]?.content).toBe('Done.');
  });

  it('Mistral 模型自动启用 requireAssistantAfterTool', async () => {
    const body = await lower({
      id: 'devstral-medium',
      messages: [
        toolCallMessage('call_1'),
        Message.tool({ id: 'call_1', name: 'read_file', result: 'ok' }),
        Message.user('继续'),
      ],
    });

    expect(body.messages.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
  });
});

describe('OpenAI Chat providerMetadataKey', () => {
  it('openai-chat 家族固定使用 openai 命名空间（provider 覆盖不改写）', async () => {
    const request = new LLMRequest({
      model: Chat.route.with({ provider: 'deepseek' }).model({ id: 'deepseek-chat' }),
      system: [],
      messages: [],
      tools: [],
    });

    const state = Chat.protocol.stream.initial(request);
    expect(state.providerMetadataKey).toBe('openai');
  });

  it('显式 providerMetadataKey 覆盖生效', async () => {
    const request = new LLMRequest({
      model: Chat.route.with({ providerMetadataKey: 'custom-ns' }).model({ id: 'gpt-4.1' }),
      system: [],
      messages: [],
      tools: [],
    });

    expect(Chat.protocol.stream.initial(request).providerMetadataKey).toBe('custom-ns');
  });

  it('framing 形式的路由（openai-compatible）同样保留 providerMetadataKey', async () => {
    const request = new LLMRequest({
      model: OpenAICompatibleChat.route
        .with({ provider: 'deepseek', endpoint: { baseURL: 'https://api.deepseek.com/v1' } })
        .model({ id: 'deepseek-chat' }),
      system: [],
      messages: [],
      tools: [],
    });

    expect(Chat.protocol.stream.initial(request).providerMetadataKey).toBe('openai');
  });

  it('未显式配置的路由回退到 provider 字符串', async () => {
    const route = Route.make({
      id: 'custom-chat',
      provider: 'myprov',
      protocol: Chat.protocol,
      endpoint: Endpoint.path('/chat/completions', { baseURL: 'https://example.com/v1' }),
      auth: Auth.none,
      framing: Framing.sseWithDone,
    });
    const request = new LLMRequest({
      model: route.model({ id: 'my-model' }),
      system: [],
      messages: [],
      tools: [],
    });

    expect(Chat.protocol.stream.initial(request).providerMetadataKey).toBe('myprov');
  });
});
