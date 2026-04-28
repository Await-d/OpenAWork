/**
 * Tool Output Truncator
 *
 * Ported from oh-my-opencode's tool-output-truncator hook.
 * Truncates excessively long tool outputs to prevent context window overflow.
 *
 * In oh-my-opencode this was a tool.execute.after hook using a dynamic truncator.
 * In OpenAWork it's a simpler character-based truncation applied in executeToolCalls.
 */

/** Default max output length in characters (~50k tokens ≈ ~200k chars) */
const DEFAULT_MAX_CHARS = 200_000;

/** Web fetch tools get more aggressive truncation (~10k tokens ≈ ~40k chars) */
const WEBFETCH_MAX_CHARS = 40_000;

/** MCP tool calls return arbitrary payloads (incl. blobs); cap them tighter than default. */
const MCP_CALL_MAX_CHARS = 80_000;

/** Git diff payloads can grow with binary or refactor noise; cap below the universal limit. */
const WORKSPACE_REVIEW_DIFF_MAX_CHARS = 60_000;

/**
 * Universal fallback max chars applied to ALL tool outputs regardless of name.
 * This is a safety net to prevent any single tool output from overflowing the
 * context window. Set to ~50k tokens ≈ ~200k chars.
 */
const UNIVERSAL_MAX_CHARS = 200_000;

const TRUNCATABLE_TOOLS = new Set([
  'bash',
  'agent',
  'grep',
  'safe_grep',
  'glob',
  'safe_glob',
  'lsp_diagnostics',
  'ast_grep_search',
  'interactive_bash',
  'skill_mcp',
  'webfetch',
  'web_fetch',
  'task',
  'delegate_task',
  'mcp_call',
  'workspace_review_diff',
]);

const TOOL_SPECIFIC_MAX_CHARS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_CHARS,
  web_fetch: WEBFETCH_MAX_CHARS,
  mcp_call: MCP_CALL_MAX_CHARS,
  workspace_review_diff: WORKSPACE_REVIEW_DIFF_MAX_CHARS,
};

const TRUNCATION_NOTICE = `

[输出已截断 — 原始输出超过最大长度。使用更精确的搜索模式或路径范围来获取完整结果。]`;

function getToolMaxChars(toolName: string): number {
  const normalized = toolName.toLowerCase();
  return TRUNCATABLE_TOOLS.has(normalized)
    ? (TOOL_SPECIFIC_MAX_CHARS[normalized] ?? DEFAULT_MAX_CHARS)
    : UNIVERSAL_MAX_CHARS;
}

function safeSerializeOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(output, (_key: string, value: unknown) => {
      if (typeof value === 'bigint') return value.toString();
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
    return serialized ?? String(output);
  } catch {
    return String(output);
  }
}

/**
 * Truncate tool output if it exceeds the maximum allowed length.
 * Returns the (possibly truncated) output string.
 */
export function truncateToolOutput(toolName: string, output: string): string {
  const maxChars = getToolMaxChars(toolName);

  if (output.length <= maxChars) return output;

  return output.slice(0, maxChars) + TRUNCATION_NOTICE;
}

/**
 * Truncate tool output for both string and object types.
 * Object outputs are serialized to JSON for size checking; if oversized, the
 * serialized form is truncated and returned as a string.
 * This is the primary entry point for tool output truncation in executeToolCalls.
 */
export function truncateToolOutputUniversal(
  toolName: string,
  output: unknown,
): unknown {
  if (typeof output === 'string') {
    return truncateToolOutput(toolName, output);
  }

  if (output === null || output === undefined) {
    return output;
  }

  // Object/array output — serialize and check size
  const serialized = safeSerializeOutput(output);
  const maxChars = getToolMaxChars(toolName);

  if (serialized.length <= maxChars) {
    return output;
  }

  // Truncate the serialized form
  return serialized.slice(0, maxChars) + TRUNCATION_NOTICE;
}
