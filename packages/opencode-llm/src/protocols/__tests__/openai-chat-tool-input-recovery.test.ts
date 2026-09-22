import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Chat from '../openai-chat.js';
import { LLMRequest, LLMEvent } from '../../schema/index.js';

const makeRequest = () =>
  new LLMRequest({
    model: Chat.route.model({ id: 'gpt-4.1' }),
    system: [],
    messages: [],
    tools: [],
  });

const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);

const runFrames = async (frames: ReadonlyArray<unknown>) => {
  let state = Chat.protocol.stream.initial(makeRequest());
  for (const frame of frames) {
    const [next] = await Effect.runPromise(
      Chat.protocol.stream.step(state, decode(JSON.stringify(frame))),
    );
    state = next;
  }
  const onHalt = Chat.protocol.stream.onHalt;
  return onHalt ? await Effect.runPromise(onHalt(state)) : [];
};

const toolDelta = (argumentsText: string) => ({
  id: 'recovery',
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          { index: 0, id: 'call_1', function: { name: 'bash', arguments: argumentsText } },
        ],
      },
      finish_reason: null,
    },
  ],
});

const finish = (reason: string) => ({
  id: 'recovery',
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
});

const collect = async (frames: ReadonlyArray<unknown>) => {
  let state = Chat.protocol.stream.initial(makeRequest());
  const events: LLMEvent[] = [];
  for (const frame of frames) {
    const [next, emitted] = await Effect.runPromise(
      Chat.protocol.stream.step(state, decode(JSON.stringify(frame))),
    );
    state = next;
    events.push(...emitted);
  }
  const onHalt = Chat.protocol.stream.onHalt;
  if (onHalt) events.push(...(await Effect.runPromise(onHalt(state))));
  return events;
};

describe('兼容接口工具参数容错', () => {
  it('顶层 error 体映射为 provider-error', async () => {
    const events = await collect([
      { error: { code: 'rate_limit_exceeded', message: 'slow down' } },
    ]);

    const error = events.find(LLMEvent.is.providerError);
    expect(error?.message).toBe('rate_limit_exceeded: slow down');
    expect(error?.retryable).toBe(true);
  });

  it('native_finish_reason 作为 reasonRaw 保留', async () => {
    const events = await collect([
      {
        choices: [{ delta: {}, finish_reason: 'stop', native_finish_reason: 'eos' }],
      },
    ]);

    expect(events.find(LLMEvent.is.finish)?.reasonRaw).toBe('eos');
  });

  it('工具增量缺失 index 时按 id/位置归并', async () => {
    const events = await collect([
      {
        choices: [
          {
            delta: {
              tool_calls: [{ id: 'call_x', function: { name: 'bash', arguments: '{"a":' } }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ function: { arguments: '1}' } }] }, finish_reason: null },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);

    const calls = events.filter(LLMEvent.is.toolCall);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toEqual({ a: 1 });
  });

  it('截断（finish_reason=length）时丢弃未完成的工具调用而非中断整轮', async () => {
    const events = await runFrames([toolDelta('{"command":"rm -rf '), finish('length')]);

    expect(events.some(LLMEvent.is.toolCall)).toBe(false);
    const finished = events.find(LLMEvent.is.finish);
    expect(finished?.reason).toBe('length');
    expect(finished?.reasonRaw).toBe('length');
  });

  it('content_filter 终止时同样丢弃未完成的工具调用', async () => {
    const events = await runFrames([toolDelta('{"command":"echo hi"'), finish('content_filter')]);

    expect(events.some(LLMEvent.is.toolCall)).toBe(false);
  });

  it('参数含未转义换行时按部分解析收尾，不再抛错', async () => {
    const events = await runFrames([toolDelta('{"command":"echo a\nls"}'), finish('tool_calls')]);

    const call = events.find(LLMEvent.is.toolCall);
    expect(call?.input).toEqual({ command: 'echo a\nls' });
  });

  it('参数完全无法解析时降级为空对象，让工具自行拒绝', async () => {
    const events = await runFrames([toolDelta('not json at all'), finish('tool_calls')]);

    const call = events.find(LLMEvent.is.toolCall);
    expect(call?.input).toEqual({});
  });
});
