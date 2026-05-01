import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../pages/chat-page/support.js';
import {
  clampSearchIndex,
  extractSearchableText,
  findChatMessageMatches,
} from './chat-search-support.js';

function makeMessage(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>,
): ChatMessage {
  return {
    role: 'user',
    createdAt: Date.now(),
    ...overrides,
  } as ChatMessage;
}

describe('extractSearchableText', () => {
  it('returns plain text content unchanged for non-JSON payloads', () => {
    expect(extractSearchableText(makeMessage({ id: '1', content: 'hello world' }))).toBe(
      'hello world',
    );
  });

  it('preserves the raw payload when it is just JSON-looking text but not parseable', () => {
    const broken = '{ not json at all';
    expect(extractSearchableText(makeMessage({ id: '1', content: broken }))).toBe(broken);
  });

  it('extracts the surface text from an assistant trace envelope', () => {
    const trace = JSON.stringify({
      kind: 'assistant_trace',
      text: 'final answer body',
      reasoningBlocks: ['inner reasoning step'],
      toolCalls: [{ toolName: 'shell.run' }],
    });
    const surface = extractSearchableText(
      makeMessage({ id: '1', content: trace, role: 'assistant' }),
    );
    expect(surface).toContain('final answer body');
    expect(surface).toContain('inner reasoning step');
    expect(surface).toContain('shell.run');
  });

  it('extracts payload.title / message for status envelopes', () => {
    const status = JSON.stringify({
      type: 'status',
      payload: { title: 'Compaction', message: 'session compacted ok' },
    });
    const surface = extractSearchableText(makeMessage({ id: '1', content: status }));
    expect(surface).toContain('Compaction');
    expect(surface).toContain('session compacted ok');
  });

  it('returns empty string for empty content', () => {
    expect(extractSearchableText(makeMessage({ id: '1', content: '' }))).toBe('');
  });
});

describe('findChatMessageMatches', () => {
  const sample: ChatMessage[] = [
    makeMessage({
      id: 'a',
      content: 'Hello, this mentions React hooks twice. React is great.',
    }),
    makeMessage({ id: 'b', content: 'No mention here.', role: 'assistant' }),
    makeMessage({
      id: 'c',
      content: 'Another React reference.',
      role: 'assistant',
    }),
  ];

  it('returns empty list for blank / whitespace queries', () => {
    expect(findChatMessageMatches(sample, '')).toEqual([]);
    expect(findChatMessageMatches(sample, '   ')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const matches = findChatMessageMatches(sample, 'react');
    expect(matches.map((m) => m.messageId)).toEqual(['a', 'c']);
  });

  it('counts multiple occurrences within a single message', () => {
    const matches = findChatMessageMatches(sample, 'React');
    const messageA = matches.find((m) => m.messageId === 'a');
    expect(messageA?.occurrences).toBe(2);
    const messageC = matches.find((m) => m.messageId === 'c');
    expect(messageC?.occurrences).toBe(1);
  });

  it('preserves source order so prev/next navigation walks scroll order', () => {
    const matches = findChatMessageMatches(sample, 'React');
    expect(matches.map((m) => m.messageIndex)).toEqual([0, 2]);
  });

  it('returns no matches when the query never appears', () => {
    expect(findChatMessageMatches(sample, 'kubernetes')).toEqual([]);
  });

  it('builds a snippet centred on the first hit with ellipsis padding', () => {
    const longBody = 'lorem '.repeat(40) + 'TARGET token here ' + 'ipsum '.repeat(40);
    const matches = findChatMessageMatches(
      [makeMessage({ id: 'long', content: longBody })],
      'TARGET',
    );
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match).toBeDefined();
    const snippet = match?.snippet ?? '';
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('TARGET');
  });

  it('searches into assistant trace text envelopes', () => {
    const messages = [
      makeMessage({
        id: 'trace',
        role: 'assistant',
        content: JSON.stringify({
          kind: 'assistant_trace',
          text: 'the eigenvector is computed',
          reasoningBlocks: ['matrix factorisation step'],
          toolCalls: [],
        }),
      }),
    ];
    expect(findChatMessageMatches(messages, 'eigenvector')).toHaveLength(1);
    expect(findChatMessageMatches(messages, 'matrix factorisation')).toHaveLength(1);
  });
});

describe('clampSearchIndex', () => {
  it('returns 0 when there are no matches', () => {
    expect(clampSearchIndex(5, 0)).toBe(0);
    expect(clampSearchIndex(-3, 0)).toBe(0);
  });

  it('wraps positive indices past the end', () => {
    expect(clampSearchIndex(3, 3)).toBe(0);
    expect(clampSearchIndex(7, 3)).toBe(1);
  });

  it('wraps negative indices to the tail (so previous-from-zero lands on the last match)', () => {
    expect(clampSearchIndex(-1, 3)).toBe(2);
    expect(clampSearchIndex(-4, 3)).toBe(2);
  });

  it('returns the index unchanged when within range', () => {
    expect(clampSearchIndex(0, 5)).toBe(0);
    expect(clampSearchIndex(2, 5)).toBe(2);
    expect(clampSearchIndex(4, 5)).toBe(4);
  });
});
