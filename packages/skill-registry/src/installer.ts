import { parse as parseYaml } from 'yaml';
import type { SkillManifest, SkillPermission } from '@openAwork/skill-types';
import type { InstallOptions, InstalledSkillRecord, SkillEntry } from './types.js';

export interface PermissionGrantResult {
  granted: SkillPermission[];
  denied: SkillPermission[];
}

export type PermissionGrantHandler = (
  skillId: string,
  permissions: SkillPermission[],
) => Promise<PermissionGrantResult>;

export interface SkillInstallerOptions {
  permissionHandler?: PermissionGrantHandler;
  localFileReader?: (path: string) => Promise<string>;
  now?: () => number;
}

export class SkillInstaller {
  private readonly installedSkills = new Map<string, InstalledSkillRecord>();
  private readonly permissionHandler: PermissionGrantHandler;
  private readonly localFileReader: (path: string) => Promise<string>;
  private readonly now: () => number;

  constructor(options: SkillInstallerOptions = {}) {
    this.permissionHandler = options.permissionHandler ?? this.defaultPermissionHandler.bind(this);
    this.localFileReader = options.localFileReader ?? this.defaultLocalFileReader.bind(this);
    this.now = options.now ?? (() => Date.now());
  }

  listInstalled(): InstalledSkillRecord[] {
    return [...this.installedSkills.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getInstalled(skillId: string): InstalledSkillRecord | undefined {
    const record = this.installedSkills.get(skillId);
    return record ? { ...record, grantedPermissions: [...record.grantedPermissions] } : undefined;
  }

  async install(entry: SkillEntry, options: InstallOptions = {}): Promise<InstalledSkillRecord> {
    const sourceId = options.sourceId ?? entry.sourceId;
    const manifest = await this.parseManifestFromEntry(entry);
    await this.verifySignature(entry, manifest, options);
    const grantedPermissions = await this.resolvePermissions(manifest, options);
    return this.registerInstalledSkill(sourceId, manifest, grantedPermissions);
  }

  async installFromLocal(
    localManifestPath: string,
    options: InstallOptions = {},
  ): Promise<InstalledSkillRecord> {
    const rawManifest = await this.localFileReader(localManifestPath);
    const manifest = this.parseManifest(rawManifest);

    const entry: SkillEntry = {
      id: manifest.id,
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      description: manifest.description,
      category: 'other',
      sourceId: options.sourceId ?? 'local',
      tags: ['local'],
      manifest,
    };

    return this.install(entry, {
      ...options,
      sourceId: entry.sourceId,
    });
  }

  uninstall(skillId: string): boolean {
    return this.installedSkills.delete(skillId);
  }

  async update(entry: SkillEntry, options: InstallOptions = {}): Promise<InstalledSkillRecord> {
    const previous = this.installedSkills.get(entry.id);
    const updated = await this.install(entry, options);
    if (previous) {
      updated.installedAt = previous.installedAt;
      this.installedSkills.set(updated.skillId, updated);
    }
    return updated;
  }

  private async parseManifestFromEntry(entry: SkillEntry): Promise<SkillManifest> {
    if (entry.manifest) {
      this.validateManifest(entry.manifest);
      return entry.manifest;
    }

    if (!entry.manifestUrl) {
      throw new Error(`Skill '${entry.id}' does not provide manifest or manifestUrl`);
    }

    const response = await fetch(entry.manifestUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest for skill '${entry.id}', HTTP ${response.status}`);
    }

    const rawManifest = await response.text();
    return this.parseManifest(rawManifest);
  }

  private parseManifest(rawManifest: string): SkillManifest {
    const parsed = parseYaml(rawManifest);
    if (!this.isRecord(parsed)) {
      throw new Error('Invalid manifest: expected object root');
    }

    const manifest = parsed as unknown as SkillManifest;
    this.validateManifest(manifest);
    return manifest;
  }

  private async verifySignature(
    _entry: SkillEntry,
    _manifest: SkillManifest,
    options: InstallOptions,
  ): Promise<void> {
    const shouldSkip = options.skipSignatureVerification ?? true;
    if (shouldSkip) {
      return;
    }

    throw new Error('Signature verification not implemented in MVP');
  }

  private async resolvePermissions(
    manifest: SkillManifest,
    options: InstallOptions,
  ): Promise<SkillPermission[]> {
    const requested = manifest.permissions;
    if (requested.length === 0) {
      return [];
    }

    const explicitGrants = options.grantedPermissions;
    if (explicitGrants) {
      const deniedRequired = requested
        .filter((permission: SkillPermission) => permission.required)
        .filter(
          (permission: SkillPermission) => !this.containsPermission(explicitGrants, permission),
        );

      if (deniedRequired.length > 0) {
        throw new Error(`Required permissions denied for skill '${manifest.id}'`);
      }

      return explicitGrants;
    }

    const permissionResult = await this.permissionHandler(manifest.id, requested);
    const deniedRequired = requested
      .filter((permission: SkillPermission) => permission.required)
      .filter((permission: SkillPermission) =>
        this.containsPermission(permissionResult.denied, permission),
      );

    if (deniedRequired.length > 0) {
      throw new Error(`Required permissions denied for skill '${manifest.id}'`);
    }

    return permissionResult.granted;
  }

  private registerInstalledSkill(
    sourceId: string,
    manifest: SkillManifest,
    grantedPermissions: SkillPermission[],
  ): InstalledSkillRecord {
    const now = this.now();
    const existing = this.installedSkills.get(manifest.id);

    const record: InstalledSkillRecord = {
      skillId: manifest.id,
      sourceId,
      manifest,
      grantedPermissions: [...grantedPermissions],
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };

    this.installedSkills.set(record.skillId, record);
    return record;
  }

  private async defaultPermissionHandler(
    _skillId: string,
    permissions: SkillPermission[],
  ): Promise<PermissionGrantResult> {
    return {
      granted: permissions,
      denied: [],
    };
  }

  private async defaultLocalFileReader(path: string): Promise<string> {
    const directResponse = await fetch(path, { method: 'GET' }).catch(() => undefined);
    if (directResponse?.ok) {
      return directResponse.text();
    }

    const isAbsolutePath = path.startsWith('/');
    if (isAbsolutePath) {
      const fileUrl = `file://${path}`;
      const fileResponse = await fetch(fileUrl, { method: 'GET' }).catch(() => undefined);
      if (fileResponse?.ok) {
        return fileResponse.text();
      }
    }

    throw new Error(
      `Unable to read local manifest from '${path}'. Provide localFileReader for this runtime.`,
    );
  }

  private containsPermission(collection: SkillPermission[], target: SkillPermission): boolean {
    return collection.some((permission) => {
      return permission.type === target.type && permission.scope === target.scope;
    });
  }

  private validateManifest(manifest: SkillManifest): void {
    if (manifest.apiVersion !== 'agent-skill/v1') {
      throw new Error(`Invalid apiVersion for skill '${manifest.id}'`);
    }
    if (!manifest.id || !manifest.name || !manifest.displayName || !manifest.version) {
      throw new Error('Manifest missing required fields (id, name, displayName, version)');
    }
    if (!Array.isArray(manifest.capabilities)) {
      throw new Error(`Manifest capabilities must be an array for skill '${manifest.id}'`);
    }
    if (!Array.isArray(manifest.permissions)) {
      throw new Error(`Manifest permissions must be an array for skill '${manifest.id}'`);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
