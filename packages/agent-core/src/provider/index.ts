export type {
  ProviderType,
  ThinkingConfig,
  RequestOverrides,
  OAuthConfig,
  AIModelConfig,
  AIProvider,
  ActiveSelection,
  ProviderConfig,
  ProviderManager,
} from './types.js';

export {
  BUILTIN_PROVIDER_TYPES,
  getAllBuiltinPresets,
  getBuiltinProviderPreset,
} from './presets.js';

export {
  PROVIDER_CATALOG,
  getCatalogEntry,
  getDefaultUpstream,
  resolveThinkingStyle,
  catalogModelSupportsThinking,
  inferProviderTypeFromHostname,
  normalizeProviderAlias,
  inferProviderLabelFromModelId,
  getProviderDisplayName,
  getProviderCatalogUi,
} from './catalog.js';
export type {
  ProviderCatalogEntry,
  ProviderUpstreamVariant,
  ProviderUiMeta,
  ProviderThinkingStyle,
  ProviderCatalogUiEntry,
  CatalogUpstreamProtocol,
} from './catalog.js';

export {
  get as getModelsDevData,
  getSync as getModelsDevDataSync,
  refresh as refreshModelsDevData,
  refreshOrThrow as refreshModelsDevDataOrThrow,
  startPeriodicRefresh as startModelsDevRefresh,
  stopPeriodicRefresh as stopModelsDevRefresh,
  mapModelsDevModel,
  resolveModelsDevProvider,
} from './models-dev.js';
export type { ModelsDevData, ModelsDevProvider, ModelsDevModel } from './models-dev.js';

export { ProviderManagerImpl } from './manager.js';

export type { OAuthFlowManager, OAuthTokens, PlatformOAuthAdapter } from './oauth.js';
export { OAuthFlowManagerImpl } from './oauth.js';

export type { ProviderPersistenceAdapter } from './persistence.js';
export { InMemoryPersistenceAdapter } from './persistence.js';

export {
  normalizeProviderBaseUrl,
  mergeBuiltinModels,
  buildRequestOverrides,
  calculateTokenCost,
  calculateTokenUsageCost,
  MAX_PRICE_PER_MILLION,
  MAX_USAGE_TOKENS,
  normalizeOptionalTokenPrice,
  normalizeTokenCount,
} from './utils.js';
export type { TokenUsageCostInput } from './utils.js';
