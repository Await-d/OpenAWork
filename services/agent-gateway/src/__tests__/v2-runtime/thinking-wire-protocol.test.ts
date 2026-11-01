import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import {
  buildNativeModel,
  type UpstreamProtocolKind,
} from '../../v2-runtime/upstream/native-model.js';
import {
  buildBaseProviderOptions,
  buildProviderOptions,
  type ExtendedThinkingConfig,
} from '../../v2-runtime/upstream/provider-options.js';

interface PrepareThinkingRequestInput {
  readonly providerType: string;
  readonly upstreamProtocol: UpstreamProtocolKind;
  readonly model: string;
}

async function prepareWithUiThinking(input: PrepareThinkingRequestInput) {
  const thinking = {
    config: { type: 'enabled', budgetTokens: 16_384 },
    effort: 'high',
    providerType: input.providerType,
    supportsThinking: true,
  } satisfies ExtendedThinkingConfig;
  const model = buildNativeModel({
    ...input,
    apiKey: 'local-test-key',
  });
  const thinkingInput = {
    thinking,
    model: input.model,
    upstreamProtocol: input.upstreamProtocol,
  };
  const request = OpenCodeLLM.LLM.request({
    model,
    prompt: 'ping',
    providerOptions: buildProviderOptions(thinkingInput),
  });

  return Effect.runPromise(OpenCodeLLM.LLMClient.prepare(request));
}

async function prepareWithOpenAIFastMode(input: PrepareThinkingRequestInput) {
  const model = buildNativeModel({
    ...input,
    apiKey: 'local-test-key',
  });
  const request = OpenCodeLLM.LLM.request({
    model,
    prompt: 'ping',
    providerOptions: buildBaseProviderOptions({
      providerType: input.providerType,
      model: input.model,
      openaiFastMode: true,
    }),
  });

  return Effect.runPromise(OpenCodeLLM.LLMClient.prepare(request));
}

async function prepareWithDisabledThinking(input: PrepareThinkingRequestInput) {
  const thinking = {
    config: { type: 'disabled' },
    providerType: input.providerType,
    supportsThinking: true,
  } satisfies ExtendedThinkingConfig;
  const model = buildNativeModel({
    ...input,
    apiKey: 'local-test-key',
  });
  const request = OpenCodeLLM.LLM.request({
    model,
    prompt: 'ping',
    providerOptions: buildProviderOptions({
      thinking,
      model: input.model,
      upstreamProtocol: input.upstreamProtocol,
    }),
  });

  return Effect.runPromise(OpenCodeLLM.LLMClient.prepare(request));
}

describe('thinking wire protocol mapping', () => {
  it('forwards a UI high effort to DeepSeek Chat Completions', async () => {
    const input: PrepareThinkingRequestInput = {
      providerType: 'deepseek',
      upstreamProtocol: 'chat_completions',
      model: 'deepseek-chat',
    };

    const prepared = await prepareWithUiThinking(input);

    expect(prepared.route).toBe('openai-compatible-chat');
    expect(prepared.body).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    });
  });

  it('forwards a UI high effort to Gemini Chat Completions', async () => {
    const input: PrepareThinkingRequestInput = {
      providerType: 'gemini',
      upstreamProtocol: 'chat_completions',
      model: 'gemini-3-flash',
    };

    const prepared = await prepareWithUiThinking(input);

    expect(prepared.body).toMatchObject({
      google: {
        thinking_config: {
          include_thoughts: true,
          thinking_level: 'high',
        },
      },
    });
  });

  it('uses Anthropic thinking fields when the configured protocol is Anthropic Messages', async () => {
    const input: PrepareThinkingRequestInput = {
      providerType: 'openai',
      upstreamProtocol: 'anthropic_messages',
      model: 'claude-sonnet-4-5',
    };

    const prepared = await prepareWithUiThinking(input);

    expect(prepared.route).toBe('anthropic-messages');
    // 思考预算必须小于实际下发的 `max_tokens`（对齐 opencode 参考库的钳制）：
    // 该模型未配置输出上限，走 4096 回退，因此 16384 被压到一半 2048。
    // 需要更大思考预算的模型应显式配置输出上限。
    expect(prepared.body).toMatchObject({
      thinking: { type: 'enabled', budget_tokens: 2_048 },
    });
  });

  it('uses Responses reasoning fields when the configured protocol is Responses', async () => {
    const input: PrepareThinkingRequestInput = {
      providerType: 'anthropic',
      upstreamProtocol: 'responses',
      model: 'gpt-5.4',
    };

    const prepared = await prepareWithUiThinking(input);

    expect(prepared.route).toBe('openai-responses');
    expect(prepared.body).toMatchObject({ reasoning: { effort: 'high' } });
    expect(
      buildProviderOptions({
        thinking: {
          config: { type: 'enabled', budgetTokens: 16_384 },
          effort: 'high',
          providerType: 'anthropic',
          supportsThinking: true,
        },
        model: 'gpt-5.4',
        upstreamProtocol: 'responses',
      }),
    ).toMatchObject({
      openai: {
        reasoningEffort: 'high',
        reasoningSummary: 'auto',
        include: ['reasoning.encrypted_content'],
      },
    });
  });

  it('uses adaptive thinking only for MiniMax M3 on Anthropic Messages', async () => {
    const thinking = {
      config: { type: 'adaptive' },
      providerType: 'opencode-go',
      supportsThinking: true,
    } satisfies ExtendedThinkingConfig;
    const model = buildNativeModel({
      providerType: 'opencode-go',
      upstreamProtocol: 'anthropic_messages',
      model: 'minimax-m3',
      apiKey: 'local-test-key',
    });
    const request = OpenCodeLLM.LLM.request({
      model,
      prompt: 'ping',
      providerOptions: buildProviderOptions({
        thinking,
        model: 'minimax-m3',
        upstreamProtocol: 'anthropic_messages',
      }),
    });

    expect(request.providerOptions).toMatchObject({
      anthropic: { thinking: { type: 'adaptive' } },
    });
  });

  it('clamps opencode-go model effort through the real Responses request path', async () => {
    const prepared = await prepareWithUiThinking({
      providerType: 'opencode-go',
      upstreamProtocol: 'responses',
      model: 'kimi-k3',
    });

    expect(prepared.body).toMatchObject({
      reasoning: { effort: 'max' },
    });
  });

  it('forwards the OpenAI Fast mode setting to Chat Completions', async () => {
    const prepared = await prepareWithOpenAIFastMode({
      providerType: 'openai',
      upstreamProtocol: 'chat_completions',
      model: 'gpt-5.4',
    });

    expect(prepared.body).toMatchObject({ service_tier: 'priority' });
  });

  it('forwards the OpenAI Fast mode setting to Responses', async () => {
    const prepared = await prepareWithOpenAIFastMode({
      providerType: 'openai',
      upstreamProtocol: 'responses',
      model: 'gpt-5.4',
    });

    expect(prepared.body).toMatchObject({ service_tier: 'priority' });
  });

  it('forwards an explicit disabled toggle to DeepSeek (upstream defaults to enabled)', async () => {
    const prepared = await prepareWithDisabledThinking({
      providerType: 'deepseek',
      upstreamProtocol: 'chat_completions',
      model: 'deepseek-chat',
    });

    expect(prepared.body).toMatchObject({ thinking: { type: 'disabled' } });
    expect(prepared.body).not.toHaveProperty('reasoning_effort');
  });

  it('forwards an explicit disabled toggle to Anthropic Messages', async () => {
    const prepared = await prepareWithDisabledThinking({
      providerType: 'anthropic',
      upstreamProtocol: 'anthropic_messages',
      model: 'claude-sonnet-4-5',
    });

    expect(prepared.route).toBe('anthropic-messages');
    expect(prepared.body).toMatchObject({ thinking: { type: 'disabled' } });
  });

  it.each(['chat_completions', 'responses'] as const)(
    '支持 none 的模型在 %s 请求中显式关闭推理',
    async (upstreamProtocol) => {
      const prepared = await prepareWithDisabledThinking({
        providerType: 'openai',
        upstreamProtocol,
        model: 'gpt-5.1',
      });

      expect(
        buildProviderOptions({
          thinking: { type: 'disabled' },
          providerType: 'openai',
          upstreamProtocol,
          model: 'gpt-5.1',
        }),
      ).toMatchObject({ openai: { reasoningEffort: 'none' } });
      if (upstreamProtocol === 'responses') {
        expect(prepared.body).toMatchObject({ reasoning: { effort: 'none' } });
        expect(prepared.body).not.toHaveProperty('reasoning_effort');
      } else {
        expect(prepared.body).toMatchObject({ reasoning_effort: 'none' });
        expect(prepared.body).not.toHaveProperty('reasoning');
      }
    },
  );

  it('自定义模型明确声明支持 none 时下发关闭参数', () => {
    expect(
      buildProviderOptions({
        thinking: { config: { type: 'disabled' }, providerType: 'custom', supportsThinking: true },
        model: 'local-reasoner',
        reasoningOptions: [{ type: 'effort', values: ['none', 'high'] }],
      }),
    ).toMatchObject({ custom: { reasoning_effort: 'none' } });
  });

  it('模型声明不支持 none 时不能使用模型名称推断强行下发', () => {
    expect(
      buildProviderOptions({
        thinking: { config: { type: 'disabled' }, providerType: 'openai', supportsThinking: true },
        model: 'gpt-5.1',
        reasoningOptions: [{ type: 'effort', values: ['low', 'high'] }],
      }),
    ).toBeUndefined();
  });

  it.each(['gpt-5', 'gpt-5.1-codex', 'gpt-5.2-pro', 'unknown-reasoner'])(
    '不向不支持或未确认支持关闭的模型 %s 下发 none',
    (model) => {
      expect(
        buildProviderOptions({
          thinking: {
            config: { type: 'disabled' },
            providerType: 'openai',
            supportsThinking: true,
          },
          model,
        }),
      ).toBeUndefined();
    },
  );

  it('未声明关闭能力的旧版 OpenAI 模型保持省略参数', () => {
    expect(
      buildProviderOptions({
        thinking: { config: { type: 'disabled' }, providerType: 'openai', supportsThinking: true },
        model: 'gpt-5',
        upstreamProtocol: 'chat_completions',
      }),
    ).toBeUndefined();
  });
});
