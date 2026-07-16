import { useUIStateStore } from './uiState.js';

export const DESKTOP_WORKBENCH_LAYOUT_MIGRATION_KEY =
  'openAwork.desktop.workbench-layout-migration.v0.6.9';

interface MigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface DesktopWorkbenchLayoutMigrationOptions {
  readonly isDesktopRuntime: boolean;
  readonly storage?: MigrationStorage;
}

export function migrateDesktopWorkbenchLayout(
  options: DesktopWorkbenchLayoutMigrationOptions,
): void {
  if (!options.isDesktopRuntime || !options.storage) {
    return;
  }

  if (options.storage.getItem(DESKTOP_WORKBENCH_LAYOUT_MIGRATION_KEY) === '1') {
    return;
  }

  const state = useUIStateStore.getState();
  if (state.workbenchLayoutMode !== 'fusion') {
    state.setWorkbenchLayoutMode('fusion');
  }

  options.storage.setItem(DESKTOP_WORKBENCH_LAYOUT_MIGRATION_KEY, '1');
}
