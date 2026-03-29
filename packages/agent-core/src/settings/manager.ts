import type { AppSettings, SettingsManager } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';

export class SettingsManagerImpl implements SettingsManager {
  private current: AppSettings = { ...DEFAULT_SETTINGS };

  get(): AppSettings {
    return { ...this.current };
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.current = { ...this.current, ...patch };
    return { ...this.current };
  }

  reset(): AppSettings {
    this.current = { ...DEFAULT_SETTINGS };
    return { ...this.current };
  }

  migrate(persisted: unknown, fromVersion: number): AppSettings {
    const source =
      persisted !== null && typeof persisted === 'object'
        ? (persisted as Record<string, unknown>)
        : {};
    const result = { ...DEFAULT_SETTINGS };

    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      if (key in source && source[key] !== undefined) {
        (result as Record<string, unknown>)[key] = source[key];
      }
    }

    if (fromVersion < 2) {
      if (!('backgroundColor' in source)) result.backgroundColor = '';
      if (!('fontFamily' in source)) result.fontFamily = '';
      if (!('toolbarCollapsedByDefault' in source)) result.toolbarCollapsedByDefault = false;
      if (!('leftSidebarWidth' in source)) result.leftSidebarWidth = 280;
      if (!('newSessionDefaultModel' in source)) result.newSessionDefaultModel = null;
      if (!('promptRecommendationModels' in source)) result.promptRecommendationModels = null;
    }

    result.version = DEFAULT_SETTINGS.version;
    this.current = result;
    return { ...this.current };
  }
}
