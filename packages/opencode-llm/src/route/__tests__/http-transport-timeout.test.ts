/**
 * HTTP 传输超时契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-15：三档超时各自可诊断——响应头、相邻流式分片、整次请求。
 * 「上游静默」必须表现为超时失败，而不是无限挂起。
 */

import { describe, it, expect } from 'vitest';
import { Duration, Effect, Stream } from 'effect';
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

describe('整次请求预算（total）默认不设上限', () => {
  it('未配置 timeout 时不启用整次超时（对齐上游 packages/ai）', () => {
    const total = HttpTransport.resolveTotalTimeout(undefined);

    // 关键回归：这里曾回落到 DEFAULT_HTTP_TIMEOUT_MS(300s)，等于给每个请求加一堵
    // 5 分钟硬墙 —— 上游还活着但单轮耗时长时会被
    // `Timed out waiting for the response to complete` 掐断（用户侧「执行失败」）。
    expect(Duration.isFinite(total)).toBe(false);
    expect(Duration.toMillis(total)).toBe(Number.POSITIVE_INFINITY);
  });

  it('timeout=false 与未配置同义', () => {
    expect(Duration.isFinite(HttpTransport.resolveTotalTimeout(false))).toBe(false);
  });

  it('显式给出 timeout 时按数值设上限', () => {
    expect(Duration.toMillis(HttpTransport.resolveTotalTimeout(10))).toBe(10);
  });

  it('未配置时不会自己中断一个持续挂着的流（前 300ms 内不被掐断）', async () => {
    const outcome = await Effect.runPromise(
      Stream.runCollect(
        transport.frames(
          prepared,
          request({}),
          runtime(() => Effect.succeed(response(Stream.never))),
        ),
      ).pipe(
        Effect.as('inner-finished' as const),
        Effect.timeoutOrElse({
          duration: '300 millis',
          orElse: () => Effect.succeed('outer-timeout' as const),
        }),
      ),
    );

    // 外层超时先到 = 传输层自己没有提前中断（响应头/分片两档默认值都是分钟级）。
    expect(outcome).toBe('outer-timeout');
  });
});

describe('三档超时的重试口径', () => {
  const retryableOf = async (
    http: HttpOptions,
    stream: Stream.Stream<Uint8Array, never> | 'never',
  ) => {
    const outcome = await failureMessage(http, stream);
    expect(outcome._tag).toBe('Failure');
    if (outcome._tag !== 'Failure') return undefined;
    const error = outcome.failure;
    if (!(error instanceof LLMError)) throw new Error('Expected LLMError');
    return error.retryable;
  };

  it('响应头超时可重试（连接阶段，一个字节都还没吐出）', async () => {
    expect(await retryableOf({ headerTimeout: 10 }, 'never')).toBe(true);
  });

  it('分片静默超时不可重试（流已开始，重放会重复输出）', async () => {
    expect(await retryableOf({ chunkTimeout: 10, timeout: false }, Stream.never)).toBe(false);
  });

  it('整次预算超时不可重试', async () => {
    expect(await retryableOf({ timeout: 10, chunkTimeout: false }, Stream.never)).toBe(false);
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
