/**
 * 会话 MCP 的**真实探活**（261101）。
 *
 * 为什么单独成模块：探活此前只是 `SessionExtensionApplyPorts` 上的一个可选注入点，
 * 由路由层负责传。漏传的后果不是「少验一次」，而是把 `probe_not_configured`
 * 当成终态结算，对外呈现成「配置已保存但不可用」——**一个假的失败原因**，会把
 * 排查方向整个带偏（实测在真实模型端到端里就踩到了）。
 *
 * 现在它是服务层的**默认实现**，注入只为测试；调用方不再需要记得接线。
 *
 * 探活语义：先作废旧连接（保证验的是刚写入的配置，而不是池里那份旧连接），
 * 再走与真实调用完全相同的目录构建路径取工具列表。因此「探活通过」与
 * 「下一轮真的能用」是同一口径。
 */

/**
 * 探活结果。
 *
 * `ok: false` 只表示「这一次没连上」，不代表配置非法——配置早已落库，调用方
 * 应按 `configured_unavailable` 结算（保存了但不可用），绝不谎报成功。
 */
export interface SessionMcpProbeResult {
  ok: boolean;
  toolCount?: number;
  error?: string;
}

export interface SessionMcpProbeInput {
  sessionId: string;
  /** 会话内唯一的条目 id（`session_mcp_servers.display_id`）。 */
  displayId: string;
  /** 会话所有者：连接池按会话隔离，回收时必须带对人。 */
  ownerUserId: string;
}

export async function probeSessionExtensionMcpServer(
  input: SessionMcpProbeInput,
): Promise<SessionMcpProbeResult> {
  // 动态 import：`mcp-runtime` 在模块加载期会注册目录池监听，静态引入会把这份
  // 副作用挂到会话扩展的加载链上（与 route-support 原先的做法一致）。
  const {
    getConfiguredMcpServerForSession,
    invalidateMcpServerConnectionForUser,
    listMcpToolsForSession,
  } = await import('../mcp/mcp-runtime.js');

  const server = getConfiguredMcpServerForSession(input.sessionId, input.displayId);
  await invalidateMcpServerConnectionForUser(input.ownerUserId, server);

  const [catalog] = await listMcpToolsForSession(input.sessionId, { serverId: input.displayId });
  if (catalog?.status === 'connected') {
    return { ok: true, toolCount: catalog.tools.length };
  }

  return {
    ok: false,
    error: catalog?.error ?? `MCP 连接探测未通过（状态：${catalog?.status ?? 'missing'}）。`,
  };
}
