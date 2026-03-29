import type {
  ToolRegistry,
  ToolDefinition,
  ToolResult,
  BuiltinTool,
  SkillManifest,
  SkillExecutor,
  MCPToolDef,
  JSONSchema,
} from '@openAwork/skill-types';

export class ToolRegistryImpl implements ToolRegistry {
  private builtins = new Map<string, BuiltinTool>();
  private skills = new Map<string, { manifest: SkillManifest; executor: SkillExecutor }>();
  private mcpTools = new Map<string, { serverId: string; def: MCPToolDef }>();
  private mcpExecutor:
    | ((serverId: string, toolName: string, args: unknown) => Promise<ToolResult>)
    | null = null;
  private disabledToolNames = new Set<string>();

  setMCPExecutor(
    executor: (serverId: string, toolName: string, args: unknown) => Promise<ToolResult>,
  ): void {
    this.mcpExecutor = executor;
  }

  registerBuiltin(tool: BuiltinTool): void {
    this.builtins.set(tool.id, tool);
  }

  registerSkill(skill: SkillManifest, executor: SkillExecutor): void {
    this.skills.set(skill.id, { manifest: skill, executor });
  }

  registerMCPServer(serverId: string, tools: MCPToolDef[]): void {
    for (const tool of tools) {
      const id = `mcp:${serverId}:${tool.name}`;
      this.mcpTools.set(id, { serverId, def: tool });
    }
  }

  disableTool(toolName: string): void {
    this.disabledToolNames.add(toolName);
  }

  enableTool(toolName: string): void {
    this.disabledToolNames.delete(toolName);
  }

  isToolDisabled(toolName: string): boolean {
    return this.disabledToolNames.has(toolName);
  }

  listAvailable(): ToolDefinition[] {
    const result: ToolDefinition[] = [];

    for (const tool of this.builtins.values()) {
      if (this.disabledToolNames.has(tool.name)) continue;
      result.push({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        source: 'builtin',
        sourceId: tool.id,
      });
    }

    for (const { manifest } of this.skills.values()) {
      if (this.disabledToolNames.has(manifest.name)) continue;
      result.push({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        inputSchema: {} as JSONSchema,
        source: 'skill',
        sourceId: manifest.id,
      });
    }

    for (const [id, { def }] of this.mcpTools) {
      if (this.disabledToolNames.has(def.name)) continue;
      result.push({
        id,
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        source: 'mcp',
        sourceId: id,
      });
    }

    return result;
  }

  async execute(toolName: string, args: unknown): Promise<ToolResult> {
    const builtin = [...this.builtins.values()].find((t) => t.name === toolName);
    if (builtin) return builtin.execute(args);

    const skill = [...this.skills.values()].find((s) => s.manifest.name === toolName);
    if (skill) return skill.executor(args);

    const mcpEntry = [...this.mcpTools.entries()].find(([, { def }]) => def.name === toolName);
    if (mcpEntry) {
      const [, { serverId }] = mcpEntry;
      if (!this.mcpExecutor) throw new Error('MCP executor not configured');
      return this.mcpExecutor(serverId, toolName, args);
    }

    throw new Error(`Tool not found: ${toolName}`);
  }

  unregister(toolId: string): void {
    this.builtins.delete(toolId);
    this.skills.delete(toolId);
    this.mcpTools.delete(toolId);
  }
}
