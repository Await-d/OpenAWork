/**
 * Tool Output Truncator
 *
 * Ported from oh-my-opencode's tool-output-truncator hook.
 * Truncates excessively long tool outputs to prevent context window overflow.
 *
 * Model-view caps are aligned with opencode v2.0.15 `tool-output.ts`
 * (`MAX_LINES = 2_000` / `MAX_BYTES = 50 KiB`, head-keep + truncation marker):
 * a single tool result must not dominate the context window. Outputs above the
 * cap are truncated in the model view only — the (larger, up to
 * `STORAGE_DEFAULT_MAX_CHARS`) result stays in session storage and can be
 * paged back with `read_tool_output`.
 *
 * Enhanced with dynamic truncation support: when the effective context window
 * is known to be smaller than the preset (e.g. relay supports 200K but preset
 * says 1M), tool output limits are scaled down proportionally.
 */

import {
  resolveEffectiveContextWindow,
  hasDiscoveredLowerContextWindow,
} from '../compaction/context-window-resolver.js';

/**
 * 模型视图：单个工具结果保留的最大行数（对齐参考库 `MAX_LINES`）。
 */
const MAX_LINES = 2_000;

/**
 * 模型视图：默认字节预算（对齐参考库 `MAX_BYTES = 50 KiB`）。
 *
 * 用字节而非字符是有意为之：参考库按 UTF-8 字节记账，中文内容下
 * 「50k 字符」会比参考库宽约 3 倍；按字节对齐后中英文的请求体上限一致。
 */
const DEFAULT_MAX_BYTES = 50 * 1024;

/** Web fetch tools get a more aggressive byte budget (~40 KiB). */
const WEBFETCH_MAX_BYTES = 40_000;

/** MCP tool calls return arbitrary payloads (incl. blobs); keep the default budget. */
const MCP_CALL_MAX_BYTES = 50 * 1024;

/** Git diff payloads can grow with binary or refactor noise; cap below the storage limit. */
const WORKSPACE_REVIEW_DIFF_MAX_BYTES = 60_000;
const DESKTOP_AUTOMATION_MAX_BYTES = 24_000;
const DESKTOP_CONTROL_MAX_BYTES = 8_000;

/** Universal model-view fallback byte budget applied to ALL tools. */
const UNIVERSAL_MAX_BYTES = 50 * 1024;

/**
 * Storage ceiling for the persisted tool result (pre-persist truncation).
 *
 * This is intentionally larger than the model-view ceiling: "超限落盘" means
 * the model sees a bounded preview plus a `read_tool_output` pointer, while
 * the complete（上限 200k 字符）result stays in the session so later rounds
 * can page it back without re-running the tool. Storage keeps the historical
 * **char** accounting (DB size semantics), not the model-view byte budget.
 */
const STORAGE_DEFAULT_MAX_CHARS = 200_000;

/** MCP payloads keep the legacy 80k storage ceiling (model view is 50 KiB). */
const MCP_CALL_STORAGE_MAX_CHARS = 80_000;

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

const TOOL_SPECIFIC_MAX_BYTES: Record<string, number> = {
  webfetch: WEBFETCH_MAX_BYTES,
  web_fetch: WEBFETCH_MAX_BYTES,
  mcp_call: MCP_CALL_MAX_BYTES,
  workspace_review_diff: WORKSPACE_REVIEW_DIFF_MAX_BYTES,
  desktop_automation: DESKTOP_AUTOMATION_MAX_BYTES,
  desktop_control: DESKTOP_CONTROL_MAX_BYTES,
};

/** Storage ceilings mirror the legacy per-tool caps（char 口径）；only the fallback is larger. */
const TOOL_SPECIFIC_STORAGE_MAX_CHARS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_BYTES,
  web_fetch: WEBFETCH_MAX_BYTES,
  mcp_call: MCP_CALL_STORAGE_MAX_CHARS,
  workspace_review_diff: WORKSPACE_REVIEW_DIFF_MAX_BYTES,
  desktop_automation: DESKTOP_AUTOMATION_MAX_BYTES,
  desktop_control: DESKTOP_CONTROL_MAX_BYTES,
};

const TRUNCATION_NOTICE = `

[输出已截断 — 原始输出超过最大长度。更长/完整的结果仍保存在本会话中：可用 read_tool_output 并传入该调用的 toolCallId 分页读取；也可以用更精确的搜索模式或路径范围缩小结果。]

[Output truncated — it exceeded the maximum length. The full (or longer) result is still stored in this session: page it back with read_tool_output using this tool call's toolCallId, or narrow the query with a more precise search pattern / path range.]`;

const STORAGE_TRUNCATION_NOTICE = `

[输出已截断 — 原始输出超过最大长度。使用更精确的搜索模式或路径范围来获取完整结果。]`;

function getToolMaxBytes(toolName: string): number {
  const normalized = toolName.toLowerCase();
  return TRUNCATABLE_TOOLS.has(normalized)
    ? (TOOL_SPECIFIC_MAX_BYTES[normalized] ?? DEFAULT_MAX_BYTES)
    : UNIVERSAL_MAX_BYTES;
}

function getToolStorageMaxChars(toolName: string): number {
  const normalized = toolName.toLowerCase();
  return TOOL_SPECIFIC_STORAGE_MAX_CHARS[normalized] ?? STORAGE_DEFAULT_MAX_CHARS;
}

/**
 * Get the dynamic max bytes for a tool, scaled by the effective context window.
 *
 * When the effective context window is smaller than the reference (1M), all
 * limits are scaled down proportionally. For example:
 * - 1M context → 50 KiB max bytes (default)
 * - 200K context → 10 KiB max bytes (scaled to 20%)
 * - 400K context → 20 KiB max bytes (scaled to 40%)
 *
 * This prevents a single tool output from consuming too large a fraction of
 * the available context when the actual limit is lower than expected.
 */
function getToolMaxBytesDynamic(
  toolName: string,
  userId?: string,
  modelId?: string,
  presetContextWindow?: number,
): number {
  const baseMax = getToolMaxBytes(toolName);

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
 * Take a UTF-8-safe head of `text` limited to `maxBytes` bytes.
 *
 * 与参考库的区别（有意为之）：参考库逐行累加、遇到首个超预算的行直接跳出，
 * 单行超长内容会整行丢失；这里退化为按字节安全截断该行，保留最有用的头部。
 */
function utf8SafeHead(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  // 回退到完整 UTF-8 边界，避免截出半个多字节字符。
  while (end > 0 && (buf[end]! & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return buf.subarray(0, end).toString('utf8');
}

/**
 * Head-keep by line count + byte budget（对齐参考库 2000 行 / 50 KiB 语义）。
 */
function truncateByLinesAndBytes(
  output: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const lines = output.split('\n');
  // 与参考库一致：尾随换行不计入行数。
  if (output.endsWith('\n')) lines.pop();
  const lineLimited = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES).join('\n') : output;
  const text = utf8SafeHead(lineLimited, maxBytes);
  return { text, truncated: text !== output };
}

/**
 * Truncate tool output if it exceeds the maximum allowed size.
 * Returns the (possibly truncated) output string.
 *
 * Model-view only: the truncated form is what the model reads from history.
 * Storage keeps the larger pre-persist form (see `truncateToolOutputUniversal`).
 */
export function truncateToolOutput(toolName: string, output: string): string {
  const maxBytes = getToolMaxBytes(toolName);
  const result = truncateByLinesAndBytes(output, maxBytes);
  return result.truncated ? result.text + TRUNCATION_NOTICE : output;
}

/**
 * Pre-persist (storage) truncation for both string and object types.
 *
 * Applied once in `executeToolCalls` before the tool result is written to the
 * session transcript. Uses the storage ceiling (200k chars by default), NOT
 * the model-view ceiling — the model-facing cap is enforced when the round
 * renders history via `truncateToolOutput`, which keeps the full result
 * retrievable through `read_tool_output`.
 */
export function truncateToolOutputUniversal(toolName: string, output: unknown): unknown {
  if (typeof output === 'string') {
    const maxChars = getToolStorageMaxChars(toolName);
    if (output.length <= maxChars) return output;
    return output.slice(0, maxChars) + STORAGE_TRUNCATION_NOTICE;
  }

  if (output === null || output === undefined) {
    return output;
  }

  // Object/array output — serialize and check size
  const serialized = safeSerializeOutput(output);
  const maxChars = getToolStorageMaxChars(toolName);

  if (serialized.length <= maxChars) {
    return output;
  }

  // Truncate the serialized form
  return serialized.slice(0, maxChars) + STORAGE_TRUNCATION_NOTICE;
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
  const maxBytes = getToolMaxBytesDynamic(
    toolName,
    context.userId,
    context.modelId,
    context.presetContextWindow,
  );
  const result = truncateByLinesAndBytes(output, maxBytes);
  return result.truncated ? result.text + TRUNCATION_NOTICE : output;
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
  const maxBytes = getToolMaxBytesDynamic(
    toolName,
    context.userId,
    context.modelId,
    context.presetContextWindow,
  );
  const result = truncateByLinesAndBytes(serialized, maxBytes);
  return result.truncated ? result.text + TRUNCATION_NOTICE : output;
}
