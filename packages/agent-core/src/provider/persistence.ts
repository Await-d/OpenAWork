import type { AIProvider, ActiveSelection } from './types.js';

export interface ProviderPersistenceAdapter {
  saveApiKey(providerId: string, key: string): Promise<void>;
  loadApiKey(providerId: string): Promise<string | null>;
  saveProviderConfig(providers: AIProvider[], active: ActiveSelection): Promise<void>;
  loadProviderConfig(): Promise<{
    providers: AIProvider[];
    active: ActiveSelection;
  } | null>;
}

const API_KEY_PREFIX = 'api-key:';
const PROVIDER_CONFIG_KEY = 'provider-config';

const cloneProviders = (providers: AIProvider[]): AIProvider[] => structuredClone(providers);

const cloneActiveSelection = (active: ActiveSelection): ActiveSelection => structuredClone(active);

export class InMemoryPersistenceAdapter implements ProviderPersistenceAdapter {
  private readonly storage = new Map<
    string,
    string | { providers: AIProvider[]; active: ActiveSelection }
  >();

  public async saveApiKey(providerId: string, key: string): Promise<void> {
    this.storage.set(`${API_KEY_PREFIX}${providerId}`, key);
  }

  public async loadApiKey(providerId: string): Promise<string | null> {
    const value = this.storage.get(`${API_KEY_PREFIX}${providerId}`);
    return typeof value === 'string' ? value : null;
  }

  public async saveProviderConfig(providers: AIProvider[], active: ActiveSelection): Promise<void> {
    this.storage.set(PROVIDER_CONFIG_KEY, {
      providers: cloneProviders(providers),
      active: cloneActiveSelection(active),
    });
  }

  public async loadProviderConfig(): Promise<{
    providers: AIProvider[];
    active: ActiveSelection;
  } | null> {
    const value = this.storage.get(PROVIDER_CONFIG_KEY);
    if (!value || typeof value === 'string') {
      return null;
    }

    return {
      providers: cloneProviders(value.providers),
      active: cloneActiveSelection(value.active),
    };
  }
}
