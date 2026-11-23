/**
 * OpenAI Chat **流内错误体**的响应侧宽容度。
 *
 * 回归背景（真实端点）：上游把连接中断上报成流内 error 帧
 * `{"error":{"message":"上游在返回完整响应前关闭了流式连接，请重试","type":"upstream_error","code":502}}`。
 * `code` 是**数字**时整帧被判非法，`step()` 走不到 `event.error` 分支，用户看到的是
 * `Invalid custom/openai-compatible-chat stream event: {...}` —— 上游原话被埋在一段
 * 转义过的 JSON 里，既不可读也没有错误语义。
 */

import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Chat from '../openai-chat.js';
import { LLMEvent, LLMRequest } from '../../schema/index.js';

const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);

const makeRequest = () =>
  new LLMRequest({
    model: Chat.route.model({ id: 'gpt-4.1' }),
    system: [],
    messages: [],
    tools: [],
  });

const runFrames = async (frames: ReadonlyArray<unknown>) => {
  let state = Chat.protocol.stream.initial(makeRequest());
  const events: LLMEvent[] = [];
  for (const frame of frames) {
    const [next, emitted] = await Effect.runPromise(
      Chat.protocol.stream.step(state, decode(JSON.stringify(frame))),
    );
    state = next;
    events.push(...emitted);
  }
  return events;
};

describe('OpenAI Chat 流内错误体兼容', () => {
  it('数字 code 不让整帧非法，并映射为带原话的 provider-error', async () => {
    const events = await runFrames([
      {
        error: {
          message: '上游在返回完整响应前关闭了流式连接，请重试',
          type: 'upstream_error',
          code: 502,
        },
      },
    ]);

    const error = events.find(LLMEvent.is.providerError);
    expect(error?.message).toContain('上游在返回完整响应前关闭了流式连接，请重试');
    expect(error?.message).toContain('502');
  });

  it('字符串 code 的既有标签格式不变', async () => {
    const events = await runFrames([
      { error: { code: 'rate_limit_exceeded', message: 'slow down' } },
    ]);

    const error = events.find(LLMEvent.is.providerError);
    expect(error?.message).toBe('rate_limit_exceeded: slow down');
    expect(error?.retryable).toBe(true);
  });
});
