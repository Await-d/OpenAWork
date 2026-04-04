import type { MemorySettings } from './types.js';
import { DEFAULT_MEMORY_SETTINGS } from './schema.js';

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function parseMemorySettings(raw: unknown): MemorySettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_MEMORY_SETTINGS };
  }

  const record = raw as Record<string, unknown>;
  return {
    enabled:
      typeof record['enabled'] === 'boolean' ? record['enabled'] : DEFAULT_MEMORY_SETTINGS.enabled,
    autoExtract:
      typeof record['autoExtract'] === 'boolean'
        ? record['autoExtract']
        : DEFAULT_MEMORY_SETTINGS.autoExtract,
    maxTokenBudget:
      typeof record['maxTokenBudget'] === 'number'
        ? record['maxTokenBudget']
        : DEFAULT_MEMORY_SETTINGS.maxTokenBudget,
    minConfidence:
      typeof record['minConfidence'] === 'number'
        ? record['minConfidence']
        : DEFAULT_MEMORY_SETTINGS.minConfidence,
  };
}

export function normalizeMemoryKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
}
