import { SkillInstaller } from './installer.js';
import { RegistrySourceManager } from './source.js';
import type {
  InstallOptions,
  InstalledSkillRecord,
  RegistrySource,
  SearchOptions,
  SkillEntry,
} from './types.js';

const REGISTRY_FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export interface SkillRegistryClient {
  search(options?: SearchOptions): Promise<SkillEntry[]>;
  getDetail(skillId: string, sourceId?: string): Promise<SkillEntry | undefined>;
  install(skillId: string, options?: InstallOptions): Promise<InstalledSkillRecord>;
  installFromLocal(
    localManifestPath: string,
    options?: InstallOptions,
  ): Promise<InstalledSkillRecord>;
  uninstall(skillId: string): Promise<boolean>;
  update(skillId: string, options?: InstallOptions): Promise<InstalledSkillRecord>;
  listInstalled(): InstalledSkillRecord[];
  checkUpdates(): Promise<
    Array<{ skillId: string; currentVersion: string; latestVersion: string }>
  >;
}

export class SkillRegistryClientImpl implements SkillRegistryClient {
  constructor(
    private readonly sourceManager = new RegistrySourceManager(),
    private readonly installer = new SkillInstaller(),
  ) {}

  async search(options: SearchOptions = {}): Promise<SkillEntry[]> {
    const enabledSources = this.listEnabledSources(options.sourceIds);
    const resultBySource = await Promise.all(
      enabledSources.map(async (source) => {
        const items = await this.fetchSearchFromSource(source, options).catch(
          () => [] as SkillEntry[],
        );
        return { source, items };
      }),
    );

    resultBySource.sort((a, b) => a.source.priority - b.source.priority);

    const deduped = new Map<string, SkillEntry>();
    for (const { source, items } of resultBySource) {
      for (const item of items) {
        if (!deduped.has(item.id)) {
          deduped.set(item.id, { ...item, sourceId: item.sourceId || source.id });
        }
      }
    }

    const merged = [...deduped.values()];
    const offset = options.offset ?? 0;
    const limit = options.limit;
    if (limit === undefined) {
      return merged.slice(offset);
    }
    return merged.slice(offset, offset + limit);
  }

  async fetchSourceSnapshot(
    sourceId: string,
    options: Omit<SearchOptions, 'sourceIds'> = {},
  ): Promise<SkillEntry[]> {
    const source = this.sourceManager.getSource(sourceId);
    if (!source || !source.enabled) {
      throw new Error(`Registry source not found or disabled: ${sourceId}`);
    }

    const items = await this.fetchSearchFromSource(source, options);
    return items.map((item) => ({ ...item, sourceId: item.sourceId || source.id }));
  }

  async getDetail(skillId: string, sourceId?: string): Promise<SkillEntry | undefined> {
    if (sourceId) {
      const source = this.sourceManager.getSource(sourceId);
      if (!source || !source.enabled) {
        return undefined;
      }
      return this.fetchSkillDetailFromSource(source, skillId).catch(() => undefined);
    }

    const sources = this.listEnabledSources();
    for (const source of sources) {
      const detail = await this.fetchSkillDetailFromSource(source, skillId).catch(() => undefined);
      if (detail) {
        return detail;
      }
    }
    return undefined;
  }

  async install(skillId: string, options: InstallOptions = {}): Promise<InstalledSkillRecord> {
    const detail = await this.getDetail(skillId, options.sourceId);
    if (!detail) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const source = this.sourceManager.getSource(detail.sourceId);
    if (!source) {
      throw new Error(`Source not found for skill '${skillId}': ${detail.sourceId}`);
    }

    if (source.trust === 'untrusted' && !options.allowUntrusted) {
      throw new Error(`Source '${source.id}' is untrusted; set allowUntrusted=true to continue`);
    }

    return this.installer.install(detail, {
      ...options,
      sourceId: source.id,
    });
  }

  async installFromLocal(
    localManifestPath: string,
    options: InstallOptions = {},
  ): Promise<InstalledSkillRecord> {
    return this.installer.installFromLocal(localManifestPath, {
      ...options,
      sourceId: options.sourceId ?? 'local',
      skipSignatureVerification: options.skipSignatureVerification ?? true,
      allowUntrusted: true,
    });
  }

  async uninstall(skillId: string): Promise<boolean> {
    return this.installer.uninstall(skillId);
  }

  async update(skillId: string, options: InstallOptions = {}): Promise<InstalledSkillRecord> {
    const installed = this.installer.getInstalled(skillId);
    if (!installed) {
      throw new Error(`Skill not installed: ${skillId}`);
    }

    const detail = await this.getDetail(skillId, installed.sourceId);
    if (!detail) {
      throw new Error(`Skill not found in source '${installed.sourceId}': ${skillId}`);
    }

    return this.installer.update(detail, {
      ...options,
      sourceId: installed.sourceId,
    });
  }

  listInstalled(): InstalledSkillRecord[] {
    return this.installer.listInstalled();
  }

  async checkUpdates(): Promise<
    Array<{ skillId: string; currentVersion: string; latestVersion: string }>
  > {
    const installed = this.installer.listInstalled();
    const checks = installed.map(async (record) => {
      const detail = await this.getDetail(record.skillId, record.sourceId);
      if (!detail) {
        return undefined;
      }

      const hasUpdate = this.compareVersions(detail.version, record.manifest.version) > 0;
      if (!hasUpdate) {
        return undefined;
      }

      return {
        skillId: record.skillId,
        currentVersion: record.manifest.version,
        latestVersion: detail.version,
      };
    });

    const resolved = await Promise.all(checks);
    return resolved.filter(
      (item): item is { skillId: string; currentVersion: string; latestVersion: string } => {
        return item !== undefined;
      },
    );
  }

  private listEnabledSources(sourceIds?: string[]): RegistrySource[] {
    return this.sourceManager
      .listSources()
      .filter((source) => source.enabled)
      .filter((source) => (sourceIds ? sourceIds.includes(source.id) : true))
      .sort((a, b) => a.priority - b.priority);
  }

  private async fetchSearchFromSource(
    source: RegistrySource,
    options: SearchOptions,
  ): Promise<SkillEntry[]> {
    const url = new URL(`${source.url.replace(/\/$/, '')}/skills/search.json`);
    if (options.query) {
      url.searchParams.set('q', options.query);
    }
    if (options.category) {
      url.searchParams.set('category', options.category);
    }
    if (options.capabilities && options.capabilities.length > 0) {
      url.searchParams.set('capabilities', options.capabilities.join(','));
    }
    if (options.limit !== undefined) {
      url.searchParams.set('limit', String(options.limit));
    }
    if (options.offset !== undefined) {
      url.searchParams.set('offset', String(options.offset));
    }

    const response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: this.buildHeaders(source),
    });
    if (!response.ok) {
      throw new Error(`Search failed for source '${source.id}', HTTP ${response.status}`);
    }

    const body = (await response.json()) as { items?: SkillEntry[] } | SkillEntry[];
    const items = Array.isArray(body) ? body : (body.items ?? []);
    return items.map((item) => ({ ...item, sourceId: item.sourceId || source.id }));
  }

  private async fetchSkillDetailFromSource(
    source: RegistrySource,
    skillId: string,
  ): Promise<SkillEntry | undefined> {
    const directUrl = `${source.url.replace(/\/$/, '')}/skills/${encodeURIComponent(skillId)}.json`;
    const response = await fetchWithTimeout(directUrl, {
      method: 'GET',
      headers: this.buildHeaders(source),
    });
    if (!response.ok) {
      return undefined;
    }

    const entry = (await response.json()) as SkillEntry;
    return {
      ...entry,
      sourceId: entry.sourceId || source.id,
    };
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

  private compareVersions(a: string, b: string): number {
    const parse = (value: string): number[] => {
      return value
        .split('.')
        .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ''), 10))
        .map((part) => (Number.isNaN(part) ? 0 : part));
    };

    const aParts = parse(a);
    const bParts = parse(b);
    const length = Math.max(aParts.length, bParts.length);
    for (let index = 0; index < length; index += 1) {
      const aPart = aParts[index] ?? 0;
      const bPart = bParts[index] ?? 0;
      if (aPart > bPart) {
        return 1;
      }
      if (aPart < bPart) {
        return -1;
      }
    }
    return 0;
  }
}
