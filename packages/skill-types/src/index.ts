export type JSONSchema = Record<string, unknown>;

export interface MCPServerRef {
  id: string;
  transport: 'sse' | 'websocket' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

export interface SkillPermission {
  type: 'network' | 'filesystem' | 'clipboard' | 'env' | 'notifications' | 'camera' | 'location';
  scope: string;
  required: boolean;
}

export interface SkillConstraints {
  maxConcurrentCalls?: number;
  rateLimitPerMinute?: number;
  timeout?: number;
}

export interface SkillLifecycle {
  activation: 'on-demand' | 'startup' | 'manual';
  warmup?: boolean;
}

export interface SkillReference {
  path: string;
  loadAt: 'activation' | 'never';
}

export interface SkillManifest {
  apiVersion: 'agent-skill/v1';
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  descriptionForModel?: string;
  author?: string;
  license?: string;
  platforms?: Array<'ios' | 'android' | 'macos' | 'windows'>;
  capabilities: string[];
  mcp?: MCPServerRef;
  permissions: SkillPermission[];
  constraints?: SkillConstraints;
  lifecycle?: SkillLifecycle;
  configSchema?: JSONSchema;
  references?: SkillReference[];
}

export interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface MCPCallOptions {
  timeout?: number;
  resetTimeoutOnProgress?: boolean;
  onprogress?: (p: { progress: number; total?: number }) => void;
}

export interface MCPToolResult {
  content: Array<{ type: 'text' | 'image' | 'resource'; text?: string; data?: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export type MCPConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface MCPClientAdapter {
  connect(server: MCPServerRef): Promise<void>;
  disconnect(serverId: string): Promise<void>;
  listTools(serverId: string): Promise<MCPToolDef[]>;
  callTool(
    serverId: string,
    toolName: string,
    args: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPToolResult>;
  getStatus(serverId: string): MCPConnectionStatus;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  source: 'builtin' | 'skill' | 'mcp';
  sourceId: string;
}

export interface ToolResult {
  content: unknown;
  isError?: boolean;
}

export type SkillExecutor = (args: unknown, config?: unknown) => Promise<ToolResult>;

export interface BuiltinTool {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (args: unknown) => Promise<ToolResult>;
  platforms?: Array<'ios' | 'android' | 'macos' | 'windows'>;
}

export interface ToolRegistry {
  registerBuiltin(tool: BuiltinTool): void;
  registerSkill(skill: SkillManifest, executor: SkillExecutor): void;
  registerMCPServer(serverId: string, tools: MCPToolDef[]): void;
  listAvailable(): ToolDefinition[];
  execute(toolName: string, args: unknown): Promise<ToolResult>;
  unregister(toolId: string): void;
}
