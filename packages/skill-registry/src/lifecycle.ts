import type { InstalledSkillRecord } from './types.js';
import { SkillInstaller } from './installer.js';
import { SkillRegistryClientImpl } from './client.js';

export interface UpdateAvailable {
  skillId: string;
  currentVersion: string;
  latestVersion: string;
  sourceId: string;
}

export interface ToolRegistryAdapter {
  deregister: (skillId: string) => void;
  register: (skillId: string, manifest: InstalledSkillRecord['manifest']) => void;
}

export interface SecureStoreAdapter {
  clearPermissions: (skillId: string) => Promise<void>;
}

export interface AuditLogAdapter {
  log: (event: AuditEvent) => void;
}

export interface AuditEvent {
  type: 'skill_install' | 'skill_uninstall' | 'skill_update';
  skillId: string;
  version: string;
  sourceId: string;
  timestamp: number;
}

export interface SkillLifecycleOptions {
  installer?: SkillInstaller;
  client?: SkillRegistryClientImpl;
  toolRegistry?: ToolRegistryAdapter;
  secureStore?: SecureStoreAdapter;
  auditLog?: AuditLogAdapter;
  now?: () => number;
}

/** 三个生命周期适配器的非空集合——仅由 requireLifecycleAdapters() 在守卫通过后返回。 */
interface LifecycleAdapters {
  toolRegistry: ToolRegistryAdapter;
  secureStore: SecureStoreAdapter;
  auditLog: AuditLogAdapter;
}

export class SkillLifecycle {
  private readonly installer: SkillInstaller;
  private readonly client: SkillRegistryClientImpl;
  private readonly toolRegistry?: ToolRegistryAdapter;
  private readonly secureStore?: SecureStoreAdapter;
  private readonly auditLog?: AuditLogAdapter;
  private readonly now: () => number;

  constructor(options: SkillLifecycleOptions = {}) {
    this.installer = options.installer ?? new SkillInstaller();
    this.client = options.client ?? new SkillRegistryClientImpl();
    this.toolRegistry = options.toolRegistry;
    this.secureStore = options.secureStore;
    this.auditLog = options.auditLog;
    this.now = options.now ?? (() => Date.now());
  }

  async uninstall(skillId: string): Promise<void> {
    const { toolRegistry, secureStore, auditLog } = this.requireLifecycleAdapters();

    const record = this.installer.getInstalled(skillId);
    if (!record) {
      throw new Error(`Skill not installed: ${skillId}`);
    }

    toolRegistry.deregister(skillId);
    await secureStore.clearPermissions(skillId);
    this.installer.uninstall(skillId);

    auditLog.log({
      type: 'skill_uninstall',
      skillId,
      version: record.manifest.version,
      sourceId: record.sourceId,
      timestamp: this.now(),
    });
  }

  async update(skillId: string): Promise<InstalledSkillRecord> {
    const { toolRegistry, auditLog } = this.requireLifecycleAdapters();

    const record = this.installer.getInstalled(skillId);
    if (!record) {
      throw new Error(`Skill not installed: ${skillId}`);
    }

    const detail = await this.client.getDetail(skillId, record.sourceId);
    if (!detail) {
      throw new Error(`Skill not found in source '${record.sourceId}': ${skillId}`);
    }

    toolRegistry.deregister(skillId);
    const updated = await this.installer.update(detail, {
      sourceId: record.sourceId,
    });
    toolRegistry.register(skillId, updated.manifest);

    auditLog.log({
      type: 'skill_update',
      skillId,
      version: updated.manifest.version,
      sourceId: updated.sourceId,
      timestamp: this.now(),
    });

    return updated;
  }

  async checkUpdates(): Promise<UpdateAvailable[]> {
    const installed = this.installer.listInstalled();
    const results = await Promise.all(
      installed.map(async (record): Promise<UpdateAvailable | undefined> => {
        const detail = await this.client
          .getDetail(record.skillId, record.sourceId)
          .catch(() => undefined);
        if (!detail) return undefined;
        if (this.compareVersions(detail.version, record.manifest.version) <= 0) return undefined;
        return {
          skillId: record.skillId,
          currentVersion: record.manifest.version,
          latestVersion: detail.version,
          sourceId: record.sourceId,
        };
      }),
    );
    return results.filter((r): r is UpdateAvailable => r !== undefined);
  }

  private compareVersions(a: string, b: string): number {
    const parse = (v: string): number[] =>
      v
        .split('.')
        .map((p) => Number.parseInt(p.replace(/[^0-9].*$/, ''), 10))
        .map((n) => (Number.isNaN(n) ? 0 : n));
    const aParts = parse(a);
    const bParts = parse(b);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  // 校验适配器齐备；缺失时抛错，避免调用方误以为注销 / 权限清理 / 审计已真实发生。
  private requireLifecycleAdapters(): LifecycleAdapters {
    const { toolRegistry, secureStore, auditLog } = this;
    if (toolRegistry && secureStore && auditLog) {
      return { toolRegistry, secureStore, auditLog };
    }

    const missing = [
      toolRegistry ? undefined : 'toolRegistry',
      secureStore ? undefined : 'secureStore',
      auditLog ? undefined : 'auditLog',
    ].filter((name): name is string => name !== undefined);

    throw new Error(
      `SkillLifecycle 缺少必需适配器（${missing.join('/')}），拒绝在无审计、无权限清理的情况下静默执行卸载/更新`,
    );
  }
}
