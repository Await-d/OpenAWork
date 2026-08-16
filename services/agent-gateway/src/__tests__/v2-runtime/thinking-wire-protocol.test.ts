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
    expect(prepared.body).toMatchObject({
      thinking: { type: 'enabled', budget_tokens: 16_384 },
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
});
