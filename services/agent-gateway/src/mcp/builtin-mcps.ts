/**
 * Built-in MCP servers — 系统级硬编码可用的 remote MCP servers，
 * 不依赖用户在 settings 里手动配置即可被 LLM 通过 `mcp_call` /
 * `mcp_list_tools` 使用。
 *
 * 设计要点：
 * - 远程 MCP 直接声明为 SSE；codegraph / git_bash / lsp / omo 声明为
 *   OpenAWork 内置虚拟 stdio MCP，由 runtime 直接桥接到本地能力，
 *   不实际启动占位 command。
 * - 用户可以在 user_settings 里用同 id 管理内置 server。system builtin
 *   可被完整覆盖；virtual / adapter builtin 只接受 enabled 与 disabledTools
 *   等管理字段，endpoint 始终由 runtime 内置桥接提供。
 * - 环境变量（如 `EXA_API_KEY`）若可用，会被自动注入为请求 header；
 *   不可用则透明回退到匿名访问（Exa 的 web_search_exa 有免费额度）。
 *
 * 灵感来自 oh-my-opencode 的 `src/mcp/index.ts`：它给 opencode 注入
 * websearch / context7 / grep_app 三个内置 remote MCP。OpenAWork 仅
 * 收口 websearch（Exa）+ grep_app 两个高频且无 OAuth 依赖的 MCP——
 * context7 在 OpenAWork 当前没有真实使用场景，先不引入。
 */

import type { ConfiguredMCPServer } from './mcp-runtime.js';

/**
 * Stable id 用作合并键。用户在 user_settings.mcp_servers 里写同 id 配置
 * 会管理同名内置 server；protected virtual / adapter 不接受 endpoint 覆盖。
 */
export const BUILTIN_MCP_IDS = [
  'websearch',
  'grep_app',
  'codegraph',
  'git_bash',
  'lsp',
  'omo',
] as const;
export type BuiltinMcpId = (typeof BUILTIN_MCP_IDS)[number];
export type BuiltinMcpKind = 'system' | 'virtual' | 'adapter';

export function getBuiltinMcpKind(id: string): BuiltinMcpKind | undefined {
  switch (id) {
    case 'websearch':
    case 'grep_app':
      return 'system';
    case 'codegraph':
    case 'git_bash':
    case 'lsp':
      return 'virtual';
    case 'omo':
      return 'adapter';
    default:
      return undefined;
  }
}

export function isProtectedBuiltinMcpId(id: string): boolean {
  const kind = getBuiltinMcpKind(id);
  return kind === 'virtual' || kind === 'adapter';
}

interface BuildBuiltinMcpServersOptions {
  /** 注入的环境变量（默认走 process.env，测试可以传干净的值进来）。 */
  env?: NodeJS.ProcessEnv;
}

/**
 * 构建当前进程视角下的内置 MCP server 列表。在合并到用户配置之前，
 * 这一层不做"启用 / 禁用"判断 —— `enabled=true` 让默认体验是开箱
 * 即用，禁用是用户的覆盖配置职责。
 */
export function buildBuiltinMcpServers(
  options: BuildBuiltinMcpServersOptions = {},
): ConfiguredMCPServer[] {
  const env = options.env ?? globalThis.process?.env ?? {};

  // 1) Exa Web Search MCP — `websearch` 工具集仅暴露 `web_search_exa`，
  //    避免把 Exa 仪表板的其他实验性 tool 也牵进来。
  const exaApiKey = readEnvString(env, 'EXA_API_KEY');
  const websearch: ConfiguredMCPServer = {
    id: 'websearch',
    name: 'websearch',
    transport: 'sse',
    url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
    enabled: true,
    builtin: true,
    builtinKind: 'system',
    source: 'system',
    ...(exaApiKey ? { headers: { 'x-api-key': exaApiKey } } : {}),
  };

  // 2) grep.app MCP — 在公开 GitHub 仓库里做正则代码检索；无鉴权。
  const grepApp: ConfiguredMCPServer = {
    id: 'grep_app',
    name: 'grep_app',
    transport: 'sse',
    url: 'https://mcp.grep.app',
    enabled: true,
    builtin: true,
    builtinKind: 'system',
    source: 'system',
  };

  const codegraph: ConfiguredMCPServer = {
    id: 'codegraph',
    name: 'codegraph',
    transport: 'stdio',
    command: 'openawork-virtual-codegraph',
    enabled: true,
    required: false,
    builtin: true,
    builtinKind: 'virtual',
    source: 'system',
  };

  const gitBash: ConfiguredMCPServer = {
    id: 'git_bash',
    name: 'git_bash',
    transport: 'stdio',
    command: 'openawork-virtual-git-bash',
    enabled: process.platform === 'win32',
    required: false,
    builtin: true,
    builtinKind: 'virtual',
    source: 'system',
  };

  const lsp: ConfiguredMCPServer = {
    id: 'lsp',
    name: 'lsp',
    transport: 'stdio',
    command: 'openawork-virtual-lsp',
    enabled: true,
    required: false,
    builtin: true,
    builtinKind: 'virtual',
    source: 'system',
  };

  const omo: ConfiguredMCPServer = {
    id: 'omo',
    name: 'omo',
    transport: 'stdio',
    command: 'openawork-virtual-omo',
    enabled: true,
    required: false,
    builtin: true,
    builtinKind: 'adapter',
    source: 'system',
  };

  return [websearch, grepApp, codegraph, gitBash, lsp, omo];
}

function readEnvString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 把内置 MCP 与用户配置合并。同 id 用户配置会覆盖 system builtin；
 * 对 protected virtual / adapter builtin，只保留启用态、禁用工具和来源信任边界。
 * 顺序是「内置在前、用户在后」+ 同 id 去重，保证：
 *   - 用户没有自定义时，内置 server 出现在结果中
 *   - 用户写了同 id 配置，结果里只保留一份规范化后的配置（含 enabled=false 的禁用）
 *
 * 该函数纯粹做合并，不读 SQLite，便于单元测试。
 */
export function mergeBuiltinAndConfiguredMcps(
  configured: ConfiguredMCPServer[],
  builtin: ConfiguredMCPServer[] = buildBuiltinMcpServers(),
): ConfiguredMCPServer[] {
  const builtinById = new Map(builtin.map((server) => [server.id, server]));
  const normalizedConfigured = configured.map((server) => {
    const builtinServer = builtinById.get(server.id);
    if (!builtinServer) {
      if (server.source === 'system') {
        return {
          ...server,
          source: 'user' as const,
        };
      }
      return server;
    }
    if (server.source !== 'system' && !isProtectedBuiltinMcpId(server.id)) {
      return server;
    }
    if (isProtectedBuiltinMcpId(server.id)) {
      const protectedSource: ConfiguredMCPServer['source'] = server.source ?? 'system';
      return {
        id: builtinServer.id,
        name: builtinServer.name,
        transport: builtinServer.transport,
        enabled: server.enabled,
        required: builtinServer.required,
        builtin: true,
        builtinKind: getBuiltinMcpKind(builtinServer.id),
        source: protectedSource,
        ...(server.disabledTools ? { disabledTools: server.disabledTools } : {}),
      };
    }
    return {
      ...builtinServer,
      enabled: server.enabled,
      ...(server.disabledTools ? { disabledTools: server.disabledTools } : {}),
    };
  });
  const userIds = new Set(normalizedConfigured.map((server) => server.id));
  const survivingBuiltins = builtin.filter((server) => !userIds.has(server.id));
  return [...survivingBuiltins, ...normalizedConfigured];
}
