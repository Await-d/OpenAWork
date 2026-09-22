import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Responses from '../openai-responses.js';
import { LLMRequest, LLMEvent, Message, ToolResultPart } from '../../schema/index.js';

const decode = Schema.decodeUnknownSync(Responses.protocol.stream.event);

const makeRequest = () =>
  new LLMRequest({
    model: Responses.route.model({ id: 'gpt-4.1' }),
    system: [],
    messages: [],
    tools: [],
  });

const runFrames = async (frames: ReadonlyArray<unknown>) => {
  let state = Responses.protocol.stream.initial(makeRequest());
  const events: LLMEvent[] = [];
  for (const frame of frames) {
    const [next, emitted] = await Effect.runPromise(
      Responses.protocol.stream.step(state, decode(JSON.stringify(frame))),
    );
    state = next;
    events.push(...emitted);
  }
  return { state, events };
};

describe('OpenAI Responses 流式恢复', () => {
  it('response.completed 时补发缺失 output_item.done 的工具调用', async () => {
    const { events } = await runFrames([
      {
        type: 'response.output_item.added',
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'bash' },
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"a":' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '1}' },
      { type: 'response.completed', response: { id: 'resp_1' } },
    ]);

    const call = events.find(LLMEvent.is.toolCall);
    expect(call?.name).toBe('bash');
    expect(call?.input).toEqual({ a: 1 });
    expect(events.find(LLMEvent.is.finish)?.reason).toBe('tool-calls');
  });

  it('done-only 工具调用补发 tool-input-start', async () => {
    const { events } = await runFrames([
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          id: 'fc_2',
          call_id: 'call_2',
          name: 'bash',
          arguments: '{"b":2}',
        },
      },
    ]);

    const types = events.map((event) => event.type);
    expect(types.indexOf('tool-input-start')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('tool-input-start')).toBeLessThan(types.indexOf('tool-input-end'));
    expect(events.find(LLMEvent.is.toolCall)?.input).toEqual({ b: 2 });
  });

  it('无匹配工具的 argument delta 被忽略', async () => {
    const { events } = await runFrames([
      { type: 'response.function_call_arguments.delta', item_id: 'nope', delta: '{}' },
    ]);

    expect(events).toEqual([]);
  });

  it('function_call_arguments.done 用权威参数重同步前缀', async () => {
    const { events } = await runFrames([
      {
        type: 'response.output_item.added',
        item: { type: 'function_call', id: 'fc_3', call_id: 'call_3', name: 'bash' },
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_3', delta: '{"a":' },
      { type: 'response.function_call_arguments.done', item_id: 'fc_3', arguments: '{"a":9}' },
      { type: 'response.completed', response: { id: 'resp_3' } },
    ]);

    expect(events.find(LLMEvent.is.toolCall)?.input).toEqual({ a: 9 });
  });

  it('只发 output_text.done 时回填文本', async () => {
    const { events } = await runFrames([
      { type: 'response.output_text.done', item_id: 'msg_1', text: 'hello' },
    ]);

    expect(events.find(LLMEvent.is.textDelta)?.text).toBe('hello');
  });

  it('response.incomplete 无原因时报告 unknown', async () => {
    const { events } = await runFrames([{ type: 'response.incomplete', response: {} }]);

    expect(events.find(LLMEvent.is.finish)?.reason).toBe('unknown');
  });

  const hostedItem = {
    type: 'web_search_call',
    id: 'ws_1',
    status: 'completed',
    action: { type: 'search', query: 'opencode' },
  };

  const hostedRequest = (store: boolean) =>
    new LLMRequest({
      model: Responses.route.model({ id: 'gpt-4.1' }),
      system: [],
      messages: [
        Message.assistant([
          ToolResultPart.make({
            id: 'ws_1',
            name: 'web_search',
            result: hostedItem,
            resultType: 'json',
            providerExecuted: true,
            providerMetadata: { openai: { itemId: 'ws_1' } },
          }),
        ]),
      ],
      tools: [],
      providerOptions: { openai: { store } },
    });

  it('store:false 时回放记录的 hosted 工具条目而不是丢弃', async () => {
    const body = await Effect.runPromise(Responses.protocol.body.from(hostedRequest(false)));

    const replayed = body.input.find((item) => 'type' in item && item.type === 'web_search_call');
    expect(replayed).toMatchObject({ type: 'web_search_call', id: 'ws_1' });
    expect(body.input.some((item) => 'type' in item && item.type === 'item_reference')).toBe(false);
  });

  it('store 开启时改用 item_reference', async () => {
    const body = await Effect.runPromise(Responses.protocol.body.from(hostedRequest(true)));

    const reference = body.input.find((item) => 'type' in item && item.type === 'item_reference');
    expect(reference).toMatchObject({ type: 'item_reference', id: 'ws_1' });
  });

  it('error 事件终止流并映射为可重试的 provider-error', async () => {
    const { events } = await runFrames([
      { type: 'error', code: 'rate_limit_exceeded', message: 'slow down' },
    ]);

    const error = events.find(LLMEvent.is.providerError);
    expect(error?.message).toBe('rate_limit_exceeded: slow down');
    expect(error?.retryable).toBe(true);
  });
});
