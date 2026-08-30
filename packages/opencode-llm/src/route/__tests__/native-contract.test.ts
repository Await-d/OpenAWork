import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import { LLMClient, LLMRequest, Message, Model, RequestExecutor } from '../../index.js';
import { Auth } from '../../route/auth.js';
import * as OpenAI from '../../providers/openai.js';
import { HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';

const makeRequest = () => {
  const model = OpenAI.configure({ auth: Auth.none }).chat('contract-test');
  return new LLMRequest({
    model,
    system: [],
    messages: [Message.user('hello')],
    tools: [],
  });
};

describe('native Effect contract', () => {
  it('constructs a real Model and LLMRequest through the public root', () => {
    const request = makeRequest();

    expect(request.model).toBeInstanceOf(Model);
    expect(request.model.id).toBe('contract-test');
    expect(request.messages[0]?.role).toBe('user');
  });

  it('prepares a native request without a Promise or AI SDK adapter', async () => {
    const prepared = await Effect.runPromise(LLMClient.prepare(makeRequest()));

    expect(prepared.route).toBe('openai-chat');
    expect(prepared.protocol).toBe('openai-chat');
    expect(prepared.body).toMatchObject({ model: 'contract-test', stream: true });
  });

  it('serializes OpenAI priority service tier for Chat Completions', async () => {
    const model = OpenAI.configure({
      auth: Auth.none,
      providerOptions: { openai: { serviceTier: 'priority' } },
    }).chat('contract-test');
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
    });

    const prepared = await Effect.runPromise(LLMClient.prepare(request));

    expect(prepared.body).toMatchObject({ service_tier: 'priority' });
  });

  it('serializes OpenAI priority service tier for Responses', async () => {
    const model = OpenAI.configure({
      auth: Auth.none,
      providerOptions: { openai: { serviceTier: 'priority' } },
    }).responses('contract-test');
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
    });

    const prepared = await Effect.runPromise(LLMClient.prepare(request));

    expect(prepared.body).toMatchObject({ service_tier: 'priority' });
  });

  it('serializes the official GPT-5.6 max reasoning effort for Responses', async () => {
    const model = OpenAI.configure({
      auth: Auth.none,
      providerOptions: { openai: { reasoningEffort: 'max' } },
    }).responses('gpt-5.6-sol');
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
    });

    const prepared = await Effect.runPromise(LLMClient.prepare(request));

    expect(prepared.body).toMatchObject({ reasoning: { effort: 'max' } });
  });

  it('serializes the official GPT-5.6 max reasoning effort for Chat Completions', async () => {
    const model = OpenAI.configure({
      auth: Auth.none,
      providerOptions: { openai: { reasoningEffort: 'max' } },
    }).chat('gpt-5.6-sol');
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
    });

    const prepared = await Effect.runPromise(LLMClient.prepare(request));

    expect(prepared.body).toMatchObject({ reasoning_effort: 'max' });
  });

  it('uses the official none default for GPT-5.4 Responses', async () => {
    const model = OpenAI.configure({ auth: Auth.none }).responses('gpt-5.4');
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
    });

    const prepared = await Effect.runPromise(LLMClient.prepare(request));

    expect(prepared.body).toMatchObject({ reasoning: { effort: 'none' } });
  });

  it('uses the official none default across GPT-5.1 and GPT-5.2 Responses', async () => {
    for (const modelId of ['gpt-5.1', 'gpt-5.2']) {
      const model = OpenAI.configure({ auth: Auth.none }).responses(modelId);
      const request = new LLMRequest({
        model,
        system: [],
        messages: [Message.user('hello')],
        tools: [],
      });

      const prepared = await Effect.runPromise(LLMClient.prepare(request));

      expect(prepared.body).toMatchObject({ reasoning: { effort: 'none' } });
    }
  });

  it('keeps the medium default for GPT-5.5 and GPT-5.6 Responses', async () => {
    for (const modelId of ['gpt-5.5', 'gpt-5.6-sol']) {
      const model = OpenAI.configure({ auth: Auth.none }).responses(modelId);
      const request = new LLMRequest({
        model,
        system: [],
        messages: [Message.user('hello')],
        tools: [],
      });

      const prepared = await Effect.runPromise(LLMClient.prepare(request));

      expect(prepared.body).toMatchObject({ reasoning: { effort: 'medium' } });
    }
  });

  it('uses the official defaults for versioned GPT-5 Pro models', async () => {
    const cases = [
      ['gpt-5.4-pro', 'medium'],
      ['gpt-5.5-pro', 'high'],
    ] as const;

    for (const [modelId, effort] of cases) {
      const model = OpenAI.configure({ auth: Auth.none }).responses(modelId);
      const request = new LLMRequest({
        model,
        system: [],
        messages: [Message.user('hello')],
        tools: [],
      });

      const prepared = await Effect.runPromise(LLMClient.prepare(request));

      expect(prepared.body).toMatchObject({ reasoning: { effort } });
    }
  });

  it('composes LLMClient.layer with RequestExecutor.fetchLayer', async () => {
    const methods = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* LLMClient.Service;
        return Object.keys(client).sort();
      }).pipe(Effect.provide(LLMClient.layer), Effect.provide(RequestExecutor.fetchLayer)),
    );

    expect(methods).toEqual(['generate', 'prepare', 'stream']);
  });

  it('exposes the RequestExecutor interface as a native Effect service', () => {
    const request = HttpClientRequest.get('https://example.com');
    const service = Layer.succeed(RequestExecutor.Service, {
      execute: () => Effect.succeed(HttpClientResponse.empty({ status: 204, request })),
    });

    expect(service).toBeDefined();
  });
});
