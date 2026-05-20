/**
 * Dynamic Context Window Resolver
 *
 * Ported from oh-my-opencode's context-window-monitor + anthropic-context-window-limit-recovery.
 *
 * The problem: model presets define a static `contextWindow` (e.g. 1M for Claude),
 * but many relay/proxy channels only support 200K or 400K. When the system assumes
 * 1M is available but the actual limit is 200K, compaction triggers too late and
 * the provider returns a context-length error.
 *
 * This module:
 * 1. Parses provider error responses to extract actual token limits
 * 2. Maintains a per-session "effective context window" that adjusts downward
 *    when the provider reports a lower limit than the preset
 * 3. Provides the resolved context window to the compaction trigger logic
 */

export interface ParsedContextLimitError {
  /** Tokens the request actually used. */
  currentTokens: number;
  /** Maximum tokens the provider allows. */
  maxTokens: number;
  /** Raw error type string from the provider. */
  errorType: string;
  /** Provider ID if extractable from the error. */
  providerID?: string;
  /** Model ID if extractable from the error. */
  modelID?: string;
}

// ─── Error Parsing ───────────────────────────────────────────────────────────

const TOKEN_LIMIT_PATTERNS = [
  /(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)\s*maximum/i,
  /prompt.*?(\d[\d,]*).*?tokens.*?exceeds.*?(\d[\d,]*)/i,
  /(\d[\d,]*).*?tokens.*?limit.*?(\d[\d,]*)/i,
  /context.*?length.*?(\d[\d,]*).*?maximum.*?(\d[\d,]*)/i,
  /max.*?context.*?(\d[\d,]*).*?but.*?(\d[\d,]*)/i,
  /(\d[\d,]*).*?token.*?input.*?exceeds.*?(\d[\d,]*)/i,
  /input.*?(\d[\d,]*).*?exceeds.*?maximum.*?(\d[\d,]*)/i,
];

const TOKEN_LIMIT_KEYWORDS = [
  'prompt is too long',
  'is too long',
  'context_length_exceeded',
  'max_tokens',
  'token limit',
  'context length',
  'too many tokens',
  'input is too long',
  'maximum context length',
];

function parseNumber(raw: string): number {
  return parseInt(raw.replace(/,/g, ''), 10);
}

function extractTokensFromMessage(message: string): { current: number; max: number } | null {
  for (const pattern of TOKEN_LIMIT_PATTERNS) {
    const match = message.match(pattern);
    if (match && match[1] && match[2]) {
      const num1 = parseNumber(match[1]);
      const num2 = parseNumber(match[2]);
      if (Number.isNaN(num1) || Number.isNaN(num2)) continue;
      return num1 > num2 ? { current: num1, max: num2 } : { current: num2, max: num1 };
    }
  }
  return null;
}

function isTokenLimitError(text: string): boolean {
  const lower = text.toLowerCase();
  return TOKEN_LIMIT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Parse an upstream error to extract context window limit information.
 * Returns null if the error is not a context-length error.
 *
 * Mirrors oh-my-opencode's `parseAnthropicTokenLimitError` but generalized
 * to work with any provider (OpenAI, Anthropic, Bedrock, etc.).
 */
export function parseContextLimitError(error: unknown): ParsedContextLimitError | null {
  if (typeof error === 'string') {
    if (isTokenLimitError(error)) {
      const tokens = extractTokensFromMessage(error);
      return {
        currentTokens: tokens?.current ?? 0,
        maxTokens: tokens?.max ?? 0,
        errorType: 'token_limit_exceeded_string',
      };
    }
    return null;
  }

  if (!error || typeof error !== 'object') return null;

  const errObj = error as Record<string, unknown>;
  const textSources: string[] = [];

  // Collect text from various error shapes (AI SDK, Anthropic, OpenAI, Bedrock)
  const dataObj = errObj['data'] as Record<string, unknown> | undefined;
  const responseBody = dataObj?.['responseBody'] ?? errObj['responseBody'];
  const errorMessage = errObj['message'] as string | undefined;
  const errorData = errObj['error'] as Record<string, unknown> | undefined;
  const nestedError = errorData?.['error'] as Record<string, unknown> | undefined;

  if (typeof responseBody === 'string') textSources.push(responseBody);
  if (typeof errorMessage === 'string') textSources.push(errorMessage);
  if (typeof errorData?.['message'] === 'string') textSources.push(errorData['message']);
  if (typeof errObj['body'] === 'string') textSources.push(errObj['body']);
  if (typeof errObj['details'] === 'string') textSources.push(errObj['details']);
  if (typeof errObj['reason'] === 'string') textSources.push(errObj['reason']);
  if (typeof nestedError?.['message'] === 'string')
    textSources.push(nestedError['message']);
  if (typeof dataObj?.['message'] === 'string') textSources.push(dataObj['message']);

  if (textSources.length === 0) {
    try {
      const jsonStr = JSON.stringify(errObj);
      if (isTokenLimitError(jsonStr)) {
        textSources.push(jsonStr);
      }
    } catch {
      /* ignore */
    }
  }

  const combinedText = textSources.join(' ');
  if (!isTokenLimitError(combinedText)) return null;

  // Try to parse structured JSON from responseBody (Anthropic SSE format)
  if (typeof responseBody === 'string') {
    try {
      const jsonPatterns = [
        /data:\s*(\{[\s\S]*\})\s*$/m,
        /(\{"type"\s*:\s*"error"[\s\S]*\})/,
        /(\{[\s\S]*"error"[\s\S]*\})/,
      ];
      for (const pattern of jsonPatterns) {
        const dataMatch = responseBody.match(pattern);
        if (dataMatch && dataMatch[1]) {
          try {
            const jsonData = JSON.parse(dataMatch[1]) as {
              error?: { type?: string; message?: string };
              request_id?: string;
            };
            const message = jsonData.error?.message ?? '';
            const tokens = extractTokensFromMessage(message);
            if (tokens) {
              return {
                currentTokens: tokens.current,
                maxTokens: tokens.max,
                errorType: jsonData.error?.type ?? 'token_limit_exceeded',
              };
            }
          } catch {
            /* continue */
          }
        }
      }
    } catch {
      /* continue */
    }
  }

  // Extract from any text source
  for (const text of textSources) {
    const tokens = extractTokensFromMessage(text);
    if (tokens) {
      return {
        currentTokens: tokens.current,
        maxTokens: tokens.max,
        errorType: 'token_limit_exceeded',
      };
    }
  }

  // Fallback: we know it's a token limit error but can't extract numbers
  if (isTokenLimitError(combinedText)) {
    return {
      currentTokens: 0,
      maxTokens: 0,
      errorType: 'token_limit_exceeded_unknown',
    };
  }

  return null;
}

// ─── Effective Context Window Resolution ─────────────────────────────────────

/**
 * Pre-configured context window overrides.
 *
 * Mirrors opencode's codex.ts pattern where specific provider+model combinations
 * have hardcoded context limits (e.g. GPT-5.5 via Codex = 400K), and
 * oh-my-opencode's ANTHROPIC_1M_CONTEXT env var pattern.
 *
 * These overrides take priority over the model preset's contextWindow when
 * the provider/relay is known to have a lower limit than the model itself.
 *
 * Sources (checked in order):
 * 1. User settings in database (per-provider model contextWindow config)
 * 2. Environment variables (CONTEXT_WINDOW_OVERRIDE_*)
 *
 * Format: Map<modelIdPattern, contextWindowOverride>
 */
const ENV_CONTEXT_OVERRIDES = buildEnvContextOverrides();

function buildEnvContextOverrides(): Map<string, number> {
  const overrides = new Map<string, number>();

  // Generic override: CONTEXT_WINDOW_OVERRIDE_<MODEL_PATTERN>=<limit>
  // e.g. CONTEXT_WINDOW_OVERRIDE_GPT_5_5=400000
  //      CONTEXT_WINDOW_OVERRIDE_CLAUDE=200000
  //
  // This mirrors oh-my-opencode's ANTHROPIC_1M_CONTEXT pattern but generalized
  // to any model. The pattern is matched as a substring of the model ID.
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('CONTEXT_WINDOW_OVERRIDE_') || !value) continue;
    const pattern = key
      .slice('CONTEXT_WINDOW_OVERRIDE_'.length)
      .toLowerCase()
      .replace(/_/g, '-');
    const limit = parseInt(value, 10);
    if (!Number.isNaN(limit) && limit > 0) {
      overrides.set(pattern, limit);
    }
  }

  return overrides;
}

/**
 * Check if a model ID matches a pre-configured context window override.
 * Returns the override limit, or undefined if no override applies.
 */
function getEnvContextOverride(modelId: string): number | undefined {
  const lower = modelId.toLowerCase();
  for (const [pattern, limit] of ENV_CONTEXT_OVERRIDES) {
    if (lower.includes(pattern)) {
      return limit;
    }
  }
  return undefined;
}

/**
 * Per-session cache of the effective (actual) context window discovered
 * from provider error responses. When a provider returns a context-length
 * error with `maxTokens < presetContextWindow`, we cache the lower value
 * so subsequent rounds use the correct limit for compaction decisions.
 *
 * Key: `${userId}:${modelId}` — shared across sessions for the same user+model
 * because the provider limit is model-specific, not session-specific.
 */
const effectiveContextWindowCache = new Map<
  string,
  { maxTokens: number; discoveredAt: number }
>();

/** Cache entries expire after 1 hour to allow re-discovery if limits change. */
const CACHE_TTL_MS = 60 * 60 * 1000;

function cacheKey(userId: string, modelId: string): string {
  return `${userId}:${modelId}`;
}

/**
 * Record a discovered effective context window from a provider error.
 * Only caches if the discovered limit is lower than the preset.
 */
export function recordDiscoveredContextWindow(
  userId: string,
  modelId: string,
  discoveredMaxTokens: number,
  presetContextWindow: number | undefined,
): void {
  if (discoveredMaxTokens <= 0) return;
  // Only cache if the discovered limit is meaningfully lower than the preset
  if (presetContextWindow && discoveredMaxTokens >= presetContextWindow) return;

  const key = cacheKey(userId, modelId);
  effectiveContextWindowCache.set(key, {
    maxTokens: discoveredMaxTokens,
    discoveredAt: Date.now(),
  });
}

/**
 * Resolve the effective context window for a given user+model combination.
 *
 * Priority (highest to lowest):
 * 1. Discovered limit from provider error (runtime, cached)
 * 2. Environment variable override (CONTEXT_WINDOW_OVERRIDE_*)
 * 3. User-configured model contextWindow (from AIModelConfig in provider settings DB)
 *    — This is the primary mechanism for users to set per-provider limits.
 *    — e.g. User configures GPT-5.5 via relay X with contextWindow=400000
 * 4. Fallback default (128K)
 *
 * This mirrors the combined approach of:
 * - opencode's codex.ts: per-provider model limits (→ user DB config)
 * - oh-my-opencode's ANTHROPIC_1M_CONTEXT: env-var based limit (→ env override)
 * - oh-my-opencode's parser.ts: runtime error-based discovery (→ cache)
 *
 * Example: GPT-5.5 has contextWindow=1M from models.dev sync, but:
 * - User sets contextWindow=400000 in provider settings → uses 400K (priority 3)
 * - Or CONTEXT_WINDOW_OVERRIDE_GPT_5_5=400000 is set → uses 400K (priority 2)
 * - Or relay returns "exceeds 400000 maximum" → caches 400K (priority 1)
 */
export function resolveEffectiveContextWindow(
  userId: string,
  modelId: string,
  presetContextWindow: number | undefined,
): number {
  // Priority 1: Runtime-discovered limit (from provider error)
  const key = cacheKey(userId, modelId);
  const cached = effectiveContextWindowCache.get(key);
  if (cached) {
    const age = Date.now() - cached.discoveredAt;
    if (age < CACHE_TTL_MS) {
      return cached.maxTokens;
    }
    effectiveContextWindowCache.delete(key);
  }

  // Priority 2: Environment variable override
  const envOverride = getEnvContextOverride(modelId);
  if (envOverride !== undefined) {
    // Only apply if it's lower than the preset (don't increase beyond preset)
    const preset = presetContextWindow ?? 128_000;
    return Math.min(envOverride, preset);
  }

  // Priority 3: Model preset contextWindow
  // Priority 4: Fallback
  return presetContextWindow ?? 128_000;
}

/**
 * Check if we have a discovered (lower) context window for this user+model.
 * Used to decide whether to apply more aggressive compaction thresholds.
 */
export function hasDiscoveredLowerContextWindow(
  userId: string,
  modelId: string,
  presetContextWindow: number | undefined,
): boolean {
  const effective = resolveEffectiveContextWindow(userId, modelId, presetContextWindow);
  return presetContextWindow !== undefined && effective < presetContextWindow;
}

/**
 * Clear the discovered context window cache for a user+model.
 * Useful when the user changes provider configuration.
 */
export function clearDiscoveredContextWindow(userId: string, modelId: string): void {
  effectiveContextWindowCache.delete(cacheKey(userId, modelId));
}

/** Clear all cached entries (e.g. on server restart). */
export function clearAllDiscoveredContextWindows(): void {
  effectiveContextWindowCache.clear();
}

// ─── Aggressive Tool Output Truncation (Phase 2 Recovery) ────────────────────

/**
 * Configuration for aggressive tool output truncation when context overflow
 * is detected. Mirrors oh-my-opencode's TRUNCATE_CONFIG.
 */
export const AGGRESSIVE_TRUNCATION_CONFIG = {
  /** Target ratio of maxTokens to reduce to (0.5 = reduce to 50% of max). */
  targetTokenRatio: 0.5,
  /** Approximate characters per token for estimation. */
  charsPerToken: 4,
  /** Minimum output size (chars) worth truncating. */
  minOutputSizeToTruncate: 500,
  /** Maximum truncation attempts per session before giving up. */
  maxTruncateAttempts: 20,
} as const;

const AGGRESSIVE_TRUNCATION_PLACEHOLDER =
  '[TOOL RESULT TRUNCATED — 上下文超限，原始输出已被截断以恢复会话。如需完整输出请重新执行该工具。]';

export interface AggressiveTruncationResult {
  /** Whether any truncation was performed. */
  success: boolean;
  /** Whether the truncation was sufficient to get under the target. */
  sufficient: boolean;
  /** Number of tool outputs truncated. */
  truncatedCount: number;
  /** Total characters removed. */
  totalCharsRemoved: number;
  /** Target characters that needed to be removed. */
  targetCharsToRemove: number;
  /** Details of truncated tools. */
  truncatedTools: Array<{ toolName: string; originalSize: number }>;
}

interface ToolOutputCandidate {
  messageIndex: number;
  contentIndex: number;
  toolName: string;
  outputSize: number;
}

/**
 * Aggressively truncate tool outputs in the message history to reduce
 * context size below the provider's actual limit.
 *
 * This is Phase 2 recovery (before full compaction/summarization):
 * find the largest tool outputs and replace them with a placeholder.
 * This is faster and less lossy than full compaction because it only
 * removes tool outputs (which can be re-run) rather than summarizing
 * the entire conversation.
 *
 * Mirrors oh-my-opencode's `truncateUntilTargetTokens`.
 *
 * Returns a new message array with truncated outputs (does NOT mutate input).
 */
export function aggressiveTruncateToolOutputs(
  messages: Array<{ role: string; content: Array<{ type: string; output?: string; toolName?: string; toolCallId?: string; [key: string]: unknown }> }>,
  currentTokens: number,
  maxTokens: number,
  config = AGGRESSIVE_TRUNCATION_CONFIG,
): AggressiveTruncationResult & { messages: typeof messages } {
  const targetTokens = Math.floor(maxTokens * config.targetTokenRatio);
  const tokensToReduce = currentTokens - targetTokens;
  const charsToReduce = tokensToReduce * config.charsPerToken;

  if (tokensToReduce <= 0) {
    return {
      success: true,
      sufficient: true,
      truncatedCount: 0,
      totalCharsRemoved: 0,
      targetCharsToRemove: 0,
      truncatedTools: [],
      messages,
    };
  }

  // Collect all tool_result outputs sorted by size (largest first)
  const candidates: ToolOutputCandidate[] = [];
  messages.forEach((message, messageIndex) => {
    message.content.forEach((content, contentIndex) => {
      if (content.type !== 'tool_result') return;
      const output = typeof content.output === 'string' ? content.output : '';
      if (output.length < config.minOutputSizeToTruncate) return;
      // Resolve tool name from the corresponding tool_call
      const toolName = content.toolName ?? resolveToolNameFromMessages(messages, content.toolCallId) ?? 'unknown';
      candidates.push({ messageIndex, contentIndex, toolName, outputSize: output.length });
    });
  });

  // Sort by output size descending — truncate largest first
  candidates.sort((a, b) => b.outputSize - a.outputSize);

  if (candidates.length === 0) {
    return {
      success: false,
      sufficient: false,
      truncatedCount: 0,
      totalCharsRemoved: 0,
      targetCharsToRemove: charsToReduce,
      truncatedTools: [],
      messages,
    };
  }

  // Determine which candidates to truncate
  let totalRemoved = 0;
  const toTruncate = new Set<string>();
  const truncatedTools: Array<{ toolName: string; originalSize: number }> = [];

  for (const candidate of candidates) {
    if (totalRemoved >= charsToReduce) break;
    const key = `${candidate.messageIndex}:${candidate.contentIndex}`;
    toTruncate.add(key);
    totalRemoved += candidate.outputSize;
    truncatedTools.push({ toolName: candidate.toolName, originalSize: candidate.outputSize });
  }

  // Apply truncation (immutable)
  const newMessages = messages.map((message, messageIndex) => ({
    ...message,
    content: message.content.map((content, contentIndex) => {
      if (!toTruncate.has(`${messageIndex}:${contentIndex}`)) return content;
      return { ...content, output: AGGRESSIVE_TRUNCATION_PLACEHOLDER };
    }),
  }));

  return {
    success: toTruncate.size > 0,
    sufficient: totalRemoved >= charsToReduce,
    truncatedCount: toTruncate.size,
    totalCharsRemoved: totalRemoved,
    targetCharsToRemove: charsToReduce,
    truncatedTools,
    messages: newMessages,
  };
}

/** Helper to resolve tool name from a tool_call in the message history. */
function resolveToolNameFromMessages(
  messages: Array<{ role: string; content: Array<{ type: string; toolCallId?: string; toolName?: string; [key: string]: unknown }> }>,
  toolCallId: string | undefined,
): string | undefined {
  if (!toolCallId) return undefined;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const content of message.content) {
      if (content.type === 'tool_call' && content.toolCallId === toolCallId) {
        return content.toolName;
      }
    }
  }
  return undefined;
}
