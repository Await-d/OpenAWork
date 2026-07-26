/**
 * Tool Output Truncator
 *
 * Ported from oh-my-opencode's tool-output-truncator hook.
 * Truncates excessively long tool outputs to prevent context window overflow.
 *
 * In oh-my-opencode this was a tool.execute.after hook using a dynamic truncator.
 * In OpenAWork it's a simpler character-based truncation applied in executeToolCalls.
 *
 * Enhanced with dynamic truncation support: when the effective context window
 * is known to be smaller than the preset (e.g. relay supports 200K but preset
 * says 1M), tool output limits are scaled down proportionally.
 */

import {
  resolveEffectiveContextWindow,
  hasDiscoveredLowerContextWindow,
} from '../compaction/context-window-resolver.js';

/** Default max output length in characters (~50k tokens ≈ ~200k chars) */
const DEFAULT_MAX_CHARS = 200_000;

/** Web fetch tools get more aggressive truncation (~10k tokens ≈ ~40k chars) */
const WEBFETCH_MAX_CHARS = 40_000;

/** MCP tool calls return arbitrary payloads (incl. blobs); cap them tighter than default. */
const MCP_CALL_MAX_CHARS = 80_000;

/** Git diff payloads can grow with binary or refactor noise; cap below the universal limit. */
const WORKSPACE_REVIEW_DIFF_MAX_CHARS = 60_000;
const DESKTOP_AUTOMATION_MAX_CHARS = 24_000;
const DESKTOP_CONTROL_MAX_CHARS = 8_000;

/**
 * Universal fallback max chars applied to ALL tool outputs regardless of name.
 * This is a safety net to prevent any single tool output from overflowing the
 * context window. Set to ~50k tokens ≈ ~200k chars.
 */
const UNIVERSAL_MAX_CHARS = 200_000;

/** Reference context window for the default limits above (1M tokens). */
const REFERENCE_CONTEXT_WINDOW = 1_000_000;

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
  'desktop_automation',
  'desktop_control',
]);

const TOOL_SPECIFIC_MAX_CHARS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_CHARS,
  web_fetch: WEBFETCH_MAX_CHARS,
  mcp_call: MCP_CALL_MAX_CHARS,
  workspace_review_diff: WORKSPACE_REVIEW_DIFF_MAX_CHARS,
  desktop_automation: DESKTOP_AUTOMATION_MAX_CHARS,
  desktop_control: DESKTOP_CONTROL_MAX_CHARS,
};

const TRUNCATION_NOTICE = `

[输出已截断 — 原始输出超过最大长度。使用更精确的搜索模式或路径范围来获取完整结果。]`;

function getToolMaxChars(toolName: string): number {
  const normalized = toolName.toLowerCase();
  return TRUNCATABLE_TOOLS.has(normalized)
    ? (TOOL_SPECIFIC_MAX_CHARS[normalized] ?? DEFAULT_MAX_CHARS)
    : UNIVERSAL_MAX_CHARS;
}

/**
 * Get the dynamic max chars for a tool, scaled by the effective context window.
 *
 * When the effective context window is smaller than the reference (1M), all
 * limits are scaled down proportionally. For example:
 * - 1M context → 200K max chars (default)
 * - 200K context → 40K max chars (scaled to 20%)
 * - 400K context → 80K max chars (scaled to 40%)
 *
 * This prevents a single tool output from consuming too large a fraction of
 * the available context when the actual limit is lower than expected.
 */
function getToolMaxCharsDynamic(
  toolName: string,
  userId?: string,
  modelId?: string,
  presetContextWindow?: number,
): number {
  const baseMax = getToolMaxChars(toolName);

  // If we don't have enough info for dynamic scaling, use the static limit
  if (!userId || !modelId) return baseMax;

  // Check if we have a discovered lower context window
  if (!hasDiscoveredLowerContextWindow(userId, modelId, presetContextWindow)) return baseMax;

  const effectiveWindow = resolveEffectiveContextWindow(userId, modelId, presetContextWindow);
  const scaleFactor = effectiveWindow / REFERENCE_CONTEXT_WINDOW;

  // Don't scale below 10% of the original limit to keep outputs useful
  const minScale = 0.1;
  const clampedScale = Math.max(minScale, Math.min(1, scaleFactor));

  return Math.floor(baseMax * clampedScale);
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
export function truncateToolOutputUniversal(toolName: string, output: unknown): unknown {
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

/**
 * Dynamic truncation entry point that adjusts limits based on the effective
 * context window for the current user+model. Use this when the session context
 * is available (i.e. during tool execution within a stream round).
 *
 * When the effective context window is lower than the preset (e.g. relay only
 * supports 200K), tool output limits are scaled down proportionally to prevent
 * a single output from consuming too much of the available context.
 *
 * Mirrors oh-my-opencode's `dynamicTruncate` pattern.
 */
export function truncateToolOutputDynamic(
  toolName: string,
  output: string,
  context: { userId: string; modelId: string; presetContextWindow?: number },
): string {
  const maxChars = getToolMaxCharsDynamic(
    toolName,
    context.userId,
    context.modelId,
    context.presetContextWindow,
  );

  if (output.length <= maxChars) return output;

  return output.slice(0, maxChars) + TRUNCATION_NOTICE;
}

/**
 * Dynamic truncation for both string and object types.
 * Combines `truncateToolOutputUniversal` with dynamic context-aware scaling.
 */
export function truncateToolOutputDynamicUniversal(
  toolName: string,
  output: unknown,
  context: { userId: string; modelId: string; presetContextWindow?: number },
): unknown {
  if (typeof output === 'string') {
    return truncateToolOutputDynamic(toolName, output, context);
  }

  if (output === null || output === undefined) {
    return output;
  }

  const serialized = safeSerializeOutput(output);
  const maxChars = getToolMaxCharsDynamic(
    toolName,
    context.userId,
    context.modelId,
    context.presetContextWindow,
  );

  if (serialized.length <= maxChars) {
    return output;
  }

  return serialized.slice(0, maxChars) + TRUNCATION_NOTICE;
}
