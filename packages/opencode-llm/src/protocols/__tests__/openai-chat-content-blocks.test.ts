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
});
