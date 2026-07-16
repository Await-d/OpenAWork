// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  appendComposerInputHistoryEntry,
  MAX_COMPOSER_INPUT_HISTORY_ENTRIES,
} from './composer-input-history.js';

describe('appendComposerInputHistoryEntry', () => {
  it('只保留最新五十条输入历史', () => {
    let entries: readonly string[] = [];

    for (let index = 1; index <= MAX_COMPOSER_INPUT_HISTORY_ENTRIES + 5; index += 1) {
      entries = appendComposerInputHistoryEntry(entries, `prompt-${index}`);
    }

    expect(entries).toHaveLength(MAX_COMPOSER_INPUT_HISTORY_ENTRIES);
    expect(entries[0]).toBe('prompt-6');
    expect(entries.at(-1)).toBe('prompt-55');
  });

  it('忽略空白输入与相邻重复输入', () => {
    let entries: readonly string[] = [];

    entries = appendComposerInputHistoryEntry(entries, '   ');
    entries = appendComposerInputHistoryEntry(entries, 'first prompt');
    entries = appendComposerInputHistoryEntry(entries, 'first prompt');

    expect(entries).toEqual(['first prompt']);
  });
});
