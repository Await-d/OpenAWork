import type { AIProvider, ProviderType } from './types.js';
import {
  PROVIDER_CATALOG,
  getCatalogEntry,
  getDefaultUpstream,
  type ProviderCatalogEntry,
} from './catalog.js';

export type BuiltinProviderType = Exclude<ProviderType, 'custom'>;

type ProviderPreset = Omit<AIProvider, 'createdAt' | 'updatedAt'>;

/** 由单一事实来源(catalog)派生内置预设，不再各自维护一份副本。 */
const presetFromCatalog = (entry: ProviderCatalogEntry): ProviderPreset => {
  const upstream = getDefaultUpstream(entry);
  return {
    id: entry.type,
    type: entry.type,
    name: entry.displayName,
    enabled: entry.enabledByDefault,
    baseUrl: upstream?.baseUrl ?? '',
    ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
    ...(upstream?.protocol ? { upstreamProtocol: upstream.protocol } : {}),
    defaultModels: entry.defaultModels.map((model) => ({ ...model })),
  };
};

const BUILTIN_PRESETS: Record<BuiltinProviderType, ProviderPreset> = Object.fromEntries(
  PROVIDER_CATALOG.map((entry) => [entry.type, presetFromCatalog(entry)]),
) as Record<BuiltinProviderType, ProviderPreset>;

export const BUILTIN_PROVIDER_TYPES = Object.freeze(
  PROVIDER_CATALOG.map((entry) => entry.type),
) as readonly BuiltinProviderType[];

const clonePreset = (preset: ProviderPreset): ProviderPreset => ({
  ...preset,
  defaultModels: preset.defaultModels.map((model) => ({ ...model })),
  requestOverrides: preset.requestOverrides
    ? {
        ...preset.requestOverrides,
        omitBodyKeys: preset.requestOverrides.omitBodyKeys
          ? [...preset.requestOverrides.omitBodyKeys]
          : undefined,
      }
    : undefined,
});

export const getBuiltinProviderPreset = (type: BuiltinProviderType): AIProvider => {
  const now = new Date().toISOString();
  const preset = clonePreset(BUILTIN_PRESETS[type]);
  return {
    ...preset,
    createdAt: now,
    updatedAt: now,
  };
};

export const getAllBuiltinPresets = (): AIProvider[] =>
  BUILTIN_PROVIDER_TYPES.map((type) => getBuiltinProviderPreset(type));

/** 便捷转发：保留旧调用点对 catalog 条目的访问需求。 */
export { getCatalogEntry };
