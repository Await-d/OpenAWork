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
  const serverIdRaw = rawInput['serverId'];
  const serverId = typeof serverIdRaw === 'string' ? serverIdRaw.trim() : '';
  if (!serverId) {
    return { ok: false, reason: 'mcp_call requires a non-empty serverId' };
  }

  const toolNameRaw = rawInput['toolName'];
  const toolName = typeof toolNameRaw === 'string' ? toolNameRaw.trim() : '';
  if (!toolName) {
    return { ok: false, reason: 'mcp_call requires a non-empty toolName' };
  }

  const argumentsObject = coerceArgumentsValue(rawInput['arguments']);
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
