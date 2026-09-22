import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Chat from '../openai-chat.js';
import { LLMRequest, Message, ToolCallPart, type ContentPart } from '../../schema/index.js';

const buildRequest = (messages: Message[]) =>
  new LLMRequest({
    model: Chat.route.model({ id: 'gpt-4.1' }),
    system: [],
    messages,
    tools: [],
  });

const lowerMessages = async (messages: Message[]) => {
  const body = await Effect.runPromise(Chat.protocol.body.from(buildRequest(messages)));
  return body.messages;
};

const reasoning = (text: string): ContentPart => ({ type: 'reasoning', text });

// `content: ""` is a valid OpenAI Chat assistant message; only a missing/null
// content with no tool_calls is rejected upstream.
const isInvalidAssistant = (message: { role: string; content?: unknown; tool_calls?: unknown }) =>
  message.role === 'assistant' &&
  (message.content === null || message.content === undefined) &&
  (message.tool_calls === undefined || (message.tool_calls as unknown[]).length === 0);

describe('OpenAI Chat 请求降级：assistant 消息必须带 content 或 tool_calls', () => {
  it('保留仅含 reasoning 的 assistant 回合，并以空字符串代替 null 正文', async () => {
    const messages = await lowerMessages([
      Message.user('你好'),
      Message.make({ role: 'assistant', content: [reasoning('让我想想……')] }),
      Message.user('继续'),
    ]);

    expect(messages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '', reasoning_content: '让我想想……' },
      { role: 'user', content: '继续' },
    ]);
  });

  it('丢弃正文全部为空白的 assistant 回合', async () => {
    const messages = await lowerMessages([
      Message.make({ role: 'assistant', content: [{ type: 'text', text: '  ' }] }),
    ]);

    expect(messages).toEqual([]);
  });

  it('保留带正文的 assistant 回合', async () => {
    const messages = await lowerMessages([
      Message.make({ role: 'assistant', content: '最终答复' }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'assistant', content: '最终答复' });
  });

  it('仅含工具调用（无正文）时正文保持 null', async () => {
    const messages = await lowerMessages([
      Message.make({
        role: 'assistant',
        content: [ToolCallPart.make({ id: 'call_1', name: 'read_file', input: { path: 'a.ts' } })],
      }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'assistant', content: null });
    expect(messages[0]?.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      function: { name: 'read_file' },
    });
  });

  it('保留 reasoning 与正文共存的回合及其 reasoning_content', async () => {
    const messages = await lowerMessages([
      Message.make({
        role: 'assistant',
        content: [reasoning('思考'), { type: 'text', text: '答复' }],
      }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'assistant', content: '答复' });
    expect(messages[0]?.reasoning_content).toBe('思考');
  });

  it('保留纯 reasoning 回合时不影响后续工具调用与工具结果的配对', async () => {
    const messages = await lowerMessages([
      Message.user('跑一下'),
      Message.make({ role: 'assistant', content: [reasoning('先想想')] }),
      Message.make({
        role: 'assistant',
        content: [ToolCallPart.make({ id: 'call_1', name: 'read_file', input: { path: 'a.ts' } })],
      }),
      Message.tool({ id: 'call_1', name: 'read_file', result: 'ok' }),
    ]);

    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'tool',
    ]);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '',
      reasoning_content: '先想想',
    });
    expect(messages[2]?.tool_calls?.[0]?.id).toBe('call_1');
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  });

  it('任何降级结果都不存在 content 与 tool_calls 双空的 assistant 消息', async () => {
    const messages = await lowerMessages([
      Message.user('混合历史'),
      Message.make({ role: 'assistant', content: [reasoning('只有思考')] }),
      Message.make({ role: 'assistant', content: [{ type: 'text', text: '   ' }] }),
      Message.make({
        role: 'assistant',
        content: [reasoning('思考'), { type: 'text', text: '正文' }],
      }),
      Message.make({
        role: 'assistant',
        content: [ToolCallPart.make({ id: 'call_1', name: 'read_file', input: {} })],
      }),
    ]);

    expect(messages.filter(isInvalidAssistant)).toEqual([]);
  });
});
