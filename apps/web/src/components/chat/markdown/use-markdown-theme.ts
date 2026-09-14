import { useMemo, useSyncExternalStore } from 'react';
import {
  readAppliedTheme,
  readMarkdownThemeTokens,
  type MarkdownThemeMode,
  type MarkdownThemeTokens,
} from './theme-tokens.js';

/**
 * 监听 `<html>` 上的 `data-theme` / `data-mode`，在主题切换（含「跟随系统」
 * 时系统外观变化）后驱动富内容重新取色。
 *
 * 用 DOM 属性而不是 store 作为唯一事实来源：`data-mode` 是 App 解析
 * 主题模式 + 系统偏好后的最终结果，能避免 `themeMode === 'system'`
 * 时把深色界面渲染成浅色图表。
 *
 * 全局共用一个 MutationObserver：一条消息里可能有多个图表/表格，
 * 每个实例各建一个观察器没有必要。
 */
const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | null = null;

function ensureThemeObserver(): void {
  if (themeObserver || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return;
  }

  themeObserver = new MutationObserver(() => {
    for (const listener of themeListeners) {
      listener();
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-mode'],
  });
}

function subscribeToThemeChanges(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }

  ensureThemeObserver();
  themeListeners.add(onStoreChange);

  return () => {
    themeListeners.delete(onStoreChange);
  };
}

function readThemeSnapshot(): string {
  const { mode, style } = readAppliedTheme();
  return `${style}|${mode}`;
}

const SERVER_SNAPSHOT = 'nebula|dark';

/** 当前生效的主题风格与明暗模式。 */
export function useAppliedTheme(): { mode: MarkdownThemeMode; style: string } {
  const key = useSyncExternalStore(
    subscribeToThemeChanges,
    readThemeSnapshot,
    () => SERVER_SNAPSHOT,
  );
  const [style = 'nebula', mode = 'dark'] = key.split('|');
  return { mode: mode === 'light' ? 'light' : 'dark', style };
}

/** 当前生效主题归一化后的颜色 token。 */
export function useMarkdownThemeTokens(): MarkdownThemeTokens {
  const { mode, style } = useAppliedTheme();

  return useMemo(
    () => readMarkdownThemeTokens(),
    // 主题标识变化即重新取色；进一步的变化（同一主题下的变量微调）不由本层负责。
    [mode, style],
  );
}
