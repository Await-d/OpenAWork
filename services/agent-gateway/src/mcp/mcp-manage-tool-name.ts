/**
 * `mcp_manage_servers` 工具名常量。
 *
 * 独立成零依赖模块：权限派生器与会话可见性策略都需要引用它，而
 * `mcp-admin-tools.ts` 会拉起 DB / 连接池 / zod 等重依赖，不适合被
 * 纯策略模块（`session-tool-visibility.ts`）导入。
 */
export const MCP_MANAGE_SERVERS_TOOL_NAME = 'mcp_manage_servers';
