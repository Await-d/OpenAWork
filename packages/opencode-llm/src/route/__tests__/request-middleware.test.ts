/**
 * 请求中间件契约测试（对齐上游 `StreamOptions.http` / `HttpMiddleware`）。
 *
 * 中间件的价值在于「在状态码分类之前」拿到原始响应：调用方据此做改写、短路
 * （缓存/重放）、或统一注入。三条不变量必须成立：
 * 1. 从 route → transport → executor 全程透传；
 * 2. 中间件抛错仍走 `LLMError` 分类（不能成为绕过错误处理的后门）；
 * 3. 不传中间件时行为与从前完全一致。
 */

import { describe, expect, it } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import * as Framing from '../framing.js';
import * as HttpTransport from '../transport/http.js';
import { RequestExecutor } from '../executor.js';
import type { HttpMiddleware } from '../executor.js';
import type { TransportRuntime } from '../transport/index.js';
import { LLMError, LLMRequest, Message, Model } from '../../schema/index.js';
import * as AnthropicMessages from '../../protocols/anthropic-messages.js';

const model = Model.make({ id: 'test-model', provider: 'test', route: AnthropicMessages.route });
const request = () =>
  new LLMRequest({ model, system: [], messages: [Message.user('hi')], tools: [] });

const response = (stream: Stream.Stream<Uint8Array, never> = Stream.empty, status = 200) =>
  ({
    status,
    headers: Headers.empty,
    stream,
    // `statusError` 在 4xx/5xx 时会读 `response.text` 取错误正文。
    text: Effect.succeed(status < 400 ? '' : '{"error":{"message":"boom"}}'),
  }) as unknown as HttpClientResponse.HttpClientResponse;

/** 假传输层：记录每次 http.execute 收到的请求。 */
const fakeHttpClient = (seen: Array<string>, status = 200) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((httpRequest) => {
      seen.push(httpRequest.url);
      return Effect.succeed(response(Stream.empty, status));
    }),
  );

const preparedWith = async (middleware?: HttpMiddleware) => {
  const initial = request();
  const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(initial));
  return Effect.runPromise(AnthropicMessages.route.prepareTransport(body, initial, middleware));
};

describe('StreamOptions.http 中间件', () => {
  it('route.prepareTransport 把中间件带进 prepared', async () => {
    const middleware: HttpMiddleware = (input, handler) => handler(input);

    const prepared = await preparedWith(middleware);

    expect(prepared.middleware).toBe(middleware);
  });

  it('不传中间件时 prepared 不带该字段（行为与从前一致）', async () => {
    const prepared = await preparedWith();

    expect(prepared.middleware).toBeUndefined();
  });

  it('frames 把中间件透传给 runtime.http.execute', async () => {
    const middleware: HttpMiddleware = (input, handler) => handler(input);
    const prepared = await preparedWith(middleware);
    const seen: Array<HttpMiddleware | undefined> = [];
    const runtime = {
      http: {
        execute: (input: HttpClientRequest.HttpClientRequest, next?: HttpMiddleware) => {
          seen.push(next);
          return Effect.succeed(response(Stream.empty));
        },
      },
    } as unknown as TransportRuntime;

    await Effect.runPromise(
      Stream.runCollect(HttpTransport.sseJson.with<unknown>().frames(prepared, request(), runtime)),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(middleware);
  });

  it('中间件可以改写请求后再下发', async () => {
    const seen: Array<string> = [];
    const middleware: HttpMiddleware = (input, handler) =>
      handler(HttpClientRequest.setUrl(input, 'https://rewritten.test/v1/messages'));

    await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service;
        return yield* executor.execute(
          HttpClientRequest.post('https://original.test/v1/messages'),
          middleware,
        );
      }).pipe(Effect.provide(RequestExecutor.layer), Effect.provide(fakeHttpClient(seen))),
    );

    expect(seen).toEqual(['https://rewritten.test/v1/messages']);
  });

  it('中间件可以短路返回（传输层不被调用）', async () => {
    const seen: Array<string> = [];
    const middleware: HttpMiddleware = () => Effect.succeed(response(Stream.empty, 204));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service;
        return yield* executor.execute(
          HttpClientRequest.post('https://original.test/v1/messages'),
          middleware,
        );
      }).pipe(Effect.provide(RequestExecutor.layer), Effect.provide(fakeHttpClient(seen))),
    );

    expect(seen).toEqual([]);
    expect(result.status).toBe(204);
  });

  it('中间件抛错仍归类为 LLMError（不是裸 Error）', async () => {
    const seen: Array<string> = [];
    const middleware: HttpMiddleware = () => Effect.fail(new Error('mid' + 'dleware exploded'));

    const outcome = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service;
          return yield* executor.execute(
            HttpClientRequest.post('https://original.test/v1/messages'),
            middleware,
          );
        }).pipe(Effect.provide(RequestExecutor.layer), Effect.provide(fakeHttpClient(seen))),
      ),
    );

    expect(outcome._tag).toBe('Failure');
    if (outcome._tag !== 'Failure') return;
    expect(outcome.failure).toBeInstanceOf(LLMError);
    if (!(outcome.failure instanceof LLMError)) return;
    expect(outcome.failure.reason._tag).toBe('Transport');
    if (outcome.failure.reason._tag !== 'Transport') return;
    expect(outcome.failure.reason.transport).toBe('http');
    expect(outcome.failure.reason.operation).toBe('request');
    // 非 `HttpClientError` 的异常统一成通用文案（对齐上游：不透传任意错误文本，
    // 否则中转/代理抛出的任意字符串会被当成用户可见消息）。
    expect(outcome.failure.message).toContain('transport failed');
  });

  it('非 2xx 响应仍经状态码分类（中间件不绕过它）', async () => {
    const seen: Array<string> = [];
    const passthrough: HttpMiddleware = (input, handler) => handler(input);

    const outcome = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service;
          return yield* executor.execute(
            HttpClientRequest.post('https://original.test/v1/messages'),
            passthrough,
          );
        }).pipe(Effect.provide(RequestExecutor.layer), Effect.provide(fakeHttpClient(seen, 400))),
      ),
    );

    expect(outcome._tag).toBe('Failure');
    if (outcome._tag !== 'Failure') return;
    expect(outcome.failure).toBeInstanceOf(LLMError);
    if (!(outcome.failure instanceof LLMError)) return;
    expect(outcome.failure.reason._tag).toBe('InvalidRequest');
  });
});
