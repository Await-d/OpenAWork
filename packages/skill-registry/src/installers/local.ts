import { parse as parseYaml } from 'yaml';
import type { SkillManifest } from '@openAwork/skill-types';
import type { InstallOptions, InstalledSkillRecord, SkillEntry } from '../types.js';
import { SkillInstaller } from '../installer.js';

export interface WatchHandle {
  stop: () => void;
}

export interface LocalInstallerOptions {
  installer?: SkillInstaller;
  fetchFn?: typeof fetch;
  watchFn?: (path: string, onChange: () => void) => WatchHandle;
  symlinkFn?: (src: string, dest: string) => Promise<void>;
  installBaseDir?: string;
}

export interface LocalSkillRecord extends InstalledSkillRecord {
  localPath: string;
  watchHandle?: WatchHandle;
}

export class LocalInstaller {
  private readonly installer: SkillInstaller;
  private readonly fetchFn: typeof fetch;
  private readonly watchFn: (path: string, onChange: () => void) => WatchHandle;
  private readonly symlinkFn: (src: string, dest: string) => Promise<void>;
  private readonly installBaseDir: string;
  private readonly localSkills = new Map<string, LocalSkillRecord>();

  constructor(options: LocalInstallerOptions = {}) {
    this.installer = options.installer ?? new SkillInstaller();
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.watchFn = options.watchFn ?? this.stubWatch.bind(this);
    this.symlinkFn = options.symlinkFn ?? this.stubSymlink.bind(this);
    this.installBaseDir = options.installBaseDir ?? '/tmp/openwork-skills/local';
  }

  async installFromLocalDir(
    dirPath: string,
    options: InstallOptions = {},
  ): Promise<LocalSkillRecord> {
    const manifestPath = `${dirPath.replace(/\/$/, '')}/skill.yaml`;
    const manifest = await this.readManifest(manifestPath);

    await this.symlinkFn(dirPath, `${this.installBaseDir}/${manifest.id}`);

    const entry = this.buildLocalEntry(manifest, dirPath);
    const record = await this.installer.install(entry, {
      ...options,
      sourceId: 'local',
      skipSignatureVerification: true,
      allowUntrusted: true,
    });

    const localRecord: LocalSkillRecord = { ...record, localPath: dirPath };

    const watchHandle = this.watchFn(manifestPath, () => {
      void this.onManifestChanged(dirPath, options);
    });
    localRecord.watchHandle = watchHandle;

    this.localSkills.set(manifest.id, localRecord);
    return localRecord;
  }

  stopWatching(skillId: string): void {
    const record = this.localSkills.get(skillId);
    if (record?.watchHandle) {
      record.watchHandle.stop();
      this.localSkills.set(skillId, { ...record, watchHandle: undefined });
    }
  }

  stopAllWatchers(): void {
    for (const skillId of this.localSkills.keys()) {
      this.stopWatching(skillId);
    }
  }

  getLocalSkill(skillId: string): LocalSkillRecord | undefined {
    return this.localSkills.get(skillId);
  }

  listLocalSkills(): LocalSkillRecord[] {
    return [...this.localSkills.values()];
  }

  private async onManifestChanged(dirPath: string, options: InstallOptions): Promise<void> {
    await this.installFromLocalDir(dirPath, options).catch(() => undefined);
  }

  private async readManifest(manifestPath: string): Promise<SkillManifest> {
    const fileUrl = `file://${manifestPath}`;
    const response = await this.fetchFn(fileUrl);
    if (!response.ok) {
      throw new Error(`Cannot read skill.yaml at: ${manifestPath}`);
    }
    const raw = await response.text();
    const parsed = parseYaml(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Invalid skill.yaml at: ${manifestPath}`);
    }
    return parsed as SkillManifest;
  }

  private buildLocalEntry(manifest: SkillManifest, dirPath: string): SkillEntry {
    return {
      id: manifest.id,
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      description: manifest.description,
      category: 'other',
      sourceId: 'local',
      tags: ['local'],
      manifest,
      manifestUrl: `file://${dirPath}/skill.yaml`,
    };
  }

  private stubWatch(_path: string, _onChange: () => void): WatchHandle {
    return { stop: () => undefined };
  }

  private async stubSymlink(_src: string, _dest: string): Promise<void> {
    return undefined;
  }
}
