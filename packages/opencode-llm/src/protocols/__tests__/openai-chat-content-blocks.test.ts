import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Chat from '../openai-chat.js';
import { LLMRequest } from '../../schema/index.js';

describe('兼容接口文本块增量', () => {
  it.each([
    '正文',
    [
      { type: 'text', text: '正' },
      { type: 'text', text: '文' },
    ],
  ])('解析字符串及智谱文本块数组：%j', async (content) => {
    const request = new LLMRequest({
      model: Chat.route.model({ id: 'glm-5.3-flash' }),
      system: [],
      messages: [],
      tools: [],
    });
    const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);
    const [, events] = await Effect.runPromise(
      Chat.protocol.stream.step(
        Chat.protocol.stream.initial(request),
        decode(
          JSON.stringify({
            id: 'captured-zhipu',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content, thinking_signature: null },
                finish_reason: null,
              },
            ],
          }),
        ),
      ),
    );
    expect(JSON.stringify(events)).toContain('正文');
  });

  it('忽略工具调用开始前无身份且无参数的占位增量', async () => {
    const request = new LLMRequest({
      model: Chat.route.model({ id: 'gpt-4.1' }),
      system: [],
      messages: [],
      tools: [],
    });
    const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);
    const placeholder = decode(
      JSON.stringify({
        id: 'compat-placeholder',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0 }] }, finish_reason: null }],
      }),
    );
    const [state, events] = await Effect.runPromise(
      Chat.protocol.stream.step(Chat.protocol.stream.initial(request), placeholder),
    );

    expect(events).toEqual([]);
    const startedTool = decode(
      JSON.stringify({
        id: 'compat-tool-start',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":' } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    const [, toolEvents] = await Effect.runPromise(Chat.protocol.stream.step(state, startedTool));

    expect(JSON.stringify(toolEvents)).toContain('read_file');
  });

  it('接受网关在后续工具增量中用空字符串表示省略身份字段', async () => {
    const request = new LLMRequest({
      model: Chat.route.model({ id: 'gpt-4.1' }),
      system: [],
      messages: [],
      tools: [],
    });
    const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);
    const start = decode(
      JSON.stringify({
        id: 'start',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '' } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    const [state] = await Effect.runPromise(
      Chat.protocol.stream.step(Chat.protocol.stream.initial(request), start),
    );
    const continuation = decode(
      JSON.stringify({
        id: 'continuation',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: '',
                  function: { name: '', arguments: '{"path":"README.md"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    const [nextState] = await Effect.runPromise(Chat.protocol.stream.step(state, continuation));
    expect(nextState.tools[0]).toMatchObject({
      id: 'call_1',
      name: 'read_file',
      input: '{"path":"README.md"}',
    });
  });

  it('暂存工具身份之前到达的参数增量', async () => {
    const request = new LLMRequest({
      model: Chat.route.model({ id: 'gpt-4.1' }),
      system: [],
      messages: [],
      tools: [],
    });
    const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);
    const anonymous = decode(
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] },
            finish_reason: null,
          },
        ],
      }),
    );
    const [state, events] = await Effect.runPromise(
      Chat.protocol.stream.step(Chat.protocol.stream.initial(request), anonymous),
    );
    expect(events).toEqual([]);
    const identified = decode(
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'read_file', arguments: '"README.md"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    const [nextState, nextEvents] = await Effect.runPromise(
      Chat.protocol.stream.step(state, identified),
    );
    expect(JSON.stringify(nextEvents)).toContain('read_file');
    expect(nextState.tools[0]?.input).toBe('{"path":"README.md"}');
  });
});
