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

const TRUNCATABLE_TOOLS = new Set([
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
]);

const TOOL_SPECIFIC_MAX_CHARS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_CHARS,
  web_fetch: WEBFETCH_MAX_CHARS,
  WebFetch: WEBFETCH_MAX_CHARS,
};

const TRUNCATION_NOTICE = `

[输出已截断 — 原始输出超过最大长度。使用更精确的搜索模式或路径范围来获取完整结果。]`;

/**
 * Truncate tool output if it exceeds the maximum allowed length.
 * Returns the (possibly truncated) output string.
 */
export function truncateToolOutput(toolName: string, output: string): string {
  if (!TRUNCATABLE_TOOLS.has(toolName.toLowerCase())) return output;

  const maxChars = TOOL_SPECIFIC_MAX_CHARS[toolName] ?? DEFAULT_MAX_CHARS;

  if (output.length <= maxChars) return output;

  return output.slice(0, maxChars) + TRUNCATION_NOTICE;
}
