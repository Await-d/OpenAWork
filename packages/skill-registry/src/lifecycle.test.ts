import { describe, expect, it, vi } from 'vitest';
import type { SkillManifest } from '@openAwork/skill-types';
import { SkillRegistryClientImpl } from './client.js';
import { SkillInstaller } from './installer.js';
import { SkillLifecycle } from './lifecycle.js';
import type {
  AuditEvent,
  AuditLogAdapter,
  SecureStoreAdapter,
  ToolRegistryAdapter,
} from './lifecycle.js';
import type { SkillEntry } from './types.js';

const SKILL_ID = 'skill-demo';

function demoManifest(version: string): SkillManifest {
  return {
    apiVersion: 'agent-skill/v1',
    id: SKILL_ID,
    name: 'demo',
    displayName: 'Demo',
    version,
    description: '演示技能',
    capabilities: [],
    permissions: [],
  };
}

function demoEntry(version: string): SkillEntry {
  const manifest = demoManifest(version);
  return {
    id: manifest.id,
    name: manifest.name,
    displayName: manifest.displayName,
    version: manifest.version,
    description: manifest.description,
    category: 'other',
    sourceId: 'official',
    tags: [],
    manifest,
  };
}

// 测试替身：getDetail 返回固定版本，避免触发真实网络请求。
class StubRegistryClient extends SkillRegistryClientImpl {
  constructor(private readonly latestVersion: string) {
    super();
  }

  override async getDetail(skillId: string, _sourceId?: string): Promise<SkillEntry | undefined> {
    return skillId === SKILL_ID ? demoEntry(this.latestVersion) : undefined;
  }
}

async function installerWithDemoSkill(): Promise<SkillInstaller> {
  const installer = new SkillInstaller();
  await installer.install(demoEntry('1.0.0'));
  return installer;
}

describe('SkillLifecycle 适配器守卫', () => {
  it('未注入适配器时 uninstall() 抛出错误，且技能仍处于已安装状态', async () => {
    const installer = await installerWithDemoSkill();
    const lifecycle = new SkillLifecycle({ installer });

    await expect(lifecycle.uninstall(SKILL_ID)).rejects.toThrow(
      /缺少必需适配器（toolRegistry\/secureStore\/auditLog）/,
    );
    expect(installer.getInstalled(SKILL_ID)).toBeDefined();
  });

  it('未注入适配器时 update() 抛出错误，且版本记录保持不变', async () => {
    const installer = await installerWithDemoSkill();
    const lifecycle = new SkillLifecycle({
      installer,
      client: new StubRegistryClient('2.0.0'),
    });

    await expect(lifecycle.update(SKILL_ID)).rejects.toThrow(/缺少必需适配器/);
    expect(installer.getInstalled(SKILL_ID)?.manifest.version).toBe('1.0.0');
  });

  it('注入适配器后 uninstall() 会注销工具、清理权限并写入 skill_uninstall 审计日志', async () => {
    const installer = await installerWithDemoSkill();
    const deregister = vi.fn<(skillId: string) => void>();
    const register = vi.fn<(skillId: string, manifest: SkillManifest) => void>();
    const clearPermissions = vi.fn<(skillId: string) => Promise<void>>();
    clearPermissions.mockResolvedValue(undefined);
    const log = vi.fn<(event: AuditEvent) => void>();

    const toolRegistry: ToolRegistryAdapter = { deregister, register };
    const secureStore: SecureStoreAdapter = { clearPermissions };
    const auditLog: AuditLogAdapter = { log };

    const lifecycle = new SkillLifecycle({
      installer,
      toolRegistry,
      secureStore,
      auditLog,
      now: () => 123,
    });

    await lifecycle.uninstall(SKILL_ID);

    expect(installer.getInstalled(SKILL_ID)).toBeUndefined();
    expect(deregister).toHaveBeenCalledWith(SKILL_ID);
    expect(clearPermissions).toHaveBeenCalledWith(SKILL_ID);
    expect(log).toHaveBeenCalledWith({
      type: 'skill_uninstall',
      skillId: SKILL_ID,
      version: '1.0.0',
      sourceId: 'official',
      timestamp: 123,
    });
  });

  it('仅注入 client 时 checkUpdates() 仍可正常工作', async () => {
    const installer = await installerWithDemoSkill();
    const lifecycle = new SkillLifecycle({
      installer,
      client: new StubRegistryClient('2.0.0'),
    });

    await expect(lifecycle.checkUpdates()).resolves.toEqual([
      {
        skillId: SKILL_ID,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        sourceId: 'official',
      },
    ]);
  });
});
