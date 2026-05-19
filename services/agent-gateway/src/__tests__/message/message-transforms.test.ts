import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';

import {
  applyProviderMessageTransforms,
  sanitizeSurrogates,
} from '../../v2-runtime/upstream/message-transforms.js';

describe('sanitizeSurrogates', () => {
  it('replaces lone high surrogate with U+FFFD', () => {
    // Lone high surrogate (no following low surrogate)
    const input = `before${String.fromCharCode(0xd800)}after`;
    const out = sanitizeSurrogates(input);
    expect(out).toBe(`before\uFFFDafter`);
  });

  it('replaces lone low surrogate with U+FFFD', () => {
    const input = `before${String.fromCharCode(0xdc00)}after`;
    const out = sanitizeSurrogates(input);
    expect(out).toBe(`before\uFFFDafter`);
  });

  it('preserves valid surrogate pairs', () => {
    // U+1F600 (😀) = D83D DE00
    const input = '😀';
    expect(sanitizeSurrogates(input)).toBe(input);
  });

  it('preserves ASCII / BMP text untouched', () => {
    expect(sanitizeSurrogates('hello world\n中文')).toBe('hello world\n中文');
  });
});

describe('applyProviderMessageTransforms', () => {
  it('runs sanitizeSurrogates on every role and on tool-result text outputs', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: `sys${String.fromCharCode(0xd800)}` },
      { role: 'user', content: `usr${String.fromCharCode(0xdc00)}` },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: `txt${String.fromCharCode(0xd800)}` },
          { type: 'reasoning', text: `rsn${String.fromCharCode(0xdc00)}` },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'noop',
            output: { type: 'text', value: `out${String.fromCharCode(0xd800)}` },
          },
        ],
      },
    ];
    const result = applyProviderMessageTransforms(messages, { providerType: 'openai' });
    expect(result[0]?.content).toBe('sys\uFFFD');
    expect(result[1]?.content).toBe('usr\uFFFD');
    const assistant = result[2]!;
    const assistantParts = assistant.content as Array<{ type: string; text?: string }>;
    expect(assistantParts[0]?.text).toBe('txt\uFFFD');
    expect(assistantParts[1]?.text).toBe('rsn\uFFFD');
    const tool = result[3]!;
    const toolParts = tool.content as Array<{ output: { value?: string } }>;
    expect(toolParts[0]?.output.value).toBe('out\uFFFD');
  });

  it('inserts assistant "Done." between Mistral tool→user', () => {
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'abc',
            toolName: 'do_thing',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
      { role: 'user', content: 'next question' },
    ];
    const result = applyProviderMessageTransforms(messages, {
      providerType: 'mistral',
      model: 'mistral-large',
    });
    // Expect: tool, assistant("Done."), user
    expect(result.map((m) => m.role)).toEqual(['tool', 'assistant', 'user']);
    const inserted = result[1]!;
    const parts = inserted.content as Array<{ type: string; text?: string }>;
    expect(parts[0]?.type).toBe('text');
    expect(parts[0]?.text).toBe('Done.');
  });

  it('does not insert assistant Done. for non-Mistral providers', () => {
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'abc',
            toolName: 'do_thing',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
      { role: 'user', content: 'next question' },
    ];
    const result = applyProviderMessageTransforms(messages, { providerType: 'anthropic' });
    expect(result.map((m) => m.role)).toEqual(['tool', 'user']);
  });
});
