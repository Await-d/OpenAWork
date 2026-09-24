import { Effect, Layer, Stream } from 'effect';
import { HttpClientResponse, type HttpClientRequest } from 'effect/unstable/http';
import { describe, expect, it } from 'vitest';
import { LLMClient, LLMRequest, Message, RequestExecutor } from '../../index.js';
import * as OpenAIChat from '../../protocols/openai-chat.js';

/**
 * OpenAI Chat 流边界回归（对齐 opencode 参考库）。
 *
 * 覆盖三条此前会误报 `ProviderShared.stream: OpenAI Chat stream ended
 * without finish_reason` 的路径：
 *   1. `retry:` 控制帧被忽略而不是截断其后的事件；
 *   2. `[DONE]` 终止哨兵让客户端立即收尾（不等 HTTP body EOF）；
 *   3. `requireFinishReason=false` 时合成终态而不是失败。
 */

const encoder = new TextEncoder();

/** 可控制是否关闭的 SSE 响应体，逐 chunk 交付以模拟真实网络分包。 */
const sseBody = (chunks: ReadonlyArray<string>, close: boolean): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        controller.enqueue(encoder.encode(chunk));
      }
      if (close) controller.close();
    },
  });

const executorLayer = (chunks: ReadonlyArray<string>, close: boolean) =>
  Layer.succeed(RequestExecutor.Service, {
    execute: (request: HttpClientRequest.HttpClientRequest) =>
      Effect.sync(() =>
        HttpClientResponse.fromWeb(
          request,
          new Response(sseBody(chunks, close), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        ),
      ),
  });

const streamChat = (
  chunks: ReadonlyArray<string>,
  options?: { readonly close?: boolean; readonly requireFinishReason?: boolean },
) => {
  const request = new LLMRequest({
    model: OpenAIChat.route.model({
      id: 'boundary-test',
      ...(options?.requireFinishReason === undefined
        ? {}
        : { compatibility: { requireFinishReason: options.requireFinishReason } }),
    }),
    system: [],
    messages: [Message.user('hi')],
    tools: [],
  });
  return LLMClient.stream(request).pipe(
    Stream.runCollect,
    Effect.timeout('3 seconds'),
    Effect.provide(LLMClient.layer),
    Effect.provide(executorLayer(chunks, options?.close ?? true)),
  );
};

const content = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`;
const reasoning = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: text } }] })}\n\n`;
const finish = (reason: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\n`;
const DONE = 'data: [DONE]\n\n';

describe('OpenAI Chat 流边界（对齐参考库）', () => {
  it('忽略流中间的 retry: 控制帧，不丢后续正文与终态', async () => {
    const events = await Effect.runPromise(
      streamChat([
        content('思考前'),
        'retry: 3000\n\n',
        reasoning('思考中'),
        content('正文'),
        finish('stop'),
        DONE,
      ]),
    );

    const text = events
      .filter((event) => event.type === 'text-delta')
      .map((event) => event.text)
      .join('');
    const reasoningText = events
      .filter((event) => event.type === 'reasoning-delta')
      .map((event) => event.text)
      .join('');
    expect(text).toBe('思考前正文');
    expect(reasoningText).toBe('思考中');
    expect(events.some((event) => event.type === 'finish')).toBe(true);
  });

  it('retry: 作为流首包时同样完整收尾', async () => {
    const events = await Effect.runPromise(
      streamChat(['retry: 3000\n\n', content('正文'), finish('stop'), DONE]),
    );

    expect(events.some((event) => event.type === 'finish')).toBe(true);
    expect(events.filter((event) => event.type === 'text-delta')).toHaveLength(1);
  });

  it('[DONE] 到达即收尾：body 不关闭也不会挂起或报错', async () => {
    // `[DONE]` 之后上游保持连接不关闭（部分网关行为）。参考库在 [DONE] 停止读取；
    // 移植版此前会读到 idle timeout / EOF，把正常回答误判为 STALL 或截断。
    const events = await Effect.runPromise(
      streamChat([content('正文'), finish('stop'), DONE], { close: false }),
    );

    expect(events.some((event) => event.type === 'finish')).toBe(true);
    expect(events.filter((event) => event.type === 'text-delta')).toHaveLength(1);
  });

  it('流在终态前结束仍以 incomplete-stream 失败（严格语义保留）', async () => {
    await expect(
      Effect.runPromise(streamChat([content('被截断的正文'), 'retry: 3000\n\n'])),
    ).rejects.toThrow(/without finish_reason/);
  });

  it('requireFinishReason=false：缺 finish_reason 时合成终态而不是失败', async () => {
    const events = await Effect.runPromise(
      streamChat([content('被截断的正文')], { requireFinishReason: false }),
    );

    const finishEvent = events.find((event) => event.type === 'finish');
    expect(finishEvent?.reason).toBe('stop');
  });
});
