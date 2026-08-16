import { describe, expect, it } from 'vitest';
import { Message } from '@openAwork/opencode-llm';
import {
  applyProviderMessageTransforms,
  sanitizeSurrogates,
} from '../../v2-runtime/upstream/message-transforms.js';

describe('sanitizeSurrogates', () => {
  it('replaces lone high surrogate with U+FFFD', () => {
    const input = `before${String.fromCharCode(0xd800)}after`;
    expect(sanitizeSurrogates(input)).toBe(`before\uFFFDafter`);
  });

  it('replaces lone low surrogate with U+FFFD', () => {
    const input = `before${String.fromCharCode(0xdc00)}after`;
    expect(sanitizeSurrogates(input)).toBe(`before\uFFFDafter`);
  });

  it('preserves valid surrogate pairs and ordinary text', () => {
    expect(sanitizeSurrogates('😀')).toBe('😀');
    expect(sanitizeSurrogates('hello world\n中文')).toBe('hello world\n中文');
  });
});

describe('applyProviderMessageTransforms', () => {
  it('sanitises text, reasoning, and tool-result content', () => {
    const messages = [
      Message.system(`sys${String.fromCharCode(0xd800)}`),
      Message.user(`usr${String.fromCharCode(0xdc00)}`),
      Message.make({
        role: 'assistant',
        content: [
          { type: 'text', text: `txt${String.fromCharCode(0xd800)}` },
          { type: 'reasoning', text: `rsn${String.fromCharCode(0xdc00)}` },
        ],
      }),
      Message.tool({
        id: 't1',
        name: 'noop',
        result: `out${String.fromCharCode(0xd800)}`,
        resultType: 'text',
      }),
    ];
    const result = applyProviderMessageTransforms(messages, { providerType: 'openai' });
    expect(result[0]?.content[0]).toMatchObject({ type: 'text', text: 'sys\uFFFD' });
    expect(result[1]?.content[0]).toMatchObject({ type: 'text', text: 'usr\uFFFD' });
    expect(result[2]?.content[0]).toMatchObject({ type: 'text', text: 'txt\uFFFD' });
    expect(result[2]?.content[1]).toMatchObject({ type: 'reasoning', text: 'rsn\uFFFD' });
    expect(result[3]?.content[0]).toMatchObject({
      type: 'tool-result',
      result: { type: 'text', value: 'out\uFFFD' },
    });
  });

  it('inserts assistant Done. between Mistral tool and user messages', () => {
    const result = applyProviderMessageTransforms(
      [
        Message.tool({ id: 'abc', name: 'do_thing', result: 'ok', resultType: 'text' }),
        Message.user('next question'),
      ],
      { providerType: 'mistral', model: 'mistral-large' },
    );
    expect(result.map((message) => message.role)).toEqual(['tool', 'assistant', 'user']);
    expect(result[1]?.content[0]).toEqual({ type: 'text', text: 'Done.' });
  });

  it('does not insert assistant Done. for non-Mistral providers', () => {
    const result = applyProviderMessageTransforms(
      [
        Message.tool({ id: 'abc', name: 'do_thing', result: 'ok', resultType: 'text' }),
        Message.user('next question'),
      ],
      { providerType: 'anthropic' },
    );
    expect(result.map((message) => message.role)).toEqual(['tool', 'user']);
  });
});
