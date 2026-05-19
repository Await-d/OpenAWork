/**
 * Naming convention for **flattened** MCP tools — i.e. when each
 * `serverId × toolName` MCP tool is exposed to the LLM as its own
 * top-level tool (PR-C), instead of being routed through the
 * `mcp_list_tools` + `mcp_call` wrapper pair.
 *
 * Mirrors opencode's `mcp/index.ts:122-151` `convertMcpTool`:
 *
 *   key = `${sanitize(clientName)}_${sanitize(toolName)}`
 *
 * OpenAWork variant: we add a fixed `mcp__` prefix and use **double**
 * underscores as the segment delimiter so the inverse parse is
 * unambiguous even when the originating ids contain underscores. The
 * sanitiser collapses runs of underscores back to one, which
 * guarantees the flat name has exactly two `__` markers.
 *
 * Examples:
 *
 *   - serverId="github",       toolName="create_issue"
 *     → "mcp__github__create_issue"
 *
 *   - serverId="my-search",    toolName="web.search"     // dot → _
 *     → "mcp__my-search__web_search"
 *
 *   - serverId="long_name__a", toolName="x__y"           // __ → _
 *     → "mcp__long_name_a__x_y"
 *
 * Constraints (matching what OpenAI / Anthropic accept):
 *   - Tool names must match `^[a-zA-Z0-9_-]{1,64}$`. We sanitise to
 *     that charset and truncate the trailing segment with a stable
 *     hash if necessary.
 *   - The prefix `mcp__` is reserved — `parseFlatMcpToolName` returns
 *     null for any name that does NOT start with this prefix, so
 *     callers can safely interleave flat MCP tools with builtins.
 */

import { createHash } from 'node:crypto';

export const MCP_FLAT_TOOL_PREFIX = 'mcp__';
const SEGMENT_DELIMITER = '__';
const MAX_TOOL_NAME_LENGTH = 64;

/**
 * Sanitise an arbitrary identifier into a charset that's safe to
 * embed in a tool name:
 *   - Allowed chars: `[a-zA-Z0-9_-]`
 *   - Anything else → `_`
 *   - Runs of `_` are collapsed to a single `_` so the segment
 *     delimiter (`__`) stays unambiguous.
 *   - Trailing/leading underscores are trimmed to keep names tidy.
 */
function sanitiseSegment(value: string): string {
  const replaced = value.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return replaced.replace(/^_+|_+$/g, '');
}

/**
 * Build the flattened tool name for `(serverId, toolName)`. Truncates
 * the toolName segment with a 6-hex hash suffix if the assembled name
 * would exceed `MAX_TOOL_NAME_LENGTH` (64 chars).
 *
 * The hash is keyed on the **untruncated** server+tool pair so two
 * different overflowing tools from the same server stay distinguishable.
 */
export function flatMcpToolName(serverId: string, toolName: string): string {
  const safeServer = sanitiseSegment(serverId);
  const safeTool = sanitiseSegment(toolName);

  const candidate = `${MCP_FLAT_TOOL_PREFIX}${safeServer}${SEGMENT_DELIMITER}${safeTool}`;
  if (candidate.length <= MAX_TOOL_NAME_LENGTH) {
    return candidate;
  }

  // Reserve room for: prefix + server + delimiter + (truncated tool +
  // "_<6-hex-hash>"). Hash gives us collision-resistance after
  // truncation; we always keep the leading bytes of the tool name so
  // a human reader can still identify the call site.
  const HASH_SUFFIX_LEN = 7; // "_" + 6 hex chars
  const overhead =
    MCP_FLAT_TOOL_PREFIX.length + safeServer.length + SEGMENT_DELIMITER.length + HASH_SUFFIX_LEN;
  const allowedToolBudget = MAX_TOOL_NAME_LENGTH - overhead;

  if (allowedToolBudget < 1) {
    // Server name itself is too long — fall back to a fully-hashed
    // tail. This branch should be vanishingly rare in practice (most
    // serverIds are < 32 chars).
    const hash = createHash('sha256').update(`${serverId}::${toolName}`).digest('hex').slice(0, 12);
    const reservedServerLen =
      MAX_TOOL_NAME_LENGTH - MCP_FLAT_TOOL_PREFIX.length - SEGMENT_DELIMITER.length - hash.length;
    const truncatedServer = safeServer.slice(0, Math.max(reservedServerLen, 1));
    return `${MCP_FLAT_TOOL_PREFIX}${truncatedServer}${SEGMENT_DELIMITER}${hash}`;
  }

  const hash = createHash('sha256').update(`${serverId}::${toolName}`).digest('hex').slice(0, 6);
  const truncatedTool = safeTool.slice(0, allowedToolBudget);
  return `${MCP_FLAT_TOOL_PREFIX}${safeServer}${SEGMENT_DELIMITER}${truncatedTool}_${hash}`;
}

/**
 * Inverse of {@link flatMcpToolName}: parses a flattened tool name
 * back into its `(serverId, toolName)` pair. Returns `null` when the
 * input doesn't carry the `mcp__` prefix or the segment shape doesn't
 * match — callers should treat that as "not an MCP-flat tool, route
 * through the normal builtin path".
 *
 * NOTE: when the original `serverId` / `toolName` contained
 * non-`[a-zA-Z0-9_-]` characters or runs of `_`, the parsed values
 * are the **sanitised** form, not byte-equal to the originals.
 * Lookup callers in `tool-sandbox.ts` therefore match against the
 * post-sanitise serverId / toolName from the catalog snapshot, not
 * raw user-config values.
 */
export function parseFlatMcpToolName(name: string): { serverId: string; toolName: string } | null {
  if (!name.startsWith(MCP_FLAT_TOOL_PREFIX)) return null;
  const remainder = name.slice(MCP_FLAT_TOOL_PREFIX.length);
  const delimiterIndex = remainder.indexOf(SEGMENT_DELIMITER);
  if (delimiterIndex <= 0) return null;
  const serverId = remainder.slice(0, delimiterIndex);
  const toolName = remainder.slice(delimiterIndex + SEGMENT_DELIMITER.length);
  if (serverId.length === 0 || toolName.length === 0) return null;
  // Defence-in-depth: if the tail still contains `__` we have a
  // malformed name (sanitiser should have collapsed those). Treat as
  // not-an-MCP-tool rather than guessing the boundary.
  if (toolName.includes(SEGMENT_DELIMITER)) return null;
  return { serverId, toolName };
}

/**
 * Whether the operator has opted out of the flattened MCP tool surface.
 *
 * When `OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1`, callers should keep the
 * legacy `mcp_list_tools` + `mcp_call` wrapper tools as the only
 * LLM-visible MCP entry points (preserving pre-PR-C behaviour for
 * sites whose model fine-tuning depends on those exact names).
 */
export function isFlatMcpToolsDisabled(): boolean {
  return globalThis.process?.env?.['OPENAWORK_DISABLE_MCP_FLAT_TOOLS'] === '1';
}
