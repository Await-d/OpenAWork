export interface AppSettings {
  version: number;
  autoApprove: boolean;
  devMode: boolean;
  thinkingEnabled: boolean;
  fastModeEnabled: boolean;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  teamToolsEnabled: boolean;
  contextCompressionEnabled: boolean;
  toolResultFormat: 'toon' | 'json';
  webSearchEnabled: boolean;
  webSearchProvider:
    | 'duckduckgo'
    | 'tavily'
    | 'exa'
    | 'serper'
    | 'searxng'
    | 'bocha'
    | 'zhipu'
    | 'google'
    | 'bing';
  webSearchApiKey: string;
  webSearchBaseUrl: string;
  webSearchMaxResults: number;
  backgroundColor: string;
  fontFamily: string;
  toolbarCollapsedByDefault: boolean;
  leftSidebarWidth: number;
  newSessionDefaultModel: {
    providerId: string;
    modelId: string;
    useGlobalActiveModel: boolean;
  } | null;
  promptRecommendationModels: Record<
    'chat' | 'clarify' | 'cowork' | 'code',
    { providerId: string; modelId: string } | null
  > | null;
  fontSize: number;
  animationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 2,
  autoApprove: false,
  devMode: false,
  thinkingEnabled: false,
  fastModeEnabled: false,
  reasoningEffort: 'medium',
  teamToolsEnabled: false,
  contextCompressionEnabled: true,
  toolResultFormat: 'toon',
  webSearchEnabled: false,
  webSearchProvider: 'duckduckgo',
  webSearchApiKey: '',
  webSearchBaseUrl: '',
  webSearchMaxResults: 5,
  backgroundColor: '',
  fontFamily: '',
  toolbarCollapsedByDefault: false,
  leftSidebarWidth: 280,
  newSessionDefaultModel: null,
  promptRecommendationModels: null,
  fontSize: 16,
  animationsEnabled: true,
};

export interface SettingsManager {
  get(): AppSettings;
  update(patch: Partial<AppSettings>): AppSettings;
  reset(): AppSettings;
  migrate(persisted: unknown, fromVersion: number): AppSettings;
}
