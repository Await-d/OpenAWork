// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'openAwork-display-preferences';

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

describe('useDisplayPreferencesStore', () => {
  it('没有持久化 store 时，沿用旧版 theme 键作为初始主题模式', async () => {
    window.localStorage.setItem('theme', 'light');

    const { useDisplayPreferencesStore } = await import('./display-preferences.js');

    expect(useDisplayPreferencesStore.getState().themeMode).toBe('light');
  });

  it('已有持久化主题模式时，优先使用持久化值而不是旧版 theme 键', async () => {
    window.localStorage.setItem('theme', 'light');
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          themeMode: 'dark',
        },
        version: 2,
      }),
    );

    const { useDisplayPreferencesStore } = await import('./display-preferences.js');

    expect(useDisplayPreferencesStore.getState().themeMode).toBe('dark');
  });
});
