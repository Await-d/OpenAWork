/**
 * 会话级 MCP 层解析。
 *
 * 只读存储层，产出「本会话额外持有哪些 MCP 配置 + 继承模式」。真正的
 * `ConfiguredMCPServer` 映射、内置合并与连接池键在 `mcp/mcp-runtime.ts` 完成——
 * 那边已经是 MCP 领域的单一入口，把映射放在这里会与它形成循环依赖。
 *
 * 为什么必须区分 `inherit` / `explicit`：老会话没有设置行，语义是「继续用用户级
 * 配置」（`inherit`）；新开启本能力的渠道写入 `explicit`，语义是「只用会话自己的
 * 配置」——一个空集合就是「这个渠道会话不连任何用户 MCP」，而不是「沿用全部」。
 */

import {
  DEFAULT_SESSION_EXTENSION_INHERITANCE,
  type SessionExtensionInheritanceMode,
  type SessionMcpServerRecord,
} from './session-extension-contract.js';
import {
  listSessionMcpServers,
  resolveSessionExtensionInheritance,
} from './session-extension-store.js';

export interface SessionMcpLayer {
  readonly sessionId: string | null;
  readonly inheritance: SessionExtensionInheritanceMode;
  readonly servers: readonly SessionMcpServerRecord[];
}

export function resolveSessionMcpLayer(sessionId: string | null): SessionMcpLayer {
  if (!sessionId) {
    return {
      sessionId: null,
      inheritance: DEFAULT_SESSION_EXTENSION_INHERITANCE,
      servers: [],
    };
  }
  return {
    sessionId,
    inheritance: resolveSessionExtensionInheritance(sessionId),
    servers: listSessionMcpServers(sessionId),
  };
}

/**
 * 会话 MCP 尚未安装时是否允许直接暴露用户级 MCP。
 *
 * `explicit` 下永远不允许——包括「用户级有配置但会话没有任何条目」的情形，这正是
 * 渠道隔离的核心；`inherit` 下允许（老会话行为不变）。
 */
export function shouldInheritUserMcpServers(layer: SessionMcpLayer): boolean {
  return layer.inheritance !== 'explicit';
}
