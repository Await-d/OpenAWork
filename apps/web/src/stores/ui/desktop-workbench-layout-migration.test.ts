import { beforeEach, describe, expect, it } from 'vitest';
import {
  DESKTOP_WORKBENCH_LAYOUT_MIGRATION_KEY,
  migrateDesktopWorkbenchLayout,
} from './desktop-workbench-layout-migration.js';
import { useUIStateStore } from './uiState.js';

function createMemoryStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  clear(): void;
} {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    clear() {
      values.clear();
    },
  };
}

function resetLayoutMode(mode: 'classic' | 'fusion' = 'fusion'): void {
  useUIStateStore.setState({ workbenchLayoutMode: mode });
}

const storage = createMemoryStorage();

beforeEach(() => {
  storage.clear();
  resetLayoutMode();
});

describe('migrateDesktopWorkbenchLayout', () => {
  it('desktop 首次迁移时把遗留 classic 布局切回 fusion', () => {
    resetLayoutMode('classic');

    migrateDesktopWorkbenchLayout({
      isDesktopRuntime: true,
      storage,
    });

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('fusion');
    expect(storage.getItem(DESKTOP_WORKBENCH_LAYOUT_MIGRATION_KEY)).toBe('1');
  });

  it('桌面端迁移只执行一次，不覆盖用户后续重新切回 classic 的选择', () => {
    storage.setItem(DESKTOP_WORKBENCH_LAYOUT_MIGRATION_KEY, '1');
    resetLayoutMode('classic');

    migrateDesktopWorkbenchLayout({
      isDesktopRuntime: true,
      storage,
    });

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
  });

  it('非桌面运行时不执行迁移', () => {
    resetLayoutMode('classic');

    migrateDesktopWorkbenchLayout({
      isDesktopRuntime: false,
      storage,
    });

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
    expect(storage.getItem(DESKTOP_WORKBENCH_LAYOUT_MIGRATION_KEY)).toBeNull();
  });
});
