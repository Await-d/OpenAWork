import type {
  SkillManifest,
  SkillPermission,
  SkillExecutor,
  ToolResult,
} from '@openAwork/skill-types';
import { MCPClientAdapterImpl, ToolRegistryImpl } from '@openAwork/mcp-client';

export interface InstalledSkill {
  manifest: SkillManifest;
  executor?: SkillExecutor;
  grantedPermissions: SkillPermission[];
  installedAt: number;
  enabled: boolean;
}

export interface SkillInstallResult {
  success: boolean;
  skillId: string;
  error?: string;
  requiredPermissions?: SkillPermission[];
}

export interface PermissionGrantResult {
  granted: SkillPermission[];
  denied: SkillPermission[];
}

export type PermissionGrantHandler = (
  skillId: string,
  permissions: SkillPermission[],
) => Promise<PermissionGrantResult>;

export class SkillRegistry {
  private skills = new Map<string, InstalledSkill>();
  private mcpClient = new MCPClientAdapterImpl();
  private toolRegistry = new ToolRegistryImpl();
  private permissionHandler: PermissionGrantHandler;

  constructor(permissionHandler?: PermissionGrantHandler) {
    this.permissionHandler = permissionHandler ?? this.defaultPermissionHandler.bind(this);
    this.toolRegistry.setMCPExecutor(async (serverId, toolName, args) => {
      const result = await this.mcpClient.callTool(serverId, toolName, args);
      return {
        content: result.content,
        isError: result.isError,
      } as ToolResult;
    });
  }

  private async defaultPermissionHandler(
    _skillId: string,
    permissions: SkillPermission[],
  ): Promise<PermissionGrantResult> {
    const required = permissions.filter((p) => p.required);
    const optional = permissions.filter((p) => !p.required);
    return { granted: [...required, ...optional], denied: [] };
  }

  async install(manifest: SkillManifest, executor?: SkillExecutor): Promise<SkillInstallResult> {
    if (!this.validateManifest(manifest)) {
      return { success: false, skillId: manifest.id, error: 'Invalid manifest schema' };
    }

    if (manifest.permissions.length > 0) {
      const result = await this.permissionHandler(manifest.id, manifest.permissions);
      const deniedRequired = manifest.permissions
        .filter((p) => p.required)
        .filter((p) => result.denied.some((d) => d.scope === p.scope && d.type === p.type));

      if (deniedRequired.length > 0) {
        return {
          success: false,
          skillId: manifest.id,
          error: 'Required permissions denied',
          requiredPermissions: deniedRequired,
        };
      }

      const installed: InstalledSkill = {
        manifest,
        executor,
        grantedPermissions: result.granted,
        installedAt: Date.now(),
        enabled: true,
      };
      this.skills.set(manifest.id, installed);

      if (manifest.mcp) {
        await this.mcpClient.connect(manifest.mcp);
        const tools = await this.mcpClient.listTools(manifest.mcp.id);
        this.toolRegistry.registerMCPServer(manifest.mcp.id, tools);
      } else if (executor) {
        this.toolRegistry.registerSkill(manifest, executor);
      }

      return { success: true, skillId: manifest.id };
    }

    const installed: InstalledSkill = {
      manifest,
      executor,
      grantedPermissions: [],
      installedAt: Date.now(),
      enabled: true,
    };
    this.skills.set(manifest.id, installed);

    if (executor) {
      this.toolRegistry.registerSkill(manifest, executor);
    }

    return { success: true, skillId: manifest.id };
  }

  async uninstall(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    if (skill.manifest.mcp) {
      await this.mcpClient.disconnect(skill.manifest.mcp.id).catch(() => undefined);
    }

    this.toolRegistry.unregister(skillId);
    this.skills.delete(skillId);
  }

  enable(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) skill.enabled = true;
  }

  disable(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) skill.enabled = false;
  }

  list(): InstalledSkill[] {
    return [...this.skills.values()];
  }

  get(skillId: string): InstalledSkill | undefined {
    return this.skills.get(skillId);
  }

  getToolRegistry(): ToolRegistryImpl {
    return this.toolRegistry;
  }

  private validateManifest(manifest: SkillManifest): boolean {
    return (
      manifest.apiVersion === 'agent-skill/v1' &&
      typeof manifest.id === 'string' &&
      manifest.id.length > 0 &&
      typeof manifest.name === 'string' &&
      typeof manifest.version === 'string' &&
      Array.isArray(manifest.permissions) &&
      Array.isArray(manifest.capabilities)
    );
  }
}
