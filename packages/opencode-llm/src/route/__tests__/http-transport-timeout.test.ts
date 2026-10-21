/**
 * HTTP 传输超时契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-15：三档超时各自可诊断——响应头、相邻流式分片、整次请求。
 * 「上游静默」必须表现为超时失败，而不是无限挂起。
 */

import { describe, it, expect } from 'vitest';
import { Effect, Stream } from 'effect';
import { Headers, HttpClientRequest } from 'effect/http';
import type { HttpClientResponse } from 'effect/http';
import * as Framing from '../framing.js';
import * as HttpTransport from '../transport/http.js';
import type { TransportRuntime } from '../transport/index.js';
import { LLMError, LLMRequest, Message, Model, type HttpOptions } from '../../schema/index.js';
import * as AnthropicMessages from '../../protocols/anthropic-messages.js';

const model = Model.make({ id: 'test-model', provider: 'test', route: AnthropicMessages.route });

const request = (http: HttpOptions) =>
  new LLMRequest({ model, system: [], messages: [Message.user('hi')], tools: [], http });

const prepared = {
  request: HttpClientRequest.post('https://example.test/v1/messages'),
  framing: Framing.sse,
} as Parameters<ReturnType<typeof HttpTransport.sseJson.with<unknown>>['frames']>[0];

// 测试桩：只需要 `frames` 用到的 `runtime.http.execute`。
const runtime = (
  execute: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, never>,
) => ({ http: { execute } }) as unknown as TransportRuntime;

const response = (stream: Stream.Stream<Uint8Array, never>) =>
  ({
    status: 200,
    headers: Headers.empty,
    stream,
  }) as unknown as HttpClientResponse.HttpClientResponse;

const transport = HttpTransport.sseJson.with<unknown>();

const failureMessage = (http: HttpOptions, stream: Stream.Stream<Uint8Array, never> | 'never') => {
  const execute =
    stream === 'never'
      ? () => Effect.never as Effect.Effect<HttpClientResponse.HttpClientResponse, never>
      : () => Effect.succeed(response(stream));
  return Effect.runPromise(
    Effect.result(Stream.runCollect(transport.frames(prepared, request(http), runtime(execute)))),
  );
};

const expectTimeout = (outcome: Awaited<ReturnType<typeof failureMessage>>, message: string) => {
  expect(outcome._tag).toBe('Failure');
  if (outcome._tag !== 'Failure') return;
  const error = outcome.failure;
  expect(error).toBeInstanceOf(LLMError);
  if (!(error instanceof LLMError)) return;
  expect(error.reason._tag).toBe('Transport');
  expect(error.reason.kind).toBe('Timeout');
  expect(error.message).toContain(message);
};

describe('HTTP 传输超时', () => {
  it('响应头迟迟不到时超时', async () => {
    const outcome = await failureMessage({ headerTimeout: 10 }, 'never');

    expectTimeout(outcome, 'Timed out waiting for response headers');
  });

  it('流式分片之间静默时超时', async () => {
    const outcome = await failureMessage({ chunkTimeout: 10, timeout: false }, Stream.never);

    expectTimeout(outcome, 'Timed out waiting for response data');
  });

  it('整次请求超预算时超时', async () => {
    const outcome = await failureMessage({ timeout: 10, chunkTimeout: false }, Stream.never);

    expectTimeout(outcome, 'Timed out waiting for the response to complete');
  });
});

describe('HTTP 传输超时的阶段标注', () => {
  it('响应头超时标记为 request 阶段', async () => {
    const outcome = await failureMessage({ headerTimeout: 10 }, 'never');

    expect(outcome._tag).toBe('Failure');
    if (outcome._tag !== 'Failure') return;
    const error = outcome.failure;
    if (!(error instanceof LLMError)) throw new Error('Expected LLMError');
    expect(error.reason._tag).toBe('Transport');
    if (error.reason._tag !== 'Transport') return;
    expect(error.reason.transport).toBe('http');
    expect(error.reason.operation).toBe('request');
    expect(error.reason.code).toBe('Timeout');
  });

  it('分片超时标记为 read 阶段', async () => {
    const outcome = await failureMessage({ chunkTimeout: 10, timeout: false }, Stream.never);

    expect(outcome._tag).toBe('Failure');
    if (outcome._tag !== 'Failure') return;
    const error = outcome.failure;
    if (!(error instanceof LLMError)) throw new Error('Expected LLMError');
    if (error.reason._tag !== 'Transport') return;
    expect(error.reason.operation).toBe('read');
  });
});
