import type { ProviderPersistenceAdapter } from './persistence.js';

export type { ProviderPersistenceAdapter };

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'ollama'
  | 'openrouter'
  | 'qwen'
  | 'moonshot'
  | 'custom';

export interface ThinkingConfig {
  enabled: boolean;
  budgetTokens?: number;
  mode?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface RequestOverrides {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  timeoutMs?: number;
  omitBodyKeys?: string[];
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface OAuthConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  scope?: string;
  audience?: string;
  usePkce?: boolean;
}

export interface AIModelConfig {
  id: string;
  label: string;
  enabled: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  thinking?: ThinkingConfig;
  requestOverrides?: RequestOverrides;
}

export interface AIProvider {
  id: string;
  type: ProviderType;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  oauth?: OAuthConfig;
  requestOverrides?: RequestOverrides;
  defaultModels: AIModelConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface ActiveSelection {
  chat: {
    providerId: string;
    modelId: string;
  };
  fast: {
    providerId: string;
    modelId: string;
  };
}

export interface ProviderConfig {
  providers: AIProvider[];
  active: ActiveSelection;
}

export interface ProviderManager {
  listProviders(): AIProvider[];
  addProviderFromPreset(type: ProviderType, overrides?: Partial<AIProvider>): AIProvider;
  updateProvider(
    providerId: string,
    updates: Partial<Omit<AIProvider, 'id' | 'type' | 'defaultModels'>>,
  ): AIProvider;
  removeProvider(providerId: string): boolean;
  toggleProviderEnabled(providerId: string, enabled?: boolean): AIProvider;
  addModel(providerId: string, model: AIModelConfig): AIProvider;
  updateModel(providerId: string, modelId: string, updates: Partial<AIModelConfig>): AIProvider;
  removeModel(providerId: string, modelId: string): AIProvider;
  toggleModelEnabled(providerId: string, modelId: string, enabled?: boolean): AIProvider;
  setActiveChat(providerId: string, modelId: string): ActiveSelection;
  setActiveFast(providerId: string, modelId: string): ActiveSelection;
  getChatProviderConfig(): { provider: AIProvider; model: AIModelConfig };
  getFastProviderConfig(): { provider: AIProvider; model: AIModelConfig };
  syncBuiltinPresets(): AIProvider[];
  getConfig(): ProviderConfig;
  setPersistenceAdapter(adapter: ProviderPersistenceAdapter): void;
}
