/**
 * 虚拟 LSP MCP 的识别与载荷提取（纯函数）。
 *
 * 网关把同一批 LSP 能力通过两种通道暴露给模型：
 *
 * 1. 内置工具 `lsp_*`（`services/agent-gateway/src/tools/lsp-tools.ts`）；
 * 2. 虚拟 MCP server `lsp`（`services/agent-gateway/src/mcp/virtual-lsp-mcp.ts`），
 *    扁平工具名形如 `mcp__lsp__find_references`；legacy 模式则是
 *    `mcp_call` + 参数 `{ serverId: 'lsp', toolName: 'find_references' }`。
 *
 * 两条通道的输出内容一致，只是 MCP 通道被包装成 `{ content: [{ type: 'text' }] }`。
 * 这里把「MCP 包装」剥掉，让两类调用复用同一套 LSP 专用视图（位置 / 诊断 / 符号）。
 */

import { extractMcpResult } from '../previews/mcp-result-preview.js';

/** 虚拟 LSP server 的 id（与 `virtual-mcp-provider-registry.ts` 一致）。 */
const LSP_MCP_SERVER_ID = 'lsp';
const LSP_MCP_FLAT_PREFIX = `mcp__${LSP_MCP_SERVER_ID}__`;

/**
 * 把工具调用解析成「MCP LSP 的内层工具名」；不是 LSP MCP 调用时返回 null。
 *
 * - 扁平模式：`mcp__lsp__find_references` → `find_references`
 * - legacy 模式：`mcp_call` + `{ serverId: 'lsp', toolName: 'find_references' }`
 */
export function resolveLspMcpToolName(
  toolName: string,
  input?: Record<string, unknown>,
): string | null {
  const normalized = toolName.trim().toLowerCase();
  if (normalized.startsWith(LSP_MCP_FLAT_PREFIX)) {
    const inner = normalized.slice(LSP_MCP_FLAT_PREFIX.length).trim();
    return inner.length > 0 ? inner : null;
  }

  if (normalized === 'mcp_call') {
    const serverId = typeof input?.['serverId'] === 'string' ? input['serverId'].trim() : '';
    const inner = typeof input?.['toolName'] === 'string' ? input['toolName'].trim() : '';
    if (serverId.toLowerCase() === LSP_MCP_SERVER_ID && inner.length > 0) {
      return inner.toLowerCase();
    }
  }

  return null;
}

/**
 * 从 MCP 结果里取出内层载荷。
 *
 * 优先 `structuredContent`（网关若升级为结构化返回可直接受益）；否则取第一个
 * text 块。`diagnostics` 走 MCP 时是把对象 JSON.stringify 成 text，所以调用方
 * 需要再尝试解析 JSON。
 */
export function resolveMcpLspPayload(output: unknown): unknown {
  const result = extractMcpResult(output);
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  return result.text.length > 0 ? result.text : null;
}

/** 把「可能是 JSON 文本」的载荷还原成对象；非 JSON 原样返回。 */
export function parseMaybeJsonPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return payload;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // 截断 / 非法 JSON：保持原文，让下游按文本回退。
    return payload;
  }
}
