export interface SkillSearchResult {
  id: string;
  name: string;
  version: string;
  description: string;
  source: string;
  downloads?: number;
}

export interface InstalledSkill {
  id: string;
  name: string;
  version: string;
  source: string;
  installedAt: number;
}

export interface UpdateAvailable {
  skillId: string;
  currentVersion: string;
  latestVersion: string;
}

export interface SearchOptions {
  source?: string;
  category?: string;
}

export interface InstallOptions {
  source?: string;
}

export interface SkillRegistryClient {
  search(query: string, options?: SearchOptions): Promise<SkillSearchResult[]>;
  install(skillId: string, options?: InstallOptions): Promise<InstalledSkill>;
  update(skillId: string): Promise<InstalledSkill>;
  checkUpdates(): Promise<UpdateAvailable[]>;
  listInstalled(): Promise<InstalledSkill[]>;
}

export class SkillRegistryClientImpl implements SkillRegistryClient {
  private readonly installed = new Map<string, InstalledSkill>();

  async search(query: string, options?: SearchOptions): Promise<SkillSearchResult[]> {
    void query;
    void options;
    return [];
  }

  async install(skillId: string, options?: InstallOptions): Promise<InstalledSkill> {
    const skill: InstalledSkill = {
      id: skillId,
      name: skillId,
      version: '0.0.0',
      source: options?.source ?? 'registry',
      installedAt: Date.now(),
    };
    this.installed.set(skillId, skill);
    return skill;
  }

  async update(skillId: string): Promise<InstalledSkill> {
    const existing = this.installed.get(skillId);
    if (!existing) {
      throw new Error(`Skill not installed: ${skillId}`);
    }
    const updated: InstalledSkill = { ...existing, version: '0.0.0' };
    this.installed.set(skillId, updated);
    return updated;
  }

  async checkUpdates(): Promise<UpdateAvailable[]> {
    return [];
  }

  async listInstalled(): Promise<InstalledSkill[]> {
    return Array.from(this.installed.values());
  }
}

export const skillRegistryClient: SkillRegistryClient = new SkillRegistryClientImpl();
