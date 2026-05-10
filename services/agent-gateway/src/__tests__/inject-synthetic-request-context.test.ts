import { describe, expect, it } from 'vitest';

import { injectSyntheticRequestContextUnified } from '../routes/stream-model-round.js';
import type { UnifiedMessage } from '../message-to-model-messages.js';

describe('injectSyntheticRequestContextUnified', () => {
  const ctx = {
    injectedPrompt: null,
    capabilityContext: 'CAPS',
    companionPrompt: null,
  };

  it('prepends a <system-reminder> envelope to the latest user message when none is present', () => {
    const messages: UnifiedMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'do thing' },
    ];

    const result = injectSyntheticRequestContextUnified(messages, ctx);

    expect(result[0]!.content).toBe('hello');
    expect(result[1]!.content).toBe('hi');
    expect(result[2]!.content).toBe('<system-reminder>\nCAPS\n</system-reminder>\n\ndo thing');
  });

  // Regression for the websearch low-cache-hit bug. When the latest user
  // message already carries a persisted `<system-reminder>` envelope (post-
  // fix sessions write it as a `synthetic: true` text part in DB), the
  // legacy in-memory injector must not double-prepend — otherwise the
  // upstream Anthropic / OpenAI prompt-cache prefix mutates between rounds
  // and we re-encounter the bug we are trying to fix.
  it('skips injection when the latest user message already starts with <system-reminder>', () => {
    const persisted = '<system-reminder>\nCAPS\n</system-reminder>\nactual user text';
    const messages: UnifiedMessage[] = [
      { role: 'user', content: 'old turn' },
      { role: 'assistant', content: 'old reply' },
      { role: 'user', content: persisted },
    ];

    const result = injectSyntheticRequestContextUnified(messages, ctx);

    expect(result[2]!.content).toBe(persisted);
    // Earlier user messages must never be touched either — the bug was
    // specifically that the legacy injector mutated *whichever* message
    // happened to be the latest user turn, breaking byte identity for
    // earlier user messages across turns.
    expect(result[0]!.content).toBe('old turn');
  });

  it('returns messages untouched when the synthetic block is empty', () => {
    const messages: UnifiedMessage[] = [{ role: 'user', content: 'hello' }];
    const result = injectSyntheticRequestContextUnified(messages, {
      injectedPrompt: null,
      capabilityContext: null,
      companionPrompt: null,
    });
    expect(result[0]!.content).toBe('hello');
  });

  it('only modifies the latest user message even when several user messages exist', () => {
    const messages: UnifiedMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'third' },
    ];

    const result = injectSyntheticRequestContextUnified(messages, ctx);

    expect(result[0]!.content).toBe('first');
    expect(result[2]!.content).toBe('second');
    expect(result[4]!.content).toBe('<system-reminder>\nCAPS\n</system-reminder>\n\nthird');
  });
});
