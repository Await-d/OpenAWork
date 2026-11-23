/**
 * 连接阶段传输失败的重试契约。
 *
 * 上游「真的连不上」属于**未投递**（`operation: 'request'`）失败：一个字节都还没
 * 吐给下游，重试不会产生重复输出，所以 executor 应当自动重试；上限沿用
 * `MAX_RETRIES`（首次 + 2 次重试 = 3 次尝试）。
 *
 * 反例（读阶段超时不重试）在 `http-transport-timeout.test.ts` 与
 * `schema/__tests__/transport-retryable.test.ts` 覆盖 —— 那类失败发生在
 * `execute` 返回之后的流消费阶段，重试循环根本看不到它。
 */

import { describe, expect, it } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { RequestExecutor } from '../executor.js';
import { LLMError } from '../../schema/index.js';

const MAX_ATTEMPTS = 3;

const okResponse = () =>
  ({
    status: 200,
    headers: Headers.empty,
    stream: Stream.empty,
    text: Effect.succeed(''),
  }) as unknown as HttpClientResponse.HttpClientResponse;

/** 每次 execute 都调用一次 handler，用来数「尝试了几次」。 */
const runExecute = (
  handler: () => Effect.Effect<HttpClientResponse.HttpClientResponse, never>,
): Effect.Effect<
  { readonly _tag: 'Success' } | { readonly _tag: 'Failure'; readonly failure: unknown },
  never,
  never
> =>
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service;
    return yield* Effect.result(
      executor.execute(HttpClientRequest.post('https://example.test/v1/chat/completions')),
    );
  }).pipe(
    Effect.provide(
      RequestExecutor.layer.pipe(
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => handler()),
          ),
        ),
      ),
    ),
  );

const connectRefused = () =>
  Effect.fail(new Error('connect ECONNREFUSED 127.0.0.1:9')) as unknown as Effect.Effect<
    HttpClientResponse.HttpClientResponse,
    never
  >;

describe('连接阶段传输失败自动重试', () => {
  it('第一次连不上、第二次成功时自动重试并成功', async () => {
    let calls = 0;
    const outcome = await Effect.runPromise(
      runExecute(() => {
        calls += 1;
        return calls === 1 ? connectRefused() : Effect.succeed(okResponse());
      }),
    );

    expect(calls).toBe(2);
    expect(outcome._tag).toBe('Success');
  });

  it('持续连不上时最多尝试 3 次（首次 + MAX_RETRIES），错误仍标记为可重试', async () => {
    let calls = 0;
    const outcome = await Effect.runPromise(
      runExecute(() => {
        calls += 1;
        return connectRefused();
      }),
    );

    expect(calls).toBe(MAX_ATTEMPTS);
    expect(outcome._tag).toBe('Failure');
    if (outcome._tag !== 'Failure') return;

    const error = outcome.failure;
    expect(error).toBeInstanceOf(LLMError);
    if (!(error instanceof LLMError)) return;
    expect(error.reason._tag).toBe('Transport');
    if (error.reason._tag !== 'Transport') return;
    expect(error.reason.operation).toBe('request');
    expect(error.retryable).toBe(true);
  });
});
