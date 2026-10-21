// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendComposerInputHistoryEntry,
  MAX_COMPOSER_INPUT_HISTORY_ENTRIES,
  normalizeComposerInputHistoryEntries,
  useComposerInputHistoryStore,
} from './composer-input-history.js';

beforeEach(() => {
  useComposerInputHistoryStore.setState((state) => ({ ...state, historyByScope: {} }));
});

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

describe('normalizeComposerInputHistoryEntries', () => {
  it('丢弃空白、相邻去重并只保留最新五十条', () => {
    const entries = normalizeComposerInputHistoryEntries(['   ', 'a', 'a', 'b', '', 'c']);

    expect(entries).toEqual(['a', 'b', 'c']);

    const many = Array.from(
      { length: MAX_COMPOSER_INPUT_HISTORY_ENTRIES + 3 },
      (_, index) => `prompt-${index + 1}`,
    );
    const trimmed = normalizeComposerInputHistoryEntries(many);
    expect(trimmed).toHaveLength(MAX_COMPOSER_INPUT_HISTORY_ENTRIES);
    expect(trimmed[0]).toBe('prompt-4');
    expect(trimmed.at(-1)).toBe(`prompt-${MAX_COMPOSER_INPUT_HISTORY_ENTRIES + 3}`);
  });
});

describe('useComposerInputHistoryStore', () => {
  it('replaceEntries 覆盖全量，且内容相同时保持引用稳定', () => {
    const store = useComposerInputHistoryStore.getState();
    store.replaceEntries('scope-a', ['旧一', '旧二']);

    expect(useComposerInputHistoryStore.getState().historyByScope['scope-a']).toEqual([
      '旧一',
      '旧二',
    ]);

    const snapshot = useComposerInputHistoryStore.getState().historyByScope;
    useComposerInputHistoryStore.getState().replaceEntries('scope-a', ['旧一', '旧二']);
    expect(useComposerInputHistoryStore.getState().historyByScope).toBe(snapshot);

    useComposerInputHistoryStore.getState().replaceEntries('scope-a', ['新一']);
    expect(useComposerInputHistoryStore.getState().historyByScope['scope-a']).toEqual(['新一']);
  });

  it('moveEntries 迁移条目并返回被迁移的文本', () => {
    useComposerInputHistoryStore.getState().replaceEntries('pending', ['首条', '次条']);

    const moved = useComposerInputHistoryStore.getState().moveEntries('pending', 'scope-session-1');

    expect(moved).toEqual(['首条', '次条']);
    expect(useComposerInputHistoryStore.getState().historyByScope).toEqual({
      'scope-session-1': ['首条', '次条'],
    });
  });

  it('moveEntries 在源 scope 为空时返回空数组且不创建目标 scope', () => {
    const moved = useComposerInputHistoryStore.getState().moveEntries('pending-missing', 'target');

    expect(moved).toEqual([]);
    expect(useComposerInputHistoryStore.getState().historyByScope).toEqual({});
  });
});
