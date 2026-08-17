import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { Auth } from '../../route/auth.js';
import type { HttpPrepared } from '../../route/transport/http.js';
import * as LLM from '../../llm.js';
import { ProviderOptions, type Model } from '../../schema/index.js';
import * as BedrockConverse from '../bedrock-converse.js';
import * as Gemini from '../gemini.js';
import * as OpenAIChat from '../openai-chat.js';
import * as OpenAIResponses from '../openai-responses.js';
import * as AnthropicMessages from '../anthropic-messages.js';
import { isAnthropicOfficialBaseUrl } from '../shared.js';

const contextManagement = {
  edits: [
    { type: 'clear_thinking_20251015', keep: { type: 'thinking_turns', value: 2 } },
    {
      type: 'clear_tool_uses_20250919',
      trigger: { type: 'input_tokens', value: 50_000 },
      keep: { type: 'tool_uses', value: 5 },
    },
  ],
} as const;

const requestFor = (model: Model, providerOptions: Record<string, unknown>) =>
  LLM.request({ model, prompt: 'hello', providerOptions: { anthropic: providerOptions } });

const preparedJson = (prepared: HttpPrepared<unknown>): unknown => {
  const body = prepared.request.body;
  if (body._tag !== 'Uint8Array') {
    throw new TypeError('Expected an encoded JSON request body');
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body.body));
  return parsed;
};

describe('Anthropic context-management projection', () => {
  it('projects official context management into the native body', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const request = LLM.request({
      model,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'thinking', encrypted: 'signature' },
            { type: 'tool-call', id: 'tool-1', name: 'search', input: { query: 'context' } },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              id: 'tool-1',
              name: 'search',
              result: { type: 'text', value: 'result' },
            },
          ],
        },
      ],
      providerOptions: { anthropic: { contextManagement } },
      http: { headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' } },
    });
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    expect(body).toHaveProperty('context_management', contextManagement);
    expect(body.messages[0]?.content).toContainEqual({
      type: 'thinking',
      thinking: 'thinking',
      signature: 'signature',
    });
    expect(body.messages[1]?.content).toContainEqual({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'result',
    });
    expect(preparedJson(prepared)).toHaveProperty('context_management', contextManagement);
    expect(prepared.request.headers['anthropic-beta']).toBe(
      'prompt-caching-2024-07-31,context-management-2025-06-27',
    );
  });

  it('strips Anthropic context-management body keys from a relay caller overlay', async () => {
    const model = AnthropicMessages.route
      .with({ endpoint: { baseURL: 'https://relay.example/v1' } })
      .model({
        id: 'claude-opus-5',
      });
    const request = LLM.request({
      model,
      prompt: 'hello',
      http: {
        body: {
          context_management: contextManagement,
          clear_thinking: { type: 'clear_thinking_20251015' },
          metadata: { request_id: 'keep-this-overlay' },
        },
      },
    });
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));
    const wireBody = preparedJson(prepared);

    expect(wireBody).not.toHaveProperty('context_management');
    expect(wireBody).not.toHaveProperty('clear_thinking');
    expect(wireBody).toHaveProperty('metadata', { request_id: 'keep-this-overlay' });
  });

  it('strips a relay caller context-management beta while preserving other beta values', async () => {
    const model = AnthropicMessages.route
      .with({ endpoint: { baseURL: 'https://relay.example/v1' } })
      .model({
        id: 'claude-opus-5',
      });
    const request = LLM.request({
      model,
      prompt: 'hello',
      http: {
        headers: {
          'anthropic-beta': 'prompt-caching-2024-07-31,context-management-2025-06-27',
          'x-caller-header': 'keep-this-header',
        },
      },
    });
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    expect(prepared.request.headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
    expect(prepared.request.headers['x-caller-header']).toBe('keep-this-header');
  });

  it.each([
    [
      'Anthropic relay',
      AnthropicMessages.route.with({ endpoint: { baseURL: 'https://relay.example/v1' } }),
    ],
    [
      'MiMo relay',
      AnthropicMessages.route.with({
        provider: 'mimo',
        endpoint: { baseURL: 'https://api.xiaomimimo.com/anthropic/v1' },
      }),
    ],
    [
      'custom route on the official host',
      AnthropicMessages.route.with({
        provider: 'custom',
        endpoint: { baseURL: 'https://api.anthropic.com/v1' },
      }),
    ],
  ])('does not project the option for %s', async (_name, route) => {
    const model = route.model({ id: 'claude-opus-5' });
    const request = requestFor(model, { contextManagement });
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    expect(body).not.toHaveProperty('context_management');
    expect(preparedJson(prepared)).not.toHaveProperty('context_management');
    expect(prepared.request.headers['anthropic-beta']).toBeUndefined();
  });

  it('does not project an absent option on the official route', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const request = requestFor(model, {});
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    expect(preparedJson(prepared)).not.toHaveProperty('context_management');
    expect(prepared.request.headers['anthropic-beta']).toBeUndefined();
  });

  it.each([
    ['OpenAI Chat', OpenAIChat.route.model({ id: 'gpt-4.1' })],
    ['OpenAI Responses', OpenAIResponses.route.model({ id: 'gpt-5' })],
    ['Gemini', Gemini.route.model({ id: 'gemini-2.5-pro' })],
    [
      'Bedrock',
      BedrockConverse.route
        .with({
          endpoint: { baseURL: 'https://bedrock-runtime.us-east-1.amazonaws.com' },
          auth: Auth.none,
        })
        .model({ id: 'anthropic.claude-sonnet-4' }),
    ],
  ])('does not project Anthropic fields through %s', async (_name, model) => {
    const request = requestFor(model, { contextManagement });
    const body = await Effect.runPromise(model.route.body.from(request));
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    expect(preparedJson(prepared)).not.toHaveProperty('context_management');
    expect(prepared.request.headers['anthropic-beta']).toBeUndefined();
  });

  it('rejects an invalid context-management edit at the provider-options boundary', () => {
    const decode = Schema.decodeUnknownSync(ProviderOptions);

    expect(() =>
      decode({ anthropic: { contextManagement: { edits: [{ type: 'unsupported_edit' }] } } }),
    ).toThrow();
  });
});

describe('isAnthropicOfficialBaseUrl', () => {
  it.each([
    undefined,
    'https://api.anthropic.com',
    'https://api.anthropic.com/v1',
    'https://api.anthropic.com/v1/',
  ])('accepts the official Anthropic endpoint %s', (baseURL) => {
    expect(isAnthropicOfficialBaseUrl(baseURL)).toBe(true);
  });

  it.each([
    'http://api.anthropic.com/v1',
    'https://api.anthropic.com.evil.example/v1',
    'https://relay.example/v1',
    'not a URL',
  ])('rejects a non-official endpoint %s', (baseURL) => {
    expect(isAnthropicOfficialBaseUrl(baseURL)).toBe(false);
  });
});
