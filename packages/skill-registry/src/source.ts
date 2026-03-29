import type { RegistryInfo, RegistrySource } from './types.js';

export const OFFICIAL_REGISTRY_SOURCE: RegistrySource = {
  id: 'official',
  name: 'OpenAWork Official Registry',
  url: 'https://registry.openwork.ai/v1',
  type: 'official',
  trust: 'full',
  enabled: true,
  priority: 0,
};

export class RegistrySourceManager {
  private readonly sources = new Map<string, RegistrySource>();

  constructor(initialSources: RegistrySource[] = []) {
    this.sources.set(OFFICIAL_REGISTRY_SOURCE.id, { ...OFFICIAL_REGISTRY_SOURCE });
    for (const source of initialSources) {
      this.sources.set(source.id, { ...source });
    }
  }

  listSources(): RegistrySource[] {
    return [...this.sources.values()].sort((a, b) => a.priority - b.priority);
  }

  getSource(id: string): RegistrySource | undefined {
    const source = this.sources.get(id);
    return source ? { ...source } : undefined;
  }

  addSource(source: RegistrySource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Registry source already exists: ${source.id}`);
    }
    this.sources.set(source.id, { ...source });
  }

  updateSource(id: string, patch: Partial<Omit<RegistrySource, 'id'>>): RegistrySource {
    const current = this.sources.get(id);
    if (!current) {
      throw new Error(`Registry source not found: ${id}`);
    }
    const next = { ...current, ...patch };
    this.sources.set(id, next);
    return { ...next };
  }

  removeSource(id: string): void {
    if (id === OFFICIAL_REGISTRY_SOURCE.id) {
      throw new Error('Official source cannot be removed');
    }
    this.sources.delete(id);
  }

  enableSource(id: string): RegistrySource {
    return this.updateSource(id, { enabled: true });
  }

  disableSource(id: string): RegistrySource {
    if (id === OFFICIAL_REGISTRY_SOURCE.id) {
      throw new Error('Official source cannot be disabled');
    }
    return this.updateSource(id, { enabled: false });
  }

  async verifySource(id: string): Promise<RegistryInfo> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Registry source not found: ${id}`);
    }

    const infoUrl = `${source.url.replace(/\/$/, '')}/registry-info.json`;
    const response = await fetch(infoUrl, {
      method: 'GET',
      headers: this.buildHeaders(source),
    });

    if (!response.ok) {
      throw new Error(`Failed to verify source '${id}', HTTP ${response.status}`);
    }

    const registryInfo = (await response.json()) as RegistryInfo;
    if (!registryInfo.id || !registryInfo.name || !registryInfo.apiVersion) {
      throw new Error(`Registry source '${id}' returned invalid registry-info.json`);
    }

    this.sources.set(id, {
      ...source,
      lastVerifiedAt: Date.now(),
    });
    return registryInfo;
  }

  private buildHeaders(source: RegistrySource): HeadersInit {
    if (!source.auth || source.auth.type === 'none') {
      return {};
    }

    if (source.auth.type === 'bearer') {
      return {
        Authorization: `Bearer ${source.auth.token}`,
      };
    }

    return {
      [source.auth.header]: source.auth.value,
    };
  }
}
