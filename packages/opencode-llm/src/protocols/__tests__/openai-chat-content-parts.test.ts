/**
 * OpenAI Chat content parts 容差测试（对齐上游 packages/ai@v2.0.28）。
 *
 * 覆盖 T-26：`http.body` overlay 可能带入数组形态的正文（text part 带
 * `cache_control`），严格 String 会让整个 body 校验失败。
 */

import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import * as Chat from '../openai-chat.js';

const decodeBody = Schema.decodeUnknownSync(Chat.protocol.body.schema);

const body = {
  model: 'gpt-5',
  stream: true,
  messages: [
    // system 也接受 text part 数组。
    {
      role: 'system',
      content: [{ type: 'text', text: '系统提示', cache_control: { type: 'ephemeral' } }],
    },
    { role: 'user', content: '你好' },
    // assistant 正文为数组形态，且带缓存断点。
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '思考中', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: '答案' },
      ],
    },
    // 工具结果同样可以是 text part 数组。
    {
      role: 'tool',
      tool_call_id: 'call_1',
      content: [{ type: 'text', text: '结果' }],
    },
  ],
};

describe('OpenAI Chat content parts', () => {
  it('数组形态的 system / assistant / tool 正文均可解码', () => {
    const decoded = decodeBody(body) as { messages: Array<{ role: string; content: unknown }> };

    expect(decoded.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);
    expect(decoded.messages[2]?.content).toEqual(body.messages[2]?.content);
    expect(decoded.messages[3]?.content).toEqual([{ type: 'text', text: '结果' }]);
  });

  it('字符串形态仍然解码（既有行为不变）', () => {
    const decoded = decodeBody({
      model: 'gpt-5',
      stream: true,
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '你好' },
        { role: 'assistant', content: null, tool_calls: [] },
        { role: 'tool', tool_call_id: 'call_1', content: '结果' },
      ],
    }) as { messages: Array<{ content: unknown }> };

    expect(decoded.messages[0]?.content).toBe('系统提示');
    expect(decoded.messages[3]?.content).toBe('结果');
  });
});
