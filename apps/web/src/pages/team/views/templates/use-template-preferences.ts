/**
 * 模板偏好 hook：把 template-preferences 的本地持久化逻辑包成 React 状态。
 *
 * 提供收藏切换 / 记录使用 / 查询，自动读写 localStorage。
 */

import { useCallback, useState } from 'react';
import {
  isFavorite as isFavoriteFn,
  loadPreferences,
  pruneToExisting as pruneToExistingFn,
  savePreferences,
  toggleFavorite as toggleFavoriteFn,
  touchUsage as touchUsageFn,
  type TemplatePreferences,
} from './template-preferences.js';

export interface UseTemplatePreferences {
  prefs: TemplatePreferences;
  isFavorite: (templateId: string) => boolean;
  toggleFavorite: (templateId: string) => void;
  /** 记录一次「使用」（采用模板 / 据它新建会话）。 */
  recordUsage: (templateId: string) => void;
  /** 清理已不存在的模板 id（模板列表加载后调用，避免脏数据残留）。 */
  prune: (existingIds: ReadonlySet<string>) => void;
}

export function useTemplatePreferences(): UseTemplatePreferences {
  const [prefs, setPrefs] = useState<TemplatePreferences>(() => loadPreferences());

  const persist = useCallback((next: TemplatePreferences) => {
    setPrefs(next);
    savePreferences(next);
  }, []);

  const toggleFavorite = useCallback(
    (templateId: string) => {
      persist(toggleFavoriteFn(loadPreferences(), templateId));
    },
    [persist],
  );

  const recordUsage = useCallback(
    (templateId: string) => {
      persist(touchUsageFn(loadPreferences(), templateId));
    },
    [persist],
  );

  const isFavorite = useCallback((templateId: string) => isFavoriteFn(prefs, templateId), [prefs]);

  const prune = useCallback(
    (existingIds: ReadonlySet<string>) => {
      const current = loadPreferences();
      const next = pruneToExistingFn(current, existingIds);
      // 仅在确有变化时落盘 / 触发 re-render，避免无谓写入。
      if (
        next.favorites.length !== current.favorites.length ||
        Object.keys(next.recent).length !== Object.keys(current.recent).length ||
        Object.keys(next.usage).length !== Object.keys(current.usage).length
      ) {
        persist(next);
      }
    },
    [persist],
  );

  return { prefs, isFavorite, toggleFavorite, recordUsage, prune };
}
