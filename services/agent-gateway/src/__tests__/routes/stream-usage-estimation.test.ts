/**
 * 流式用量兜底估算：当 provider 流式响应不回 usage（token 全 0）时，
 * stream-model-round 用 ~4 字符/token 的粗略口径从入参消息 / 助手文本估算，
 * 保证 executor/reviewer 这类走完整 stream 协议的层不会「用了却统计为 0」。
 */

import { describe, expect, it } from 'vitest';
import {
  estimateTokensFromText,
  estimateModelMessagesTokens,
  estimateProviderRequestTokens,
} from '../../routes/stream-model-round.js';

describe('estimateTokensFromText', () => {
  it('按 ~4 字符/token 估算', () => {
    expect(estimateTokensFromText('x'.repeat(40))).toBe(10);
    expect(estimateTokensFromText('abc')).toBe(1); // ceil(3/4)
  });

  it('空 / null / undefined 返回 0', () => {
    expect(estimateTokensFromText('')).toBe(0);
    expect(estimateTokensFromText(null)).toBe(0);
    expect(estimateTokensFromText(undefined)).toBe(0);
  });
});

describe('estimateModelMessagesTokens', () => {
  it('累加各消息 content（字符串）长度后估算', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(40) }, // 40 chars
      { role: 'assistant', content: 'b'.repeat(40) }, // 40 chars
    ];
    // 总 80 chars → 20 tokens
    expect(estimateModelMessagesTokens(messages)).toBe(20);
  });

  it('content 为结构化 parts 时按 JSON 序列化长度估算', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
    const expected = Math.ceil(JSON.stringify(messages[0]!.content).length / 4);
    expect(estimateModelMessagesTokens(messages)).toBe(expected);
  });

  it('空数组返回 0', () => {
    expect(estimateModelMessagesTokens([])).toBe(0);
  });
});

describe('estimateProviderRequestTokens', () => {
  it('估算完整 system + messages + tools 请求且可正常超过 50K', () => {
    const input = {
      system: [{ role: 'system', content: 's'.repeat(80_000) }],
      messages: [{ role: 'user', content: 'm'.repeat(120_000) }],
      tools: [{ name: 'tool', schema: { description: 't'.repeat(40_000) } }],
    };

    expect(estimateProviderRequestTokens(input)).toBe(Math.ceil(JSON.stringify(input).length / 4));
    expect(estimateProviderRequestTokens(input)).toBeGreaterThan(50_000);
  });
});
