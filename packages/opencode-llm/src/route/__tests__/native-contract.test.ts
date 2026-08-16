import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import {
  LLMClient,
  LLMRequest,
  Message,
  Model,
  RequestExecutor,
} from '../../index.js';
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
