import { create } from 'zustand';

export const MAX_COMPOSER_INPUT_HISTORY_ENTRIES = 50;

const EMPTY_HISTORY: readonly string[] = [];

interface ComposerInputHistoryStore {
  readonly historyByScope: Readonly<Record<string, readonly string[]>>;
  readonly recordEntry: (scope: string, text: string) => void;
  /**
   * 以服务端结果覆盖某个 scope 的全量历史。
   *
   * 服务端是唯一真相源（每会话最多 50 条、相邻去重），水合与写入响应都走这里，
   * 保证两端的裁剪结果不会因为本地版本差异而分叉。
   */
  readonly replaceEntries: (scope: string, entries: readonly string[]) => void;
  /**
   * 把 pending（尚未有 sessionId）期间的历史迁移到真实会话 scope。
   *
   * 返回被迁移的条目，调用方据此把它们写入网关——迁移只发生在内存里的话，
   * 刷新后依然会丢。
   */
  readonly moveEntries: (sourceScope: string, targetScope: string) => readonly string[];
}

/**
 * 规范化一份历史：丢弃空白、相邻去重、只保留最新 50 条。
 *
 * 与服务端 `appendComposerInputHistory` 同一语义；客户端保留它是为了在
 * 「网关没问成」的降级路径上仍能得到一致形状，而不是把脏数据渲染进历史导航。
 */
export function normalizeComposerInputHistoryEntries(
  entries: readonly string[],
): readonly string[] {
  const normalized: string[] = [];
  for (const text of entries) {
    if (text.trim().length === 0) {
      continue;
    }
    if (normalized.at(-1) === text) {
      continue;
    }
    normalized.push(text);
  }
  return normalized.slice(-MAX_COMPOSER_INPUT_HISTORY_ENTRIES);
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
  replaceEntries: (scope, entries) =>
    set((state) => {
      if (scope.trim().length === 0) {
        return state;
      }

      const nextEntries = normalizeComposerInputHistoryEntries(entries);
      const currentEntries = state.historyByScope[scope] ?? EMPTY_HISTORY;
      // 引用稳定：水合响应与本地缓存完全一致时不要触发订阅者重渲染，
      // 否则历史浏览的 effect 会因为「数组换了但内容没变」反复空转。
      if (
        currentEntries.length === nextEntries.length &&
        currentEntries.every((entry, index) => entry === nextEntries[index])
      ) {
        return state;
      }

      return {
        historyByScope: {
          ...state.historyByScope,
          [scope]: nextEntries,
        },
      };
    }),
  moveEntries: (sourceScope, targetScope) => {
    let movedEntries: readonly string[] = EMPTY_HISTORY;
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

      movedEntries = [...sourceEntries];
      const nextHistoryByScope = { ...state.historyByScope };
      delete nextHistoryByScope[sourceScope];
      nextHistoryByScope[targetScope] = mergedEntries;
      return { historyByScope: nextHistoryByScope };
    });
    return movedEntries;
  },
}));
