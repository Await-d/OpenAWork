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
  get as getModelsDevData,
  getSync as getModelsDevDataSync,
  refresh as refreshModelsDevData,
  startPeriodicRefresh as startModelsDevRefresh,
  stopPeriodicRefresh as stopModelsDevRefresh,
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
} from './utils.js';
