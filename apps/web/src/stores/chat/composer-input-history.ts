import { create } from 'zustand';

export const MAX_COMPOSER_INPUT_HISTORY_ENTRIES = 50;

const EMPTY_HISTORY: readonly string[] = [];

interface ComposerInputHistoryStore {
  readonly historyByScope: Readonly<Record<string, readonly string[]>>;
  readonly recordEntry: (scope: string, text: string) => void;
  readonly moveEntries: (sourceScope: string, targetScope: string) => void;
}

export function appendComposerInputHistoryEntry(
  entries: readonly string[],
  text: string,
): readonly string[] {
  if (text.trim().length === 0) {
    return entries;
  }

  if (entries.at(-1) === text) {
    return entries;
  }

  return [...entries, text].slice(-MAX_COMPOSER_INPUT_HISTORY_ENTRIES);
}

export const useComposerInputHistoryStore = create<ComposerInputHistoryStore>()((set) => ({
  historyByScope: {},
  recordEntry: (scope, text) =>
    set((state) => {
      if (scope.trim().length === 0) {
        return state;
      }

      const nextEntries = appendComposerInputHistoryEntry(
        state.historyByScope[scope] ?? EMPTY_HISTORY,
        text,
      );

      if (nextEntries === state.historyByScope[scope]) {
        return state;
      }

      return {
        historyByScope: {
          ...state.historyByScope,
          [scope]: nextEntries,
        },
      };
    }),
  moveEntries: (sourceScope, targetScope) =>
    set((state) => {
      if (
        sourceScope.trim().length === 0 ||
        targetScope.trim().length === 0 ||
        sourceScope === targetScope
      ) {
        return state;
      }

      const sourceEntries = state.historyByScope[sourceScope];
      if (!sourceEntries || sourceEntries.length === 0) {
        return state;
      }

      let mergedEntries = state.historyByScope[targetScope] ?? EMPTY_HISTORY;
      for (const entry of sourceEntries) {
        mergedEntries = appendComposerInputHistoryEntry(mergedEntries, entry);
      }

      const nextHistoryByScope = { ...state.historyByScope };
      delete nextHistoryByScope[sourceScope];
      nextHistoryByScope[targetScope] = mergedEntries;
      return { historyByScope: nextHistoryByScope };
    }),
}));
