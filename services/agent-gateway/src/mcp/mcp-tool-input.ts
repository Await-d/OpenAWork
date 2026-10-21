/**
 * Shared input parsers for the MCP wrapper tools (mcp_list_tools / mcp_call).
 *
 * These wrapper tools are not registered as `ToolDefinition`s and therefore
 * cannot rely on a zod inputSchema for validation. Both the sandbox permission
 * builder and the executor must agree on how raw arguments are normalized
 * (whitespace trimming, accepting JSON-encoded `arguments` strings, etc.) so
 * the permission scope and the actual call use the same identifiers.
 *
 * Centralising the logic here keeps that contract honest and is straightforward
 * to unit-test.
 */

export interface McpListToolsParseResult {
  serverId?: string;
}

export interface McpCallParseSuccess {
  ok: true;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpCallParseFailure {
  ok: false;
  reason: string;
}

export type McpCallParseResult = McpCallParseSuccess | McpCallParseFailure;

export function parseMcpListToolsRawInput(
  rawInput: Record<string, unknown>,
): McpListToolsParseResult {
  const value = rawInput['serverId'];
  if (typeof value !== 'string') {
    return {};
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? { serverId: trimmed } : {};
}

/**
 * 还原上游流式中断留下的降级形态 `{ raw: "<JSON 文本>" }`。
 *
 * agent-core 的 `repairToolInput` 已对注册型工具做同样还原；mcp_call 是
 * 非注册包装工具（无 zod schema、不经 RepairPlugin），需要自行处理。
 * 触发条件全部满足才展开，避免误伤真实入参：
 *   1. 对象只有 `raw` 一个键；
 *   2. `raw` 是字符串且首字符为 `{`；
 *   3. 该字符串能解析为普通对象（mcp_call 的形）。
 */
function unwrapRawJsonObject(rawInput: Record<string, unknown>): Record<string, unknown> | null {
  const keys = Object.keys(rawInput);
  if (keys.length !== 1 || keys[0] !== 'raw') return null;
  const rawText = rawInput['raw'];
  if (typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 半截 JSON：保持原样，让下方校验产出明确的字段级错误。
  }
  return null;
}

function unwrapQuotedJson(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === '`' && last === '`')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function coerceArgumentsValue(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const cleaned = unwrapQuotedJson(value);
    if (cleaned.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(cleaned) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse raw `mcp_call` arguments. Whitespace is trimmed from `serverId` and
 * `toolName` so permission scopes and lookups never disagree. The `arguments`
 * field accepts either a JSON object or a JSON-encoded object string (matching
 * `skill_mcp`'s contract).
 */
export function parseMcpCallRawInput(rawInput: Record<string, unknown>): McpCallParseResult {
  // 上游错误写入习惯的还原：调用方可能把整个入参对象塞进 `raw` 字段。
  const effectiveInput = unwrapRawJsonObject(rawInput) ?? rawInput;

  const serverIdRaw = effectiveInput['serverId'];
  const serverId = typeof serverIdRaw === 'string' ? serverIdRaw.trim() : '';
  if (!serverId) {
    return { ok: false, reason: 'mcp_call requires a non-empty serverId' };
  }

  const toolNameRaw = effectiveInput['toolName'];
  const toolName = typeof toolNameRaw === 'string' ? toolNameRaw.trim() : '';
  if (!toolName) {
    return { ok: false, reason: 'mcp_call requires a non-empty toolName' };
  }

  const argumentsObject = coerceArgumentsValue(effectiveInput['arguments']);
  if (!argumentsObject) {
    return {
      ok: false,
      reason: 'mcp_call requires `arguments` to be a JSON object (or a JSON-encoded object string)',
    };
  }

  return {
    ok: true,
    serverId,
    toolName,
    arguments: argumentsObject,
  };
}
